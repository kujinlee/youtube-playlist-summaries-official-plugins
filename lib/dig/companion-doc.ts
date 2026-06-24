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
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// ── Public types ──────────────────────────────────────────────────────────────

export interface DugSection {
  sectionId: number;
  startSec: number;
  title: string;
  bodyMarkdown: string;
  generatedAt: string;
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
    `digVersion: { major: 1, minor: 0 }`,
  ];

  if (doc.sections.length === 0) {
    lines.push('sections: []');
  } else {
    lines.push('sections:');
    for (const s of doc.sections) {
      lines.push(`  - sectionId: ${s.sectionId}`);
      lines.push(`    startSec: ${s.startSec}`);
      lines.push(`    generatedAt: "${yamlQuote(s.generatedAt)}"`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

function serializeBody(sections: DugSection[]): string {
  return sections
    .map((s) => `## ${s.title}\n\n${s.bodyMarkdown.trimEnd()}\n`)
    .join('\n');
}

function serialize(doc: CompanionDoc): string {
  // sections must be sorted by startSec before serializing
  const sorted = [...doc.sections].sort((a, b) => a.startSec - b.startSec);
  const docSorted: CompanionDoc = { ...doc, sections: sorted };
  return serializeFrontmatter(docSorted) + '\n' + serializeBody(sorted);
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
  sections: Array<{ sectionId: number; startSec: number; generatedAt: string }>;
}

function parseFrontmatter(fmText: string): ParsedFrontmatter {
  const lines = fmText.split('\n');

  let videoTitle = '';
  let videoId = '';
  let language: 'en' | 'ko' = 'en';
  let sourceVideoUrl = '';
  const sections: Array<{ sectionId: number; startSec: number; generatedAt: string }> = [];

  // State machine for parsing the sections block sequence
  let inSections = false;
  let currentSection: Partial<{ sectionId: number; startSec: number; generatedAt: string }> | null = null;

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
            generatedAt: currentSection.generatedAt ?? '',
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

      const generatedAtMatch = line.match(/^\s{4}generatedAt\s*:\s*(.+)$/);
      if (generatedAtMatch && currentSection) {
        currentSection.generatedAt = parseYamlQuotedScalar(generatedAtMatch[1]);
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
      generatedAt: currentSection.generatedAt ?? '',
    });
  }

  return { videoTitle, videoId, language, sourceVideoUrl, sections };
}

/**
 * Parse the body of a companion doc (below the closing `---`) into a map
 * of sectionId → { title, bodyMarkdown } using the `## <title>` headings.
 *
 * Body sections are separated by `## ` headings. We need to correlate headings
 * back to sectionIds using the frontmatter sections list (matched by title).
 * When multiple sections share the same title, we rely on order.
 */
function parseBodySections(
  bodyText: string,
  fmSections: Array<{ sectionId: number; startSec: number; generatedAt: string }>,
  titleMap: Map<number, string>,
): Map<number, { title: string; bodyMarkdown: string }> {
  const result = new Map<number, { title: string; bodyMarkdown: string }>();
  if (!bodyText.trim()) return result;

  // Split body on `## ` headings (at start of line)
  const blocks = bodyText.split(/^(?=## )/m).filter((b) => b.trim() !== '');

  // Build a list of (title, bodyMarkdown) from blocks in order
  const parsed: Array<{ title: string; bodyMarkdown: string }> = blocks.map((block) => {
    const headingMatch = block.match(/^## (.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : '';
    // Body is everything after the heading line
    const rest = block.replace(/^## .+\n?/, '');
    return { title, bodyMarkdown: rest.trimEnd() };
  });

  // Map parsed blocks back to sectionIds by order of appearance in fmSections
  // (fmSections are sorted by startSec, and body blocks are in the same order)
  const fmSorted = [...fmSections].sort((a, b) => a.startSec - b.startSec);

  for (let i = 0; i < fmSorted.length && i < parsed.length; i++) {
    result.set(fmSorted[i].sectionId, parsed[i]);
  }

  return result;
}

// ── Read existing doc ─────────────────────────────────────────────────────────

async function readCompanionDoc(filePath: string): Promise<CompanionDoc | null> {
  if (!existsSync(filePath)) return null;

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  // Split into frontmatter and body
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return null;

  const [, fmText, bodyText] = fmMatch;
  const fm = parseFrontmatter(fmText);

  // Build a title map from sectionId -> title (from frontmatter)
  // We need it to reconstruct DugSection objects
  const titleMap = new Map<number, string>();

  const bodyMap = parseBodySections(bodyText, fm.sections, titleMap);

  const sections: DugSection[] = fm.sections.map((s) => {
    const body = bodyMap.get(s.sectionId);
    return {
      sectionId: s.sectionId,
      startSec: s.startSec,
      title: body?.title ?? '',
      bodyMarkdown: body?.bodyMarkdown ?? '',
      generatedAt: s.generatedAt,
    };
  });

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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Upsert one dug section into the companion doc at `digDeeperPath`.
 *
 * - Creates the file if absent (first write).
 * - Replaces the section with the matching `sectionId` if present.
 * - Preserves all other sections.
 * - Sorts sections by `startSec` ascending in both frontmatter and body.
 * - Writes atomically via temp file + rename.
 */
export async function upsertDugSection(opts: {
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
