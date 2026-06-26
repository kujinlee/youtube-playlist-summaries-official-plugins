/**
 * Companion-doc upsert for "dig deeper" sections.
 *
 * Maintains a per-video `<basename>-dig-deeper.md` that accumulates dug
 * sections. Idempotent: re-digging a section replaces that block and its
 * frontmatter entry in place; all other sections are preserved.
 *
 * No YAML library dependency — hand-rolled for this fixed schema only.
 * Atomic write via temp file + rename.
 *
 * NOTE: `generatedAt` must be supplied by the caller. This module never calls
 * `Date.now()` or `new Date()` internally (testability).
 *
 * Body format — each section is wrapped in sentinel comments so that `## ` /
 * `### ` headings inside bodyMarkdown never confuse the parser (C1 fix):
 *
 *   <!-- dig-section: 312 -->
 *   ## <title>
 *
 *   <bodyMarkdown (may contain ## / ###)>
 *   <!-- /dig-section -->
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DugSection {
  sectionId: number;
  startSec: number;
  title: string;
  bodyMarkdown: string;
  generatedAt: string;
  genVersion: number;
}

// ── Internal types ────────────────────────────────────────────────────────────

/** Complete in-memory representation of a companion doc. */
interface CompanionDoc {
  videoTitle: string;
  videoId: string;
  language: 'en' | 'ko';
  sourceVideoUrl: string;
  sections: DugSection[];
}

// ── YAML serialization ────────────────────────────────────────────────────────

/** Escape a string for use as a double-quoted YAML scalar. */
function yamlQuote(s: string): string {
  // Escape backslash first, then double-quote, then control chars.
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function serializeFrontmatter(doc: CompanionDoc): string {
  const lines: string[] = [
    '---',
    `title: "${yamlQuote(doc.videoTitle)}"`,
    `videoId: "${yamlQuote(doc.videoId)}"`,
    `language: "${doc.language}"`,
    `sourceVideoUrl: "${yamlQuote(doc.sourceVideoUrl)}"`,
  ];

  if (doc.sections.length === 0) {
    lines.push('sections: []');
  } else {
    lines.push('sections:');
    for (const s of doc.sections) {
      lines.push(`  - sectionId: ${s.sectionId}`);
      lines.push(`    startSec: ${s.startSec}`);
      lines.push(`    title: "${yamlQuote(s.title)}"`);
      lines.push(`    generatedAt: "${yamlQuote(s.generatedAt)}"`);
      lines.push(`    genVersion: ${s.genVersion ?? 0}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Serialize body using sentinel-delimited blocks so that `## ` / `### ` inside
 * bodyMarkdown is never mistaken for a section boundary (C1 fix).
 *
 * Format per section (ordered by startSec):
 *
 *   <!-- dig-section: <sectionId> -->
 *   ## <title>
 *
 *   <bodyMarkdown (verbatim, trimEnd)>
 *   <!-- /dig-section -->
 */
function serializeBody(sections: DugSection[]): string {
  return sections
    .map((s) => {
      const body = s.bodyMarkdown.trimEnd();
      // Sanitize sentinel strings that could corrupt round-trip parsing.
      const safeBody = body
        .replace(/<!--\s*\/dig-section\s*-->/g, '<!-- /dig-section (escaped) -->')
        .replace(/<!--\s*dig-section\s*:/g, '<!-- dig-section-escaped:');
      return `<!-- dig-section: ${s.sectionId} -->\n## ${s.title}\n\n${safeBody}\n<!-- /dig-section -->`;
    })
    .join('\n\n');
}

function serialize(doc: CompanionDoc): string {
  // sections must be sorted by startSec before serializing
  const sorted = [...doc.sections].sort((a, b) => a.startSec - b.startSec);
  const docSorted: CompanionDoc = { ...doc, sections: sorted };
  const fm = serializeFrontmatter(docSorted);
  const body = serializeBody(sorted);
  return fm + '\n' + body + '\n';
}

// ── YAML parsing ──────────────────────────────────────────────────────────────

/** Parse a double-quoted YAML scalar (removes quotes + unescapes). */
function parseYamlQuotedScalar(raw: string): string {
  // raw may or may not have surrounding quotes
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
  return trimmed;
}

interface ParsedFrontmatter {
  videoTitle: string;
  videoId: string;
  language: 'en' | 'ko';
  sourceVideoUrl: string;
  sections: Array<{ sectionId: number; startSec: number; title: string; generatedAt: string; genVersion: number }>;
}

function parseFrontmatter(fmText: string): ParsedFrontmatter {
  const lines = fmText.split('\n');

  let videoTitle = '';
  let videoId = '';
  let language: 'en' | 'ko' = 'en';
  let sourceVideoUrl = '';
  const sections: Array<{ sectionId: number; startSec: number; title: string; generatedAt: string; genVersion: number }> = [];

  // State machine for parsing the sections block sequence
  let inSections = false;
  let currentSection: Partial<{ sectionId: number; startSec: number; title: string; generatedAt: string; genVersion: number }> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith('#')) continue; // skip comments

    // Detect entry into the sections block
    if (/^sections\s*:/.test(line)) {
      inSections = true;
      continue;
    }

    if (inSections) {
      const listItemMatch = line.match(/^\s{2}-\s+sectionId\s*:\s*(\d+)/);
      if (listItemMatch) {
        // Commit any previous partial section
        if (currentSection?.sectionId !== undefined && currentSection.startSec !== undefined) {
          sections.push({
            sectionId: currentSection.sectionId,
            startSec: currentSection.startSec,
            title: currentSection.title ?? '',
            generatedAt: currentSection.generatedAt ?? '',
            genVersion: currentSection.genVersion ?? 0,
          });
        }
        currentSection = { sectionId: parseInt(listItemMatch[1], 10) };
        continue;
      }

      const startSecMatch = line.match(/^\s{4}startSec\s*:\s*(\d+)/);
      if (startSecMatch && currentSection) {
        currentSection.startSec = parseInt(startSecMatch[1], 10);
        continue;
      }

      const titleMatch = line.match(/^\s{4}title\s*:\s*(.+)$/);
      if (titleMatch && currentSection) {
        currentSection.title = parseYamlQuotedScalar(titleMatch[1]);
        continue;
      }

      const generatedAtMatch = line.match(/^\s{4}generatedAt\s*:\s*(.+)$/);
      if (generatedAtMatch && currentSection) {
        currentSection.generatedAt = parseYamlQuotedScalar(generatedAtMatch[1]);
        continue;
      }

      const genVersionMatch = line.match(/^\s{4}genVersion\s*:\s*(\d+)/);
      if (genVersionMatch && currentSection) {
        currentSection.genVersion = parseInt(genVersionMatch[1], 10);
        continue;
      }

      // A non-indented non-empty line signals end of sections block
      if (line.trim() !== '' && !line.startsWith(' ') && !line.startsWith('\t')) {
        inSections = false;
        // Fall through to scalar parsing below
      } else {
        continue;
      }
    }

    // Scalar fields
    const scalarMatch = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!scalarMatch) continue;
    const [, key, rawVal] = scalarMatch;

    switch (key) {
      case 'title':
        videoTitle = parseYamlQuotedScalar(rawVal);
        break;
      case 'videoId':
        videoId = parseYamlQuotedScalar(rawVal);
        break;
      case 'language': {
        const lang = parseYamlQuotedScalar(rawVal);
        if (lang === 'en' || lang === 'ko') language = lang;
        break;
      }
      case 'sourceVideoUrl':
        sourceVideoUrl = parseYamlQuotedScalar(rawVal);
        break;
    }
  }

  // Commit trailing section
  if (currentSection?.sectionId !== undefined && currentSection.startSec !== undefined) {
    sections.push({
      sectionId: currentSection.sectionId,
      startSec: currentSection.startSec,
      title: currentSection.title ?? '',
      generatedAt: currentSection.generatedAt ?? '',
      genVersion: currentSection.genVersion ?? 0,
    });
  }

  return { videoTitle, videoId, language, sourceVideoUrl, sections };
}

/**
 * Parse the body of a companion doc into a map of sectionId → { title, bodyMarkdown }.
 *
 * Uses sentinel-delimited blocks (`<!-- dig-section: N -->` … `<!-- /dig-section -->`).
 * `## ` / `### ` inside bodyMarkdown is safe because the sentinel, not a heading,
 * defines the block boundary (C1 fix).
 *
 * Falls back to frontmatter `title` field when the sentinel block is missing
 * (legacy format or empty body).
 */
function parseBodySections(
  bodyText: string,
  fmSections: Array<{ sectionId: number; startSec: number; title: string; generatedAt: string; genVersion: number }>,
): Map<number, { title: string; bodyMarkdown: string }> {
  const result = new Map<number, { title: string; bodyMarkdown: string }>();
  if (!bodyText.trim()) return result;

  // Match sentinel-delimited blocks
  const blockRe = /<!-- dig-section: (\d+) -->\n([\s\S]*?)<!-- \/dig-section -->/g;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(bodyText)) !== null) {
    const sectionId = parseInt(match[1], 10);
    const blockContent = match[2]; // everything between sentinels

    // First line of blockContent is `## <title>`
    const headingMatch = blockContent.match(/^## (.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : '';
    // Body is everything after the heading line (and the blank line that follows)
    const rest = blockContent.replace(/^## .+\n?\n?/, '');
    result.set(sectionId, { title, bodyMarkdown: rest.trimEnd() });
  }

  // If no sentinel blocks found (legacy files or empty body), return empty map.
  // Callers fall back to frontmatter title in that case.
  return result;
}

// ── Pure parser ───────────────────────────────────────────────────────────────

/**
 * Parse the raw string content of a companion doc into an array of DugSections.
 *
 * Pure and synchronous — no filesystem access. Combines data from both
 * frontmatter (`sectionId`, `startSec`, `generatedAt`) and body sentinel blocks
 * (`title`, `bodyMarkdown`). Sections are returned in frontmatter order (which
 * the serializer guarantees is ascending startSec).
 *
 * - Unclosed sentinel blocks are skipped without throwing.
 * - Content with no sentinel blocks returns `[]`.
 */
export function parseDugSections(content: string): DugSection[] {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return [];

  const [, fmText, bodyText] = fmMatch;
  const fm = parseFrontmatter(fmText);
  const bodyMap = parseBodySections(bodyText, fm.sections);

  return fm.sections.flatMap((s) => {
    const body = bodyMap.get(s.sectionId);
    // Skip sections whose sentinel block is absent or unclosed (no closing tag
    // means the regex didn't match, so bodyMap has no entry for this sectionId).
    if (!body) return [];
    return [
      {
        sectionId: s.sectionId,
        startSec: s.startSec,
        // Title sourced from body map (sentinel block) first, then frontmatter
        title: body.title !== '' ? body.title : s.title,
        bodyMarkdown: body.bodyMarkdown,
        generatedAt: s.generatedAt,
        genVersion: s.genVersion ?? 0,
      },
    ];
  });
}

// ── Read existing doc ─────────────────────────────────────────────────────────

async function readCompanionDoc(filePath: string): Promise<CompanionDoc | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  // Split into frontmatter and body to get doc-level fields
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const [, fmText] = fmMatch;
  const fm = parseFrontmatter(fmText);

  // Delegate section parsing to the pure parser
  const sections = parseDugSections(raw);

  return {
    videoTitle: fm.videoTitle,
    videoId: fm.videoId,
    language: fm.language,
    sourceVideoUrl: fm.sourceVideoUrl,
    sections,
  };
}

// ── Atomic write ──────────────────────────────────────────────────────────────

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.tmp-${crypto.randomUUID()}.md`);
  try {
    await writeFile(tmpPath, content, 'utf8');
    await rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup of temp file
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmpPath);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

// ── Per-path write serialization ──────────────────────────────────────────────

/**
 * Serializes writes per digDeeperPath so that concurrent digs of different
 * sections for the same video do not interleave their read→mutate→write cycles.
 *
 * Each entry is the tail of the promise chain for that path. New writes append
 * to the chain via `.then()`. Errors are swallowed at chain level so a failed
 * upsert doesn't break the chain for subsequent writes.
 */
const writeChains = new Map<string, Promise<void>>();

// ── Public API ────────────────────────────────────────────────────────────────

async function doUpsert(opts: {
  digDeeperPath: string;
  videoTitle: string;
  videoId: string;
  language: 'en' | 'ko';
  sourceVideoUrl: string;
  section: DugSection;
}): Promise<void> {
  const { digDeeperPath, videoTitle, videoId, language, sourceVideoUrl, section } = opts;

  let doc = await readCompanionDoc(digDeeperPath);

  if (!doc) {
    // First write
    doc = { videoTitle, videoId, language, sourceVideoUrl, sections: [] };
  }

  // Upsert: replace existing section with matching sectionId, or append new
  const idx = doc.sections.findIndex((s) => s.sectionId === section.sectionId);
  if (idx === -1) {
    doc.sections.push(section);
  } else {
    doc.sections[idx] = section;
  }

  const content = serialize(doc);
  await atomicWrite(digDeeperPath, content);
}

/**
 * Upsert one dug section into the companion doc at `digDeeperPath`.
 *
 * - Creates the file if absent (first write).
 * - Replaces the section with the matching `sectionId` if present.
 * - Preserves all other sections.
 * - Sorts sections by `startSec` ascending in both frontmatter and body.
 * - Writes atomically via temp file + rename.
 * - Serializes concurrent writes for the same path to avoid interleaving.
 */
export async function upsertDugSection(opts: {
  digDeeperPath: string;
  videoTitle: string;
  videoId: string;
  language: 'en' | 'ko';
  sourceVideoUrl: string;
  section: DugSection;
}): Promise<void> {
  const { digDeeperPath } = opts;
  const prev = writeChains.get(digDeeperPath) ?? Promise.resolve();
  const next = prev.then(() => doUpsert(opts));
  writeChains.set(digDeeperPath, next.catch(() => {}));
  return next;
}

/**
 * Return the list of `sectionId` integers from the frontmatter `sections` array
 * of the companion doc at `digDeeperPath`.
 *
 * Returns `[]` if the file does not exist or has no `sections` key.
 */
export async function readDugSectionIds(digDeeperPath: string): Promise<number[]> {
  const doc = await readCompanionDoc(digDeeperPath);
  if (!doc) return [];
  return [...doc.sections]
    .sort((a, b) => a.startSec - b.startSec)
    .map((s) => s.sectionId);
}
