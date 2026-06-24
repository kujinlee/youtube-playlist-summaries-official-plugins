import type { ParsedSection } from '@/lib/html-doc/types';
import type { TranscriptSegment } from '@/lib/transcript-timestamps';

/**
 * A resolved window for one summary section, ready to be sent to an LLM
 * for a "dig deeper" follow-up prompt.
 */
export interface SectionWindow {
  /** Stable id for this window — the section's startSec. */
  sectionId: number;
  startSec: number;
  endSec: number;
  /** Transcript segments whose offset ∈ [startSec, endSec). */
  transcriptWindow: TranscriptSegment[];
  /** Section prose, or section.title when prose is blank. */
  summaryProse: string;
}

/**
 * Map one `ParsedSection` to a `SectionWindow`.
 *
 * Returns `null` when the section has no `timeRange` (not dig-enabled).
 *
 * Collision note (B7): when two sections share the same `startSec`, the section
 * at the next array index is used to determine `endSec`.  Both windows will
 * carry `endSec === startSec` for the first of the pair — callers should treat
 * an empty window as valid.
 *
 * @param section       The section to window.
 * @param allSections   All sections in order (the function locates `section` by
 *                      index, so ordering must be stable).
 * @param segments      Full transcript segment list for the video.
 * @param durationSeconds Total video duration in seconds (used as `endSec` for
 *                      the last section).
 */
export function windowForSection(
  section: ParsedSection,
  allSections: ParsedSection[],
  segments: TranscriptSegment[],
  durationSeconds: number,
): SectionWindow | null {
  if (!section.timeRange) return null;

  const startSec = section.timeRange.startSec;

  // Find the section's position by reference (handles duplicate startSec correctly).
  const idx = allSections.indexOf(section);
  const next = idx >= 0 ? allSections.slice(idx + 1).find((s) => s.timeRange != null) : undefined;
  const endSec = next?.timeRange?.startSec ?? durationSeconds;

  const transcriptWindow = segments.filter(
    (s) => s.offset >= startSec && s.offset < endSec,
  );

  const prose = section.prose.trim();
  const summaryProse = prose.length > 0 ? prose : section.title;

  return { sectionId: startSec, startSec, endSec, transcriptWindow, summaryProse };
}
