/**
 * dig-merge.ts — pure function that merges GIST (model) + DUG (companion) data
 * for a single video, producing one MergedSection per summary section in order.
 *
 * Keying contract (spec §3a):
 *   - One MergedSection per summary.sections[i], in order.
 *   - startSec = section.timeRange?.startSec ?? null.
 *   - GIST trusted only if: envelope non-null AND sameTitles(parsedTitles, envelope.sourceSections)
 *     AND envelope.model.sections[i] exists → { lead, bullets }; otherwise gist = null (skeleton).
 *   - DUG match step 1: DugSection.sectionId === section.startSec (exact numeric match).
 *     Step 2 fallback: any not-yet-consumed DugSection matched to a not-yet-dug summary section
 *     by exact title.
 *   - Any DugSection consumed by neither step → orphans[] (never dropped).
 *
 * No fs, no I/O — pure data transformation.
 */

import type { ParsedSummary } from './types';
import type { ModelEnvelope } from './model-store';
import type { DugSection } from '../dig/companion-doc';
import { sameTitles } from './rerender';
import { DIG_GENERATOR_VERSION } from '../dig/generate';

// ── Public types ───────────────────────────────────────────────────────────────

export interface MergedSection {
  index: number;
  numeral: string | null;
  title: string;
  startSec: number | null;
  gist: { lead: string; bullets: { text: string }[] } | null;
  dug: { bodyMarkdown: string } | null;
  isStale: boolean;
}

export interface MergeResult {
  sections: MergedSection[];
  orphans: { sectionId: number; title: string; bodyMarkdown: string }[];
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Merge summary GIST (model envelope) and DUG (companion-doc sections) into a
 * unified per-section view.
 *
 * @param summary  Parsed summary markdown (section list, titles, time ranges).
 * @param envelope Cached model envelope (source sections + magazine-style gist).
 *                 Null when no model file exists for this video.
 * @param dug      Dug sections from the companion doc (may be empty).
 */
export function mergeDigDoc(
  summary: ParsedSummary,
  envelope: ModelEnvelope | null,
  dug: DugSection[],
): MergeResult {
  const parsedTitles = summary.sections.map((s) => s.title);

  // Determine whether the model is trustworthy for all sections.
  // If the envelope is absent or the section titles have drifted, all gists are null.
  const titlesAligned =
    envelope !== null && sameTitles(parsedTitles, envelope.sourceSections);

  // Track which dug sectionIds have been consumed (both step 1 and step 2).
  const consumedIds = new Set<number>();

  // ── Step 1: sectionId match ───────────────────────────────────────────────
  // Build a lookup from sectionId → first DugSection for O(1) step-1 lookups.
  // If a sectionId appears more than once, only the first entry is eligible for
  // step-1 matching; all extras go directly to preOrphans so they are never dropped.
  const dugBySectionId = new Map<number, DugSection>();
  const preOrphans: DugSection[] = [];
  for (const d of dug) {
    if (dugBySectionId.has(d.sectionId)) {
      preOrphans.push(d);
    } else {
      dugBySectionId.set(d.sectionId, d);
    }
  }

  // For step 2: build a lookup from title → first unconsumed DugSection.
  // We'll resolve this lazily after step 1 to avoid consuming a section twice.

  // ── Build MergedSections ─────────────────────────────────────────────────
  const sections: MergedSection[] = summary.sections.map((section, i) => {
    const startSec = section.timeRange?.startSec ?? null;

    // GIST: only when envelope is aligned and model has an entry at this index.
    let gist: MergedSection['gist'] = null;
    if (titlesAligned && envelope !== null) {
      const modelSection = envelope.model.sections[i];
      if (modelSection !== undefined) {
        gist = { lead: modelSection.lead, bullets: modelSection.bullets };
      }
    }

    // DUG step 1: exact sectionId match against section's startSec.
    let dug_: MergedSection['dug'] = null;
    let isStale_ = false;
    if (startSec !== null) {
      const matched = dugBySectionId.get(startSec);
      if (matched !== undefined && !consumedIds.has(matched.sectionId)) {
        dug_ = { bodyMarkdown: matched.bodyMarkdown };
        isStale_ = matched.genVersion < DIG_GENERATOR_VERSION;
        consumedIds.add(matched.sectionId);
      }
    }

    return {
      index: i,
      numeral: section.numeral,
      title: section.title,
      startSec,
      gist,
      dug: dug_, // may be overwritten in step 2 pass below, but step-2 only fills null slots
      isStale: isStale_,
    };
  });

  // ── Step 2: title fallback ─────────────────────────────────────────────────
  // For each summary section that did NOT get a dug match in step 1,
  // try to find an unconsumed DugSection whose title exactly matches.
  // Build a map from title → unconsumed DugSection for this pass.
  // Per the spec: "any not-yet-consumed DugSection matched to a not-yet-dug summary section
  // by exact title". This means: for each dug section not yet consumed, match the FIRST
  // summary section (in order) whose title equals the dug section's title and that has no
  // dug content yet.

  // We need to iterate summary sections in order, matching against unconsumed dug sections.
  // Build a list of unconsumed dug sections (preserving original order).
  // For efficiency, use a title → array-of-dug-sections map.
  const dugByTitle = new Map<string, DugSection[]>();
  for (const d of dug) {
    if (!consumedIds.has(d.sectionId)) {
      const existing = dugByTitle.get(d.title) ?? [];
      existing.push(d);
      dugByTitle.set(d.title, existing);
    }
  }

  for (const ms of sections) {
    if (ms.dug !== null) continue; // already matched in step 1

    const candidates = dugByTitle.get(ms.title);
    if (!candidates || candidates.length === 0) continue;

    // Take the first unconsumed candidate with this title.
    // Filter down to unconsumed (consumedIds may have grown within this loop).
    const idx = candidates.findIndex((d) => !consumedIds.has(d.sectionId));
    if (idx === -1) continue;

    const matched = candidates[idx];
    ms.dug = { bodyMarkdown: matched.bodyMarkdown };
    ms.isStale = matched.genVersion < DIG_GENERATOR_VERSION;
    consumedIds.add(matched.sectionId);
  }

  // ── Orphans ───────────────────────────────────────────────────────────────
  // Any dug section not consumed by either step becomes an orphan.
  // preOrphans are duplicate-sectionId extras that were never put in the map;
  // they are unconsumed by definition and must also appear here.
  //
  // Build postOrphans from the de-duped dugBySectionId map values (NOT from the
  // raw dug array) so that a sectionId shared by two inputs that both go
  // unmatched is counted exactly once here — the duplicate is already in
  // preOrphans and would otherwise be appended a second time below.
  const postOrphans = [...dugBySectionId.values()]
    .filter((d) => !consumedIds.has(d.sectionId))
    .map((d) => ({
      sectionId: d.sectionId,
      title: d.title,
      bodyMarkdown: d.bodyMarkdown,
    }));

  const preOrphansMapped = preOrphans.map((d) => ({
    sectionId: d.sectionId,
    title: d.title,
    bodyMarkdown: d.bodyMarkdown,
  }));

  // Preserve deterministic order: pre-orphans (extras from step-1 build) come last,
  // after the unmatched entries that went through the normal matching pipeline.
  const orphans = [...postOrphans, ...preOrphansMapped];

  return { sections, orphans };
}
