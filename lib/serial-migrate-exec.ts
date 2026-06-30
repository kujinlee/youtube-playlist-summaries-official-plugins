import fs from 'fs';
import path from 'path';
import { readIndex, writeIndex, updateVideoFields } from './index-store';
import { planMigration } from './serial-migrate';
import { rewriteSourceMdMeta, rewriteEnvelopeSourceMd } from './serial-provenance';
import type { RenameOp } from './serial-migrate';

export function runPhaseA(outputFolder: string): { assigned: number } {
  const index = readIndex(outputFolder);
  const { assignments } = planMigration(index.videos);
  if (assignments.length === 0) return { assigned: 0 };
  const serialById = new Map(assignments.map((a) => [a.id, a.serial]));
  const videos = index.videos.map((v) =>
    serialById.has(v.id) ? { ...v, serialNumber: serialById.get(v.id)! } : v,
  );
  writeIndex(outputFolder, { ...index, videos });   // single atomic write (temp→rename)
  return { assigned: assignments.length };
}

/**
 * Find a file by scanning its directory and matching on NFC-normalized name.
 * `relPath` may include a subdir prefix (e.g. `htmls/foo.html`). Returns the absolute
 * path of the first entry whose NFC form equals the target's, or null.
 *
 * Why: filenames can be stored on disk in a different Unicode normalization than the
 * string in the index (Korean slugs are sometimes mixed/NFD), so a byte-exact
 * `fs.existsSync` can miss a file that is genuinely present. See the
 * serial-migration-normalization fix. The scan is normalization-insensitive.
 */
export function findByNormalizedName(dir: string, relPath: string): string | null {
  const sub = path.dirname(relPath); // '.' when relPath has no subdir
  const targetNfc = path.basename(relPath).normalize('NFC');
  const scanDir = sub === '.' ? dir : path.join(dir, sub);
  let entries: string[];
  try {
    entries = fs.readdirSync(scanDir);
  } catch {
    return null; // directory missing
  }
  for (const entry of entries) {
    if (entry.normalize('NFC') === targetNfc) return path.join(scanDir, entry);
  }
  return null;
}

/** Resolve a relPath to its actual on-disk absolute path (root or archived/). Null if neither exists. */
export function resolveOnDisk(outputFolder: string, relPath: string): { abs: string; rel: string } | null {
  const root = path.join(outputFolder, relPath);
  if (fs.existsSync(root)) return { abs: root, rel: relPath };
  const arch = path.join(outputFolder, 'archived', relPath);
  if (fs.existsSync(arch)) return { abs: arch, rel: `archived/${relPath}` };
  // Normalization-tolerant fallback: the index string may differ from the on-disk
  // bytes by Unicode normalization, so existsSync (byte-exact, and only NFC↔NFD
  // tolerant on some filesystems) can miss a file that is really there.
  const rootMatch = findByNormalizedName(outputFolder, relPath);
  if (rootMatch) return { abs: rootMatch, rel: relPath };
  const archMatch = findByNormalizedName(path.join(outputFolder, 'archived'), relPath);
  if (archMatch) return { abs: archMatch, rel: `archived/${relPath}` };
  return null;
}

/** Physical dst path that mirrors src's actual location (root or archived/), with the new basename. */
function physicalDst(src: { abs: string }, op: RenameOp): string {
  return path.join(path.dirname(src.abs), path.basename(op.to));
}

export function runPhaseB(outputFolder: string): { renamed: number; conflicts: string[] } {
  const index = readIndex(outputFolder);
  const { perVideo } = planMigration(index.videos);
  let renamed = 0;
  const conflicts: string[] = [];

  for (const plan of perVideo) {
    if (plan.renames.length === 0) continue;

    // ── Pass 1: clobber-conflict check (only when BOTH src present AND a different dst exists). ──
    let aborted = false;
    for (const op of plan.renames) {
      const src = resolveOnDisk(outputFolder, op.from);
      if (!src) continue;                                  // src gone → not a conflict (see B2)
      const dstAbs = physicalDst(src, op);
      if (fs.existsSync(dstAbs)) {
        // I2: realpathSync can throw ENOENT on TOCTOU race (file vanishes after existsSync).
        // Treat any error conservatively as a conflict to avoid clobbering unknown state.
        let isConflict = false;
        try {
          isConflict = fs.realpathSync(dstAbs) !== fs.realpathSync(src.abs);
        } catch {
          isConflict = true;
        }
        if (isConflict) { conflicts.push(plan.id); aborted = true; break; } // different file at target → never clobber
      }
    }
    if (aborted) continue;

    // ── Pass 2: rename (or recognise already-renamed) + collect index updates + provenance targets. ──
    const fieldUpdates: Record<string, string> = {};       // index value is ALWAYS op.to (root-relative) — B1
    const htmlTargetsAbs: string[] = [];
    let mdNewName: string | null = null;
    let modelTargetAbs: string | null = null;

    for (const op of plan.renames) {
      let targetAbs: string | null = null;
      const src = resolveOnDisk(outputFolder, op.from);
      if (src) {
        const dstAbs = physicalDst(src, op);
        if (!fs.existsSync(dstAbs)) {
          // I1: a throwing renameSync (EACCES, EXDEV, etc.) must not abort later videos.
          // On error, skip this video entirely (no index update, no provenance rewrite).
          try { fs.renameSync(src.abs, dstAbs); renamed++; }
          catch { conflicts.push(plan.id); aborted = true; break; }
        }
        targetAbs = dstAbs;
      } else {
        // B2: src missing — a prior crashed run may have already renamed it. Probe the target.
        const done = resolveOnDisk(outputFolder, op.to);
        if (done) targetAbs = done.abs;                    // already-renamed → still converge the index
        // else: artifact simply doesn't exist → skip entirely
      }
      if (targetAbs === null) continue;

      if (op.field !== 'model') fieldUpdates[op.field] = op.to;   // ROOT-relative — B1
      if (op.field === 'summaryMd') mdNewName = path.basename(op.to);
      if (op.field === 'model') modelTargetAbs = targetAbs;
      if (op.field === 'summaryHtml' || op.field === 'digDeeperHtml') {
        htmlTargetsAbs.push(targetAbs);
      }
    }

    if (aborted) continue;  // I1: renameSync failed mid-video → skip provenance + index update

    // ── Provenance: rewrite source-md meta in the renamed HTML + the envelope sourceMd. Best-effort. ──
    if (mdNewName) {
      for (const h of htmlTargetsAbs) {
        try { fs.writeFileSync(h, rewriteSourceMdMeta(fs.readFileSync(h, 'utf8'), mdNewName)); } catch { /* no-op */ }
      }
      if (modelTargetAbs) {
        try { fs.writeFileSync(modelTargetAbs, rewriteEnvelopeSourceMd(fs.readFileSync(modelTargetAbs, 'utf8'), mdNewName)); } catch { /* no-op */ }
      }
    }

    // ── Per-video index update (bounded blast radius — B1/B2 convergence). ──
    if (Object.keys(fieldUpdates).length > 0) updateVideoFields(outputFolder, plan.id, fieldUpdates);
  }
  return { renamed, conflicts };
}

/**
 * Run Phase B repeatedly until a pass renames nothing (converged) or maxPasses is hit.
 *
 * A single Phase B pass has been observed to leave some renames unapplied (a file that
 * exists but whose lookup transiently missed); re-running completes them. Looping here
 * guarantees a single `--apply` converges instead of requiring the operator to re-run.
 * Terminates as soon as a pass renames 0 — files that can never be renamed (no source on
 * disk) contribute 0 and therefore never cause an infinite loop.
 */
export function runPhaseBUntilStable(
  outputFolder: string,
  maxPasses = 10,
): { renamed: number; conflicts: string[]; passes: number } {
  let renamed = 0;
  const conflicts = new Set<string>();
  let passes = 0;
  for (let i = 0; i < maxPasses; i++) {
    const pass = runPhaseB(outputFolder);
    passes++;
    renamed += pass.renamed;
    for (const c of pass.conflicts) conflicts.add(c);
    if (pass.renamed === 0) break; // no progress → converged
  }
  return { renamed, conflicts: [...conflicts], passes };
}
