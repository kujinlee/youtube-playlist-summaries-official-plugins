import { z } from 'zod';

/** A section as parsed from the summary markdown (deterministic, pre-transform). */
export interface ParsedSection {
  numeral: string | null; // "1", "2", … or null (e.g. Conclusion)
  title: string;          // heading with any leading "N. " ordinal stripped
  prose: string;          // section body text (dividers removed)
}

/** Everything parsed from a summary .md without the LLM. */
export interface ParsedSummary {
  title: string;
  channel: string | null;
  duration: string | null;
  url: string | null;
  lang: 'EN' | 'KO' | string;
  videoId: string | null;
  tldr: string | null;
  takeaways: string[];        // [] when no callout
  sections: ParsedSection[];  // never empty (parser throws on zero sections)
  sourceMd: string | null;    // source filename (e.g. "a-title.md"); set by the orchestrator, null from the bare parser
}

/** Transformed bullet: a short label + the point text. */
export const BulletSchema = z.object({
  label: z.string().min(1),
  text: z.string().min(1),
});

/** One transformed section: lead sentence + 3–7 bullets. */
export const MagazineSectionSchema = z.object({
  lead: z.string().min(1),
  bullets: z.array(BulletSchema).min(3).max(7), // Codex HIGH: enforce the spec's 3–7, not 1–10
});

export const MagazineModelSchema = z.object({
  sections: z.array(MagazineSectionSchema).min(1),
}).strict();

export type Bullet = z.infer<typeof BulletSchema>;
export type MagazineSection = z.infer<typeof MagazineSectionSchema>;
export type MagazineModel = z.infer<typeof MagazineModelSchema>;
