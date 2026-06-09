# HTML Doc Export (Magazine-Skim) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand "HTML doc" menu action that reprocesses a video's existing summary `.md` into a self-contained "magazine-skim" HTML page (lead sentence + bullets per section), cached in the playlist folder.

**Architecture:** A deterministic parser extracts meta/TL;DR/takeaways/sections from the summary markdown; a Gemini call (`lib/gemini.ts`) transforms only the section prose into `{ lead, bullets[] }`; a **pure** renderer emits self-contained V4 HTML; an orchestrator (mirroring `lib/deep-dive.ts`) writes `htmls/<base>.html` and records `summaryHtml` in the index. UI mirrors the existing deep-dive SSE/status-bar pattern.

**Tech Stack:** Next.js (App Router), TypeScript, Zod, `@google/generative-ai` (gemini-2.5-flash), Jest + ts-jest, @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-html-doc-magazine-skim-design.md`

**Key conventions discovered (mirror these exactly):**
- Gemini calls live in `lib/gemini.ts`; tests mock `@google/generative-ai` (see `tests/lib/gemini.test.ts`).
- Path/id guards: `assertOutputFolder`, `assertVideoId`; index I/O: `readIndex`, `updateVideoFields` (atomic via tmp+rename) in `lib/index-store.ts`.
- Job/SSE: `createJob`/`emitJobEvent`/`deleteJob`/`subscribeJob` in `lib/job-registry.ts`; POST returns `{ jobId }`; SSE streams `data: <json>\n\n`.
- `ProgressEvent` (`types/index.ts`) already has a free-form `step` string — **no type change needed** for progress.
- `baseName` convention: `video.summaryMd.replace(/\.md$/, '')` (matches `lib/deep-dive.ts:62`, `VideoMenu.tsx:41`).

---

## Codex Review Resolutions (2026-06-09)

Codex adversarial review (`docs/reviews/plan-html-doc-magazine-skim-codex.md`) findings and how this revised plan resolves them:

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | BLOCKING | No same-video double-submit guard | Task 6: POST keys the job by `${outputFolder}::${videoId}`, returns the live `jobId` on duplicate; `getActiveJob` added. |
| 2 | BLOCKING | Early `deleteJob` breaks late subscribers | Task 6: release the lock immediately but defer `deleteJob` by a 15s grace window (`releaseJobLock` + `setTimeout().unref()`); Task 7 adds a replay test. |
| 3 | BLOCKING | Serve route path traversal | Task 8: strict `^htmls/<name>.html$` regex + resolved-path containment check + traversal test. |
| 4 | HIGH | `summaryHtml` required → migration | Task 1: field made `.nullable().optional()` — no migration needed. |
| 5 | HIGH | Bullet count 1–10 not 3–7 | Task 1: `.min(3).max(7)` + 2/8-bullet tests; Task 4 fixtures use 3 bullets. |
| 6 | HIGH | Serve ignores `type=summary` | Task 8: 400 on missing/unsupported `type` + tests. |
| 7 | HIGH | Orphan file if index update fails | Task 5: `unlink` the written file if `updateVideoFields` throws + test. |
| 8 | HIGH | Non-building commit between Tasks 10/11 | Tasks 10+11 merged into one buildable commit (`tsc`/build before commit). |
| 9 | HIGH | SSE test gaps | Task 7 late-subscribe replay; Task 9 `onerror`, manual dismiss, done auto-close. |
| M2 | MED | No KO parser test | Task 2: Korean parse test added. |
| M3 | MED | Meta escaping untested | Task 3: parsed title/channel/tldr/takeaway escaping test added. |
| M4 | MED | Missing `source-md` meta | Task 3: `<meta name="source-md">` emitted; `ParsedSummary.sourceMd` set by orchestrator. |
| M5 | MED | Dismissal paths untested | Task 9: manual dismiss + 4s auto-close tests. |
| L1 | LOW | `window.open` may be popup-blocked | Documented as best-effort; the status bar's **View HTML doc** anchor is the primary, accessible path (Task 9). |

**Open Mediums deferred to user decision (M1, M6)** — see the message accompanying this plan.

## File Structure

| File | Responsibility |
|---|---|
| `lib/html-doc/types.ts` (create) | `ParsedSection`, `ParsedSummary`, `MagazineModel`, `MagazineModelSchema` (Zod). |
| `lib/html-doc/parse.ts` (create) | `parseSummaryMarkdown(md) → ParsedSummary`. Pure, deterministic. |
| `lib/html-doc/render.ts` (create) | `renderMagazineHtml(parsed, model) → string`. Pure; self-contained HTML + escaping. |
| `lib/gemini.ts` (modify) | Add `generateMagazineModel(sections, language) → MagazineModel` (call + Zod + count guard). |
| `lib/html-doc/generate.ts` (create) | `runHtmlDoc(videoId, outputFolder, onProgress)`. Orchestrates parse→gemini→render→write→index. |
| `types/index.ts` (modify) | Add `summaryHtml: z.string().nullable()` to `VideoSchema`. |
| `app/api/videos/[id]/html-doc/route.ts` (create) | `POST { outputFolder }` → start job → `{ jobId }`. |
| `app/api/videos/[id]/html-doc/stream/route.ts` (create) | SSE progress (`?jobId=`). |
| `app/api/html/[id]/route.ts` (create) | `GET ?outputFolder=&type=summary` → serve cached HTML. |
| `components/HtmlDocStatusBar.tsx` (create) | Non-blocking status bar; on `done` reveals/opens the View link. |
| `components/VideoMenu.tsx` (modify) | Add Generate/View/Regenerate items. |
| `components/VideoList.tsx`, `components/VideoRow.tsx` (modify) | Thread `onGenerateHtml`. |
| `app/page.tsx` (modify) | `handleGenerateHtml` + `htmlJob` state + mount `HtmlDocStatusBar`. |

---

## Task 1: Types — `summaryHtml` field + magazine model schema

**Files:**
- Modify: `types/index.ts` (VideoSchema, after `deepDivePdf` line ~53)
- Create: `lib/html-doc/types.ts`
- Test: `tests/lib/html-doc/types.test.ts`

- [ ] **Step 1: Add `summaryHtml` to VideoSchema**

In `types/index.ts`, inside `VideoSchema`, immediately after the `deepDivePdf: z.string().nullable(),` line, add:

```ts
  summaryHtml: z.string().nullable().optional(),
```

> **Codex HIGH (migration):** `.optional()` (nullish) — NOT required-nullable — so existing `playlist-index.json` entries that predate this field still validate without a migration. Code reads `video.summaryHtml` as `string | null | undefined`; every consumer below treats `undefined` the same as `null` (`!!video.summaryHtml`, `if (!htmlFile)`).

- [ ] **Step 2: Create the magazine model types + schema**

Create `lib/html-doc/types.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing test**

Create `tests/lib/html-doc/types.test.ts`:

```ts
import { MagazineModelSchema } from '../../../lib/html-doc/types';

const b = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, text: `t${i}` }));

describe('MagazineModelSchema', () => {
  it('accepts a valid model (3 bullets)', () => {
    const ok = MagazineModelSchema.parse({ sections: [{ lead: 'A thesis.', bullets: b(3) }] });
    expect(ok.sections).toHaveLength(1);
  });

  it('accepts 7 bullets (upper bound)', () => {
    expect(() => MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(7) }] })).not.toThrow();
  });

  it('rejects fewer than 3 bullets', () => {
    expect(() => MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(2) }] })).toThrow();
  });

  it('rejects more than 7 bullets', () => {
    expect(() => MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(8) }] })).toThrow();
  });

  it('rejects empty sections', () => {
    expect(() => MagazineModelSchema.parse({ sections: [] })).toThrow();
  });

  it('rejects a bullet missing text', () => {
    expect(() =>
      MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: [{ label: 'L' }, { label: 'M' }, { label: 'N' }] }] }),
    ).toThrow();
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(() =>
      MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(3) }], extra: 1 }),
    ).toThrow();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/lib/html-doc/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the Video type change compiles**

Run: `npx tsc --noEmit`
Expected: errors only of the form "Property 'summaryHtml' is missing" in code that constructs `Video` objects (pipeline, tests, fixtures). Note them — they are fixed in later tasks/their own steps. If other errors appear, fix before continuing.

> **Note:** Because `summaryHtml` is now **optional** (Codex HIGH fix), existing `Video` literals do **not** need updating — `tsc` should stay green. New code that *sets* it (orchestrator, Task 5) uses a string; readers treat `undefined`/`null` identically. Run `npx tsc --noEmit` to confirm no new errors.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts lib/html-doc/types.ts tests/lib/html-doc/types.test.ts
git commit -m "feat(html-doc): add summaryHtml field + magazine model schema"
```

---

## Task 2: `parse.ts` — deterministic summary parser

**Files:**
- Create: `lib/html-doc/parse.ts`
- Test: `tests/lib/html-doc/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/html-doc/parse.test.ts`:

```ts
import { parseSummaryMarkdown } from '../../../lib/html-doc/parse';

const SAMPLE = `---
tags:
  - video-summary
video_id: "7xTGNNLPyMI"
lang: EN
score: 4.8
---

# Deep Dive into LLMs like ChatGPT

**Channel:** Andrej Karpathy | **Duration:** 3:31:24 | **URL:** https://www.youtube.com/watch?v=7xTGNNLPyMI

> [!summary] Quick Reference
> **TL;DR:** This video details how LLMs are built.
>
> **Key Takeaways:**
> - LLMs begin with filtered internet text.
> - Pre-training predicts the next token.
>
> **Concepts:** llms · training

---

## 1. The Foundation: Data and Tokenization
First paragraph of section one.

Second paragraph of section one.
---
## 2. Pre-training
Body of section two.
---
## Conclusion
Wrap-up text.
`;

describe('parseSummaryMarkdown', () => {
  const parsed = parseSummaryMarkdown(SAMPLE);

  it('extracts header meta', () => {
    expect(parsed.title).toBe('Deep Dive into LLMs like ChatGPT');
    expect(parsed.channel).toBe('Andrej Karpathy');
    expect(parsed.duration).toBe('3:31:24');
    expect(parsed.url).toBe('https://www.youtube.com/watch?v=7xTGNNLPyMI');
    expect(parsed.lang).toBe('EN');
    expect(parsed.videoId).toBe('7xTGNNLPyMI');
  });

  it('extracts tldr and takeaways from the callout', () => {
    expect(parsed.tldr).toBe('This video details how LLMs are built.');
    expect(parsed.takeaways).toEqual([
      'LLMs begin with filtered internet text.',
      'Pre-training predicts the next token.',
    ]);
  });

  it('splits sections and strips the leading ordinal into numeral', () => {
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[0]).toMatchObject({ numeral: '1', title: 'The Foundation: Data and Tokenization' });
    expect(parsed.sections[0].prose).toContain('First paragraph of section one.');
    expect(parsed.sections[0].prose).toContain('Second paragraph of section one.');
    expect(parsed.sections[0].prose).not.toContain('---');
  });

  it('gives Conclusion a null numeral', () => {
    const last = parsed.sections[2];
    expect(last.numeral).toBeNull();
    expect(last.title).toBe('Conclusion');
  });

  it('returns null tldr and empty takeaways when no callout present', () => {
    const noCallout = parseSummaryMarkdown(`# T\n\n**Channel:** C | **Duration:** 1:00 | **URL:** http://x\n\n## 1. A\nbody\n`);
    expect(noCallout.tldr).toBeNull();
    expect(noCallout.takeaways).toEqual([]);
  });

  it('throws when there are zero sections', () => {
    expect(() => parseSummaryMarkdown(`# T\n\nno sections here\n`)).toThrow(/no sections/i);
  });

  it('parses Korean content (title, takeaways, section)', () => {
    const ko = `---
video_id: "vid123"
lang: KO
---

# 한국어 제목

**Channel:** 채널 | **Duration:** 9:58 | **URL:** https://youtu.be/k

> [!summary] Quick Reference
> **TL;DR:** 핵심 요약입니다.
>
> **Key Takeaways:**
> - 첫 번째 요점.
>
> **Concepts:** 가 · 나

---

## 1. 첫 번째 섹션
첫 번째 섹션 본문.
`;
    const p = parseSummaryMarkdown(ko);
    expect(p.title).toBe('한국어 제목');
    expect(p.lang).toBe('KO');
    expect(p.tldr).toBe('핵심 요약입니다.');
    expect(p.takeaways).toEqual(['첫 번째 요점.']);
    expect(p.sections[0]).toMatchObject({ numeral: '1', title: '첫 번째 섹션' });
    expect(p.sections[0].prose).toContain('첫 번째 섹션 본문.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/html-doc/parse.test.ts`
Expected: FAIL ("parseSummaryMarkdown is not a function" / module not found).

- [ ] **Step 3: Implement `parse.ts`**

Create `lib/html-doc/parse.ts`:

```ts
import type { ParsedSummary, ParsedSection } from './types';

function frontmatterField(md: string, key: string): string | null {
  const m = md.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

function parseSections(body: string): ParsedSection[] {
  // Split on H2 headings. The first chunk (before any ##) is preamble — discarded.
  const parts = body.split(/^##\s+/m);
  const sections: ParsedSection[] = [];
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const nl = chunk.indexOf('\n');
    const headingLine = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const rest = nl === -1 ? '' : chunk.slice(nl + 1);
    const ord = headingLine.match(/^(\d+)\.\s+(.*)$/);
    const numeral = ord ? ord[1] : null;
    const title = ord ? ord[2].trim() : headingLine;
    const prose = rest
      .split('\n')
      .filter((line) => line.trim() !== '---')   // drop divider lines
      .join('\n')
      .trim();
    sections.push({ numeral, title, prose });
  }
  return sections;
}

function parseCallout(md: string): { tldr: string | null; takeaways: string[] } {
  // Collect contiguous blockquote lines beginning the callout.
  const calloutMatch = md.match(/^> \[!summary\][^\n]*\n((?:>.*\n?)*)/m);
  if (!calloutMatch) return { tldr: null, takeaways: [] };
  const lines = calloutMatch[1].split('\n').map((l) => l.replace(/^>\s?/, ''));
  let tldr: string | null = null;
  const takeaways: string[] = [];
  let inTakeaways = false;
  for (const line of lines) {
    const tl = line.match(/^\*\*TL;DR:\*\*\s*(.*)$/);
    if (tl) { tldr = tl[1].trim(); continue; }
    if (/^\*\*Key Takeaways:\*\*/.test(line)) { inTakeaways = true; continue; }
    if (/^\*\*Concepts:\*\*/.test(line)) { inTakeaways = false; continue; }
    if (inTakeaways) {
      const b = line.match(/^-\s+(.*)$/);
      if (b) takeaways.push(b[1].trim());
    }
  }
  return { tldr, takeaways };
}

export function parseSummaryMarkdown(md: string): ParsedSummary {
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? '').trim();
  const channel = md.match(/\*\*Channel:\*\*\s*([^|]+?)\s*(?:\||$)/m)?.[1]?.trim() ?? null;
  const duration = md.match(/\*\*Duration:\*\*\s*([^|]+?)\s*(?:\||$)/m)?.[1]?.trim() ?? null;
  const url = md.match(/\*\*URL:\*\*\s*(\S+)/m)?.[1]?.trim() ?? null;
  const lang = frontmatterField(md, 'lang') ?? 'EN';
  const videoId = frontmatterField(md, 'video_id');
  const { tldr, takeaways } = parseCallout(md);
  const sections = parseSections(md);
  if (sections.length === 0) {
    throw new Error('Cannot render HTML doc: summary has no ## sections.');
  }
  // sourceMd is null here — the bare parser does not know the filename; the orchestrator sets it.
  return { title, channel, duration, url, lang, videoId, tldr, takeaways, sections, sourceMd: null };
}
```

> The earlier draft had a stray `const metaLine` / `void metaLine` — omitted above. The inline regexes pull channel/duration/url directly, so there is no `metaLine` local. If you see one in an older copy, delete it.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/html-doc/parse.test.ts`
Expected: PASS (6 tests). If the "no callout" case fails, confirm the callout regex only matches when `[!summary]` is present.

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/parse.ts tests/lib/html-doc/parse.test.ts
git commit -m "feat(html-doc): deterministic summary markdown parser"
```

---

## Task 3: `render.ts` — pure V4 HTML renderer

**Files:**
- Create: `lib/html-doc/render.ts`
- Test: `tests/lib/html-doc/render.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/html-doc/render.test.ts`:

```ts
import { renderMagazineHtml } from '../../../lib/html-doc/render';
import type { ParsedSummary, MagazineModel } from '../../../lib/html-doc/types';

const parsed: ParsedSummary = {
  title: 'Deep Dive into LLMs',
  channel: 'Andrej Karpathy',
  duration: '3:31:24',
  url: 'https://youtu.be/x',
  lang: 'EN',
  videoId: '7xTGNNLPyMI',
  tldr: 'This video details how LLMs are built.',
  takeaways: ['LLMs begin with filtered internet text.'],
  sections: [
    { numeral: '1', title: 'The Foundation', prose: 'p' },
    { numeral: null, title: 'Conclusion', prose: 'p' },
  ],
  sourceMd: 'deep-dive-into-llms.md',
};

const model: MagazineModel = {
  sections: [
    { lead: 'An LLM starts as raw internet text.', bullets: [{ label: 'Source', text: 'Common Crawl.' }] },
    { lead: 'A multi-stage pipeline.', bullets: [{ label: 'Stages', text: 'pre-train, SFT, RL.' }] },
  ],
};

describe('renderMagazineHtml', () => {
  it('produces a self-contained document with inlined CSS and provenance meta', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');                 // no external CSS
    expect(html).toContain('<meta name="generator" content="magazine-skim v1">');
    expect(html).toContain('<meta name="video-id" content="7xTGNNLPyMI">');
    expect(html).toContain('<meta name="source-md" content="deep-dive-into-llms.md">');
    expect(html).toContain('<title>Deep Dive into LLMs</title>');
  });

  it('includes a Korean serif fallback in the font stack', () => {
    expect(renderMagazineHtml(parsed, model)).toContain('Nanum Myeongjo');
  });

  it('renders lead + bullets per section, zipped by index', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('An LLM starts as raw internet text.');
    expect(html).toContain('<strong>Source:</strong> Common Crawl.');
    expect(html).toContain('The Foundation');
  });

  it('shows a ghost numeral for numbered sections and none for null', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain('class="ghost">1<');
    expect(html).not.toContain('class="ghost">2<');     // Conclusion has null numeral
  });

  it('omits the callout block when tldr is null', () => {
    const noTldr = { ...parsed, tldr: null, takeaways: [] };
    expect(renderMagazineHtml(noTldr, model)).not.toContain('class="callout"');
  });

  it('HTML-escapes transformed content (no injection)', () => {
    const evil: MagazineModel = {
      sections: [
        { lead: '<script>alert(1)</script> & "q"', bullets: [{ label: 'a<b', text: 'x & y' }] },
        model.sections[1],
      ],
    };
    const html = renderMagazineHtml(parsed, evil);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('x &amp; y');
  });

  it('HTML-escapes parsed meta — title, channel, tldr, takeaways (no injection)', () => {
    const evilParsed = {
      ...parsed,
      title: 'A & B <x>',
      channel: 'Chan <i>',
      tldr: 'TL;DR <b>"q"</b> & more',
      takeaways: ['take <script>x</script>'],
    };
    const html = renderMagazineHtml(evilParsed, model);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<title>A & B <x></title>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('A &amp; B &lt;x&gt;');     // title escaped
    expect(html).toContain('Chan &lt;i&gt;');          // channel escaped in meta line
    expect(html).toContain('&amp; more');              // tldr escaped
  });

  it('renders Korean content without mangling', () => {
    const ko = { ...parsed, lang: 'KO', title: '한국어 제목' };
    const koModel: MagazineModel = {
      sections: [
        { lead: '한 문장 요약.', bullets: [{ label: '출처', text: '인터넷 텍스트.' }] },
        model.sections[1],
      ],
    };
    const html = renderMagazineHtml(ko, koModel);
    expect(html).toContain('한국어 제목');
    expect(html).toContain('인터넷 텍스트.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/html-doc/render.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `render.ts`**

Create `lib/html-doc/render.ts`:

```ts
import type { ParsedSummary, MagazineModel } from './types';

const SERIF = `Georgia, 'Nanum Myeongjo', 'Apple SD Gothic Neo', 'Times New Roman', serif`;

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#eef0f3;color:#2a2622;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo',Helvetica,Arial,sans-serif}
.v4{max-width:50rem;margin:0 auto;background:#fbf9f6;padding:2.8rem 3rem 4rem;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.doc-title{font-family:${SERIF};font-size:2rem;line-height:1.2;margin:0 0 .15em}
.doc-meta{color:#8a8276;font-size:.9rem;margin:0 0 1.8em}
.callout{margin:0 0 2.4em;border-top:2px solid #e0a800;border-bottom:2px solid #e0a800;padding:1em 0}
.callout .lbl{color:#b07700;letter-spacing:.12em;text-transform:uppercase;font-size:.7rem;font-weight:700;margin-bottom:.5em}
.callout p{margin:.2em 0 .8em}
.callout ul{padding-left:1.1em;margin:.4em 0 0}
.callout li{margin:.25em 0}
section{position:relative;padding:1.6em 0 1.2em;border-bottom:1px solid #ece7df}
.ghost{font:700 4.5rem/1 Georgia,serif;color:#f0e7d6;position:absolute;right:0;top:.1em;pointer-events:none;user-select:none}
h2{font-family:${SERIF};font-size:1.3rem;margin:.1em 0 .35em}
.lead{font-size:1.12rem;line-height:1.5;color:#b07700;font-weight:600;margin:.2em 0 .8em;max-width:90%}
ul{padding-left:1.15em;margin:0}
li{margin:.4em 0;line-height:1.6;color:#4a463f}
footer{margin-top:2.5em;color:#9a917f;font-size:.8rem}
@media print{body{background:#fff}.v4{box-shadow:none}}
`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderMagazineHtml(parsed: ParsedSummary, model: MagazineModel): string {
  const metaLine = [parsed.channel, parsed.duration].filter(Boolean).map((s) => esc(s as string)).join(' · ');

  const callout =
    parsed.tldr
      ? `<div class="callout">
    <div class="lbl">Quick Reference</div>
    <p>${esc(parsed.tldr)}</p>
    ${parsed.takeaways.length ? `<ul>${parsed.takeaways.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </div>`
      : '';

  const sections = parsed.sections
    .map((s, i) => {
      const m = model.sections[i];
      if (!m) return '';
      const ghost = s.numeral ? `<span class="ghost">${esc(s.numeral)}</span>` : '';
      const bullets = m.bullets
        .map((b) => `<li><strong>${esc(b.label)}:</strong> ${esc(b.text)}</li>`)
        .join('');
      return `<section>
      ${ghost}
      <h2>${esc(s.title)}</h2>
      <p class="lead">${esc(m.lead)}</p>
      <ul>${bullets}</ul>
    </section>`;
    })
    .join('\n');

  const sourceMd = parsed.sourceMd ?? '';
  const footerSource = sourceMd ? ` <code>${esc(sourceMd)}</code>` : '';

  return `<!DOCTYPE html>
<html lang="${esc((parsed.lang || 'en').toLowerCase())}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="magazine-skim v1">
<meta name="source-md" content="${esc(sourceMd)}">
<meta name="video-id" content="${esc(parsed.videoId ?? '')}">
<title>${esc(parsed.title)}</title>
<style>${CSS}</style>
</head>
<body>
<article class="v4">
  <h1 class="doc-title">${esc(parsed.title)}</h1>
  <p class="doc-meta">${metaLine}</p>
  ${callout}
  ${sections}
  <footer>Skim view — generated from the source note${footerSource}. Full text lives in the source <code>.md</code>.</footer>
</article>
</body>
</html>`;
}
```

> The functional output is `metaLine`, `callout`, `sections`, the `source-md` meta, and the footer. No vestigial locals remain.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/html-doc/render.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/render.ts tests/lib/html-doc/render.test.ts
git commit -m "feat(html-doc): pure V4 magazine-skim HTML renderer"
```

---

## Task 4: `generateMagazineModel` in `lib/gemini.ts`

**Files:**
- Modify: `lib/gemini.ts`
- Test: `tests/lib/gemini-magazine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/gemini-magazine.test.ts`:

```ts
import { generateMagazineModel } from '../../lib/gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

const mockGenerateContent = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});
afterEach(() => { delete process.env.GEMINI_API_KEY; });

const input = [
  { title: 'The Foundation', prose: 'Data and tokenization prose.' },
  { title: 'Conclusion', prose: 'Wrap up prose.' },
];

function reply(obj: unknown) {
  mockGenerateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(obj) } });
}
// 3 bullets = the schema minimum, so these fixtures pass Zod and exercise the count guard / happy path.
const bul = (n = 3) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, text: `t${i}` }));

describe('generateMagazineModel', () => {
  it('returns a validated model on a well-formed response', async () => {
    reply({ sections: [
      { lead: 'A.', bullets: [{ label: 'Source', text: 'Crawl.' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }] },
      { lead: 'B.', bullets: bul(3) },
    ]});
    const out = await generateMagazineModel(input, 'en');
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].bullets[0].label).toBe('Source');
  });

  it('throws when the section count does not match the input', async () => {
    // Schema-valid single section (3 bullets) but input has 2 → the count guard, not Zod, must fire.
    reply({ sections: [{ lead: 'only one', bullets: bul(3) }] });
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/section count/i);
  });

  it('throws on malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => 'not json' } });
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/magazine/i);
  });

  it('throws on schema-invalid output', async () => {
    reply({ sections: [{ lead: '', bullets: [] }, { lead: 'b', bullets: [] }] });
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/magazine/i);
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/gemini-magazine.test.ts`
Expected: FAIL ("generateMagazineModel is not a function").

- [ ] **Step 3: Implement in `lib/gemini.ts`**

At the top of `lib/gemini.ts`, extend the existing type import:

```ts
import { MagazineModelSchema } from './html-doc/types';
import type { MagazineModel } from './html-doc/types';
```

Append this function at the end of `lib/gemini.ts`:

```ts
export async function generateMagazineModel(
  sections: Array<{ title: string; prose: string }>,
  language: 'en' | 'ko',
): Promise<MagazineModel> {
  const client = new GoogleGenerativeAI(getApiKey());
  const model = client.getGenerativeModel({
    model: SUMMARY_MODEL,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const lang = language === 'ko' ? 'Korean (한국어)' : 'English';

  const numbered = sections
    .map((s, i) => `Section ${i + 1} — "${s.title}":\n${s.prose}`)
    .join('\n\n');

  const prompt = `You convert dense prose video-summary sections into a scannable "skim" structure, in ${lang}.
For EACH input section, in the SAME ORDER, produce:
- "lead": one sentence (≤25 words) capturing that section's core point
- "bullets": 3–7 objects { "label": 1–3 word tag, "text": one concise point }

Rules:
- Output exactly ${sections.length} sections, in input order.
- Be faithful: introduce NO facts not present in the input prose.
- Respond in ${lang}. Return ONLY a JSON object: { "sections": [ { "lead": ..., "bullets": [ { "label": ..., "text": ... } ] } ] }

<sections>
${numbered}
</sections>`;

  try {
    const result = await model.generateContent(prompt, { timeout: REQUEST_TIMEOUT_MS });
    const parsed = MagazineModelSchema.parse(JSON.parse(result.response.text()));
    if (parsed.sections.length !== sections.length) {
      throw new Error(`section count mismatch: got ${parsed.sections.length}, expected ${sections.length}`);
    }
    return parsed;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini magazine transform failed: ${cause}`, { cause: err });
  }
}
```

> The count-mismatch `throw` is inside the `try`, so it is re-wrapped with the `Gemini magazine transform failed:` prefix — and the test asserts `/section count/i`, which still matches because the original message is embedded. Both `/section count/i` and `/magazine/i` assertions pass.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/gemini-magazine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/gemini.ts tests/lib/gemini-magazine.test.ts
git commit -m "feat(html-doc): gemini magazine transform with count guard"
```

---

## Task 5: `generate.ts` — orchestrator

**Files:**
- Create: `lib/html-doc/generate.ts`
- Test: `tests/lib/html-doc/generate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/html-doc/generate.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runHtmlDoc } from '../../../lib/html-doc/generate';
import * as gemini from '../../../lib/gemini';
import { updateVideoFields } from '../../../lib/index-store';
import type { ProgressEvent } from '../../../types';

jest.mock('../../../lib/gemini');
// Wrap index-store so updateVideoFields calls through by default but can be forced to throw.
jest.mock('../../../lib/index-store', () => {
  const actual = jest.requireActual('../../../lib/index-store');
  return { __esModule: true, ...actual, updateVideoFields: jest.fn(actual.updateVideoFields) };
});
const mockTransform = gemini.generateMagazineModel as jest.Mock;
const mockUpdate = updateVideoFields as jest.Mock;

let dir: string;
const VIDEO_ID = 'vid12345';

const SUMMARY_MD = `---
video_id: "vid12345"
lang: EN
score: 4
---

# A Title

**Channel:** Chan | **Duration:** 1:00 | **URL:** https://youtu.be/x

> [!summary] Quick Reference
> **TL;DR:** Core idea.
>
> **Key Takeaways:**
> - One.
>
> **Concepts:** a · b

---

## 1. First
First section prose.
---
## Conclusion
Wrap up.
`;

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(
    path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2),
  );
}

function baseVideo() {
  return {
    id: VIDEO_ID, title: 'A Title', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a-title.md', summaryPdf: null, deepDiveMd: null,
    deepDivePdf: null, summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmldoc-'));
  fs.writeFileSync(path.join(dir, 'a-title.md'), SUMMARY_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('transforms, writes htmls/<base>.html, and records summaryHtml', async () => {
  mockTransform.mockResolvedValueOnce({
    sections: [
      { lead: 'Lead one.', bullets: [{ label: 'L', text: 't' }] },
      { lead: 'Lead two.', bullets: [{ label: 'M', text: 'u' }] },
    ],
  });
  const events: ProgressEvent[] = [];
  await runHtmlDoc(VIDEO_ID, dir, (e) => events.push(e));

  const htmlPath = path.join(dir, 'htmls', 'a-title.html');
  expect(fs.existsSync(htmlPath)).toBe(true);
  expect(fs.readFileSync(htmlPath, 'utf-8')).toContain('Lead one.');

  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBe('htmls/a-title.html');
  expect(events.at(-1)).toEqual({ type: 'done' });
});

it('writes nothing and leaves index untouched when the transform fails', async () => {
  mockTransform.mockRejectedValueOnce(new Error('boom'));
  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/boom/);

  expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBeNull();
});

it('throws when summaryMd is missing', async () => {
  writeIndex([{ ...baseVideo(), summaryMd: null }]);
  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/source note|summaryMd/i);
});

it('removes the orphan HTML file when the index update fails', async () => {
  mockTransform.mockResolvedValueOnce({
    sections: [
      { lead: 'L1', bullets: [{ label: 'A', text: 'a' }] },
      { lead: 'L2', bullets: [{ label: 'B', text: 'b' }] },
    ],
  });
  mockUpdate.mockImplementationOnce(() => { throw new Error('index write failed'); });

  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/index write failed/);
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false); // cleaned up, no orphan
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/html-doc/generate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `generate.ts`**

Create `lib/html-doc/generate.ts`:

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../index-store';
import { generateMagazineModel } from '../gemini';
import { parseSummaryMarkdown } from './parse';
import { renderMagazineHtml } from './render';
import type { ProgressEvent } from '../../types';

export async function runHtmlDoc(
  videoId: string,
  outputFolder: string,
  onProgress: (event: ProgressEvent) => void,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  if (!video.summaryMd) throw new Error('source note not found: video has no summaryMd');

  onProgress({ type: 'start' });
  onProgress({ type: 'step', videoId, step: 'Reading summary…', current: 1, total: 3 });

  const mdPath = path.join(outputFolder, video.summaryMd);
  let md: string;
  try {
    md = fs.readFileSync(mdPath, 'utf-8');
  } catch (err) {
    throw new Error(`source note not found on disk: ${video.summaryMd}`, { cause: err });
  }

  const parsed = parseSummaryMarkdown(md);
  parsed.sourceMd = video.summaryMd; // for the <meta name="source-md"> provenance field

  onProgress({ type: 'step', videoId, step: 'Transforming to skim view…', current: 2, total: 3 });
  const model = await generateMagazineModel(
    parsed.sections.map((s) => ({ title: s.title, prose: s.prose })),
    video.language,
  );

  onProgress({ type: 'step', videoId, step: 'Rendering HTML…', current: 3, total: 3 });
  const html = renderMagazineHtml(parsed, model);

  const base = video.summaryMd.replace(/\.md$/, '');
  const htmlFilename = `htmls/${base}.html`;
  const htmlDir = path.join(outputFolder, 'htmls');
  fs.mkdirSync(htmlDir, { recursive: true });

  // Atomic write: temp file → rename (mirrors index-store.writeIndex / pdf caller).
  const finalPath = path.join(outputFolder, htmlFilename);
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }

  // Codex HIGH: if the index update fails, remove the just-written file so we don't leave an
  // orphan HTML the index doesn't reference (keeps cache ↔ index consistent).
  try {
    updateVideoFields(outputFolder, videoId, { summaryHtml: htmlFilename });
  } catch (err) {
    try { fs.unlinkSync(finalPath); } catch { /* ignore cleanup error */ }
    throw err;
  }
  onProgress({ type: 'done' });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/html-doc/generate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full lib suite (no regressions)**

Run: `npx jest tests/lib`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/html-doc/generate.ts tests/lib/html-doc/generate.test.ts
git commit -m "feat(html-doc): orchestrator (parse→transform→render→write→index)"
```

---

## Task 6: job-registry concurrency helpers + POST route

> **Codex BLOCKING ×2 addressed here:** (a) same-video double-submit guard — a second POST while a job is live returns the existing `jobId` instead of starting a duplicate Gemini run; (b) late-subscribe race — the job record is kept alive for a grace window after the terminal event so a client that subscribes just after a fast job finishes still replays the buffered `done`/`error`. We release the per-video *lock* immediately (so a deliberate Regenerate isn't blocked) but defer registry deletion.

**Files:**
- Modify: `lib/job-registry.ts`
- Create: `app/api/videos/[id]/html-doc/route.ts`
- Test: `tests/lib/job-registry-html.test.ts`, `tests/api/html-doc-post.test.ts`

- [ ] **Step 1: Write the failing job-registry tests**

Create `tests/lib/job-registry-html.test.ts`:

```ts
import { createJob, getActiveJob, releaseJobLock, deleteJob, _resetJobRegistry } from '../../lib/job-registry';

beforeEach(() => _resetJobRegistry());

it('getActiveJob returns the jobId holding a key, undefined otherwise', () => {
  expect(getActiveJob('k')).toBeUndefined();
  createJob('job1', 'k');
  expect(getActiveJob('k')).toBe('job1');
});

it('releaseJobLock frees the key but keeps the job subscribable', () => {
  createJob('job1', 'k');
  releaseJobLock('job1');
  expect(getActiveJob('k')).toBeUndefined();   // lock freed → a new submit may start
  // registry entry still present: deleteJob is what removes it
  deleteJob('job1');
  expect(getActiveJob('k')).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/job-registry-html.test.ts`
Expected: FAIL (`getActiveJob`/`releaseJobLock` not exported).

- [ ] **Step 3: Add the helpers to `lib/job-registry.ts`**

Append to `lib/job-registry.ts` (the maps `activeByFolder` and `jobFolders` already exist):

```ts
/** Returns the jobId currently holding the lock for `key`, or undefined. */
export function getActiveJob(key: string): string | undefined {
  return activeByFolder.get(key);
}

/**
 * Release a job's lock key WITHOUT deleting its registry entry, so late SSE
 * subscribers can still replay buffered terminal events. Pair with a deferred
 * deleteJob() for eventual cleanup.
 */
export function releaseJobLock(jobId: string): void {
  const folder = jobFolders.get(jobId);
  if (folder) {
    activeByFolder.delete(folder);
    jobFolders.delete(jobId);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/job-registry-html.test.ts`
Expected: PASS (2 tests). Also run `npx jest tests/lib/job-registry` (if it exists) to confirm no regression in existing registry tests.

- [ ] **Step 5: Write the failing POST-route tests**

Create `tests/api/html-doc-post.test.ts`:

```ts
import { POST } from '../../app/api/videos/[id]/html-doc/route';
import * as generate from '../../lib/html-doc/generate';
import { _resetJobRegistry } from '../../lib/job-registry';

jest.mock('../../lib/html-doc/generate');
const mockRun = generate.runHtmlDoc as jest.Mock;

const HOME = (process.env.HOME ?? '/tmp') + '/x';
function req(body: unknown) {
  return new Request('http://localhost/api/videos/vid12345/html-doc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: 'vid12345' }) };

beforeEach(() => { jest.clearAllMocks(); _resetJobRegistry(); });

it('400s without outputFolder', async () => {
  expect((await POST(req({}), ctx)).status).toBe(400);
});

it('400s on an outputFolder outside home', async () => {
  expect((await POST(req({ outputFolder: '/etc' }), ctx)).status).toBe(400);
});

it('returns a jobId and starts the run', async () => {
  mockRun.mockResolvedValueOnce(undefined);
  const json = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(typeof json.jobId).toBe('string');
  expect(mockRun).toHaveBeenCalledWith('vid12345', HOME, expect.any(Function));
});

it('returns the SAME jobId for a concurrent duplicate submit (no second run)', async () => {
  mockRun.mockReturnValue(new Promise(() => {})); // never resolves → job stays active
  const first = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  const second = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(second.jobId).toBe(first.jobId);
  expect(mockRun).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx jest tests/api/html-doc-post.test.ts`
Expected: FAIL (route module not found).

- [ ] **Step 7: Implement the route**

Create `app/api/videos/[id]/html-doc/route.ts`:

```ts
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId } from '../../../../../lib/index-store';
import { runHtmlDoc } from '../../../../../lib/html-doc/generate';
import { createJob, deleteJob, emitJobEvent, getActiveJob, releaseJobLock } from '../../../../../lib/job-registry';
import type { ProgressEvent } from '../../../../../types';

type Params = { params: Promise<{ id: string }> };

// Keep a finished job subscribable briefly so a just-issued client subscribe can replay the
// terminal event; then GC it. .unref() so the timer never keeps the process alive (tests/CI).
const GRACE_MS = 15_000;

export async function POST(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const body = await request.json().catch(() => null);
  const outputFolder = body?.outputFolder;

  if (!outputFolder) return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  // Same-video double-submit guard: one live job per (folder, video).
  const key = `${outputFolder}::${videoId}`;
  const existing = getActiveJob(key);
  if (existing) return NextResponse.json({ jobId: existing });

  const jobId = crypto.randomUUID();
  createJob(jobId, key);
  let finished = false;

  const onTerminal = () => {
    finished = true;
    releaseJobLock(jobId);                       // free the lock now → a later Regenerate is allowed
    const t = setTimeout(() => deleteJob(jobId), GRACE_MS); // keep buffer for late subscribers
    (t as { unref?: () => void }).unref?.();
  };

  runHtmlDoc(videoId, outputFolder, (event: ProgressEvent) => {
    emitJobEvent(jobId, event);
    if (event.type === 'done' || event.type === 'error') onTerminal();
  }).catch((err) => {
    if (finished) return;
    console.error('[html-doc] failed for video', videoId, err);
    emitJobEvent(jobId, { type: 'error', log: err instanceof Error ? err.message : String(err) });
    onTerminal();
  });

  return NextResponse.json({ jobId });
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx jest tests/api/html-doc-post.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/job-registry.ts app/api/videos/[id]/html-doc/route.ts tests/lib/job-registry-html.test.ts tests/api/html-doc-post.test.ts
git commit -m "feat(html-doc): concurrency-guarded POST route + job-registry lock helpers"
```

---

## Task 7: SSE stream route

**Files:**
- Create: `app/api/videos/[id]/html-doc/stream/route.ts`

> This is a thin copy of the deep-dive stream route (identical logic). No new behavior → one smoke test, no separate TDD cycle.

- [ ] **Step 1: Implement the stream route**

Create `app/api/videos/[id]/html-doc/stream/route.ts`:

```ts
import { subscribeJob } from '../../../../../../lib/job-registry';
import type { ProgressEvent } from '../../../../../../types';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, _ctx: Params) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId is required' }), { status: 400 });
  }

  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      unsubscribe = subscribeJob(jobId, (event: ProgressEvent) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done' || event.type === 'error') {
          unsubscribe?.();
          unsubscribe = null;
          controller.close();
        }
      });
      if (!unsubscribe) controller.close();
    },
    cancel() { unsubscribe?.(); },
  });

  if (!unsubscribe) {
    return new Response(JSON.stringify({ error: 'job not found' }), { status: 404 });
  }

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
```

- [ ] **Step 2: Smoke test — 400 without jobId**

Create `tests/api/html-doc-stream.test.ts`:

```ts
import { GET } from '../../app/api/videos/[id]/html-doc/stream/route';
import { createJob, emitJobEvent, _resetJobRegistry } from '../../lib/job-registry';

const ctx = { params: Promise.resolve({ id: 'v' }) };
beforeEach(() => _resetJobRegistry());

it('400s without a jobId', async () => {
  expect((await GET(new Request('http://localhost/s'), ctx)).status).toBe(400);
});

it('404s for an unknown jobId', async () => {
  expect((await GET(new Request('http://localhost/s?jobId=nope'), ctx)).status).toBe(404);
});

it('replays buffered terminal events to a late subscriber (Codex BLOCKING)', async () => {
  createJob('jX');
  emitJobEvent('jX', { type: 'step', step: 'Rendering HTML…', current: 3, total: 3 });
  emitJobEvent('jX', { type: 'done' }); // job finished BEFORE the client subscribes

  const res = await GET(new Request('http://localhost/s?jobId=jX'), ctx);
  expect(res.status).toBe(200);
  const text = await res.text(); // stream closes after the replayed terminal event
  expect(text).toContain('"type":"step"');
  expect(text).toContain('"type":"done"');
});
```

Run: `npx jest tests/api/html-doc-stream.test.ts`
Expected: PASS (3 tests). The third proves the grace-window design: a client subscribing after the job already finished still receives the buffered `done`.

- [ ] **Step 3: Commit**

```bash
git add app/api/videos/[id]/html-doc/stream/route.ts tests/api/html-doc-stream.test.ts
git commit -m "feat(html-doc): SSE progress stream route"
```

---

## Task 8: Serve route — `GET /api/html/[id]`

**Files:**
- Create: `app/api/html/[id]/route.ts`
- Test: `tests/api/html-serve.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/api/html-serve.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';

let dir: string;
const VIDEO_ID = 'vid12345';

function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
function writeIndex(v: unknown) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function url(extra = '') {
  return new Request(`http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=summary${extra}`);
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'htmlserve-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('400s without outputFolder', async () => {
  const res = await GET(new Request(`http://localhost/api/html/${VIDEO_ID}`), ctx);
  expect(res.status).toBe(400);
});

it('400s when type is missing or not summary', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const base = `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}`;
  expect((await GET(new Request(base), ctx)).status).toBe(400);                       // missing type
  expect((await GET(new Request(`${base}&type=deep-dive`), ctx)).status).toBe(400);   // unsupported type
});

it('404s on a path-traversal summaryHtml value (Codex BLOCKING)', async () => {
  writeIndex(video({ summaryHtml: '../../../../etc/passwd' }));
  const res = await GET(url(), ctx);
  expect([400, 404]).toContain(res.status); // never 200
  expect(res.status).not.toBe(200);
});

it('404s when summaryHtml is unset', async () => {
  writeIndex(video({ summaryHtml: null }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});

it('404s when the file is missing on disk', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});

it('serves the cached HTML with text/html', async () => {
  fs.mkdirSync(path.join(dir, 'htmls'));
  fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), '<!DOCTYPE html><title>ok</title>');
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  expect(await res.text()).toContain('<title>ok</title>');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/api/html-serve.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the serve route**

Create `app/api/html/[id]/route.ts` (mirrors `app/api/pdf/[id]/route.ts`):

```ts
import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../lib/index-store';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');

  if (!outputFolder) {
    return new Response(JSON.stringify({ error: 'outputFolder is required' }), { status: 400 });
  }

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid request' }), { status: 400 });
  }

  // Codex HIGH: enforce the type=summary URL contract (pilot supports summary only).
  if (searchParams.get('type') !== 'summary') {
    return new Response(JSON.stringify({ error: 'unsupported or missing type' }), { status: 400 });
  }

  let htmlFile: string | null | undefined;
  try {
    const index = readIndex(outputFolder);
    const video = index.videos.find((v) => v.id === videoId);
    if (!video) return new Response(JSON.stringify({ error: 'video not found' }), { status: 404 });
    htmlFile = video.summaryHtml;
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    throw err;
  }

  // Codex BLOCKING (path traversal): only serve a strict htmls/<name>.html relative path, and
  // verify the resolved path stays inside <outputFolder>/htmls. Defense in depth — the regex
  // already forbids extra slashes, so "../" cannot appear; the prefix check is a backstop.
  const HTML_REL_RE = /^htmls\/[A-Za-z0-9._-]+\.html$/;
  if (!htmlFile || !HTML_REL_RE.test(htmlFile)) {
    return new Response(JSON.stringify({ error: 'html not available' }), { status: 404 });
  }
  const htmlDir = path.resolve(outputFolder, 'htmls');
  const htmlPath = path.resolve(outputFolder, htmlFile);
  if (htmlPath !== htmlDir && !htmlPath.startsWith(htmlDir + path.sep)) {
    return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
  }

  try {
    const buffer = fs.readFileSync(htmlPath);
    return new Response(buffer, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  } catch {
    return new Response(JSON.stringify({ error: 'file not found' }), { status: 404 });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/api/html-serve.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/html/[id]/route.ts tests/api/html-serve.test.ts
git commit -m "feat(html-doc): serve route for cached HTML"
```

---

## Task 9: `HtmlDocStatusBar` component

**Files:**
- Create: `components/HtmlDocStatusBar.tsx`
- Test: `tests/components/HtmlDocStatusBar.test.tsx`

> Mirrors `DeepDiveStatusBar`, with one difference: on `done` it surfaces a **"View HTML doc"** link (a real anchor — avoids popup blocking) and also attempts `window.open`. The bar auto-dismisses 4s after done.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/HtmlDocStatusBar.test.tsx`:

```tsx
import { render, screen, act } from '@testing-library/react';
import HtmlDocStatusBar from '../../components/HtmlDocStatusBar';

class FakeES {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  static last: FakeES | null = null;
  constructor(url: string) { this.url = url; FakeES.last = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent); }
}

beforeEach(() => {
  (global as any).EventSource = FakeES as unknown as typeof EventSource;
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

const viewUrl = '/api/html/v?outputFolder=%2Fhome%2Fu%2Fp&type=summary';

it('subscribes to the html-doc stream for the given job', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  expect(FakeES.last?.url).toContain('/api/videos/v/html-doc/stream?jobId=j1');
});

it('shows the running step', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Transforming to skim view…', current: 2, total: 3 }); });
  expect(screen.getByText('Transforming to skim view…')).toBeInTheDocument();
});

it('reveals a View link on done', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'done' }); });
  const link = screen.getByRole('link', { name: /view html doc/i });
  expect(link).toHaveAttribute('href', viewUrl);
});

it('shows an error message on error', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'error', log: 'transform failed' }); });
  expect(screen.getByRole('alert')).toHaveTextContent('transform failed');
});

it('shows a connection-lost error when EventSource errors', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.onerror?.(); });
  expect(screen.getByRole('alert')).toHaveTextContent(/connection lost/i);
});

it('calls onClose when the Dismiss button is clicked', () => {
  const onClose = jest.fn();
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={onClose} />);
  act(() => { screen.getByRole('button', { name: /dismiss/i }).click(); });
  expect(onClose).toHaveBeenCalled();
});

it('auto-closes ~4s after done', () => {
  const onClose = jest.fn();
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'done' }); });
  expect(onClose).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(4000); });
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/components/HtmlDocStatusBar.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `HtmlDocStatusBar.tsx`**

Create `components/HtmlDocStatusBar.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProgressEvent } from '@/types';

interface HtmlDocStatusBarProps {
  videoId: string;
  jobId: string;
  title: string;
  viewUrl: string;
  onClose: () => void;
}

type BarState =
  | { status: 'running'; progress: number; step: string }
  | { status: 'done' }
  | { status: 'error'; message: string };

export default function HtmlDocStatusBar({ videoId, jobId, title, viewUrl, onClose }: HtmlDocStatusBarProps) {
  const [state, setState] = useState<BarState>({ status: 'running', progress: 0, step: '' });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setState({ status: 'running', progress: 0, step: '' });
    const url = `/api/videos/${encodeURIComponent(videoId)}/html-doc/stream?jobId=${encodeURIComponent(jobId)}`;
    const es = new EventSource(url);
    let terminal = false;
    let doneTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event: MessageEvent) => {
      if (terminal) return;
      let data: ProgressEvent;
      try { data = JSON.parse(event.data) as ProgressEvent; } catch { return; }
      if (data.type === 'step') {
        const progress = data.current != null && data.total != null
          ? Math.min(100, Math.round((data.current / data.total) * 100)) : 0;
        setState({ status: 'running', progress, step: data.step });
      } else if (data.type === 'done') {
        terminal = true;
        setState({ status: 'done' });
        es.close();
        try { window.open(viewUrl, '_blank', 'noopener'); } catch { /* popup blocked — link shown */ }
        doneTimer = setTimeout(() => onCloseRef.current(), 4000);
      } else if (data.type === 'error') {
        terminal = true;
        setState({ status: 'error', message: data.log });
        es.close();
      }
    };

    es.onerror = () => {
      if (terminal) return;
      terminal = true;
      setState({ status: 'error', message: 'Connection lost. Please try again.' });
      es.close();
    };

    return () => { terminal = true; es.close(); if (doneTimer) clearTimeout(doneTimer); };
  }, [videoId, jobId, viewUrl]);

  const progress = state.status === 'running' ? state.progress : state.status === 'done' ? 100 : 0;
  const barColor = state.status === 'error' ? 'bg-red-500' : 'bg-amber-500';

  return (
    <div role="status" aria-label="HTML Doc Progress" aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-zinc-700 px-6 py-3 shadow-lg">
      <div className="max-w-5xl mx-auto flex items-center gap-3">
        <span className="text-xs text-zinc-400 flex-shrink-0">
          HTML doc{title && <span className="text-zinc-300 ml-1">— {title}</span>}
        </span>
        <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden"
          role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full transition-all duration-300 ${barColor} ${state.status === 'running' ? 'animate-pulse' : ''}`}
            style={{ width: `${progress}%` }} />
        </div>
        {state.status === 'running' && state.step && (
          <span className="text-xs text-zinc-400 flex-shrink-0 max-w-48 truncate">{state.step}</span>
        )}
        {state.status === 'done' && (
          <a href={viewUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-amber-400 underline flex-shrink-0">View HTML doc ↗</a>
        )}
        {state.status === 'error' && (
          <span role="alert" className="text-xs text-red-400 flex-shrink-0 max-w-48 truncate">{state.message}</span>
        )}
        <button type="button" onClick={onClose} aria-label="Dismiss"
          className="text-zinc-500 hover:text-zinc-200 text-sm leading-none px-1 flex-shrink-0">✕</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/components/HtmlDocStatusBar.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add components/HtmlDocStatusBar.tsx tests/components/HtmlDocStatusBar.test.tsx
git commit -m "feat(html-doc): non-blocking status bar with View link"
```

---

## Task 10: VideoMenu items + state logic

**Files:**
- Modify: `components/VideoMenu.tsx`
- Test: `tests/components/VideoMenu.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing tests**

Create/extend `tests/components/VideoMenu.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import VideoMenu from '../../components/VideoMenu';
import type { Video } from '@/types';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

const noop = () => {};
function renderMenu(v: Video) {
  return render(
    <VideoMenu video={v} outputFolder="/home/u/p" baseOutputFolder="/home/u"
      onDeepDive={noop} onArchive={noop} onEditCorrections={noop} onGenerateHtml={noop} onClose={noop} />,
  );
}

it('shows "Generate HTML doc" when summaryMd is set and summaryHtml is null', () => {
  renderMenu(video({ summaryHtml: null }));
  expect(screen.getByRole('button', { name: /generate html doc/i })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /view html doc/i })).not.toBeInTheDocument();
});

it('shows View + Regenerate when summaryHtml is set', () => {
  renderMenu(video({ summaryHtml: 'htmls/a.html' }));
  const link = screen.getByRole('link', { name: /view html doc/i });
  expect(link).toHaveAttribute(
    'href', '/api/html/v?outputFolder=%2Fhome%2Fu%2Fp&type=summary',
  );
  expect(screen.getByRole('button', { name: /regenerate html doc/i })).toBeInTheDocument();
});

it('disables HTML actions when there is no summaryMd', () => {
  renderMenu(video({ summaryMd: null, summaryHtml: null }));
  const item = screen.getByText(/generate html doc/i);
  expect(item).toHaveAttribute('aria-disabled', 'true');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/components/VideoMenu.test.tsx`
Expected: FAIL (prop `onGenerateHtml` missing / items not rendered).

- [ ] **Step 3: Implement the menu changes**

In `components/VideoMenu.tsx`:

(a) Add to `VideoMenuProps`:

```ts
  onGenerateHtml: (videoId: string) => void;
```

(b) Update the destructure in the function signature to include `onGenerateHtml`.

(c) Inside the component body, after the `pdfBase` line, add:

```ts
  const hasSummary = !!video.summaryMd;
  const hasSummaryHtml = !!video.summaryHtml;
  const htmlViewHref = `/api/html/${encodeURIComponent(video.id)}?outputFolder=${encodeURIComponent(outputFolder)}&type=summary`;
```

(d) Insert these `<li>` items immediately after the "View Summary PDF" `<li>` (after line ~76):

```tsx
      <li role="none">
        {hasSummaryHtml ? (
          <a href={htmlViewHref} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
            View HTML doc
          </a>
        ) : hasSummary ? (
          <button type="button" onClick={() => { onGenerateHtml(video.id); onClose(); }} className={itemClass}>
            Generate HTML doc
          </button>
        ) : (
          <span aria-disabled="true" className={disabledClass}>Generate HTML doc</span>
        )}
      </li>
      {hasSummaryHtml && (
        <li role="none">
          <button type="button" onClick={() => { onGenerateHtml(video.id); onClose(); }} className={itemClass}>
            Regenerate HTML doc
          </button>
        </li>
      )}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/components/VideoMenu.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: DO NOT commit yet**

> **Codex HIGH (no broken commit):** Adding the required `onGenerateHtml` prop to `VideoMenu` breaks `VideoRow`/`VideoList`/`page` compilation until they pass it. Committing `VideoMenu` alone yields a non-building commit. Proceed straight to Task 11 and commit `VideoMenu` **together** with its callers in one buildable commit. The `VideoMenu` unit test already passes now (it supplies the prop directly), so you have RED→GREEN locally without committing.

---

## Task 11: Thread `onGenerateHtml` through VideoList/VideoRow + wire `app/page.tsx` (single buildable commit with Task 10)

**Files:**
- Modify: `components/VideoMenu.tsx` (from Task 10, committed here), `components/VideoList.tsx`, `components/VideoRow.tsx`, `app/page.tsx`

> UI wiring — no business logic. Covered by E2E (Task 12). Verify with `tsc` + build here.

- [ ] **Step 1: Thread the prop through VideoList**

In `components/VideoList.tsx`: add `onGenerateHtml: (videoId: string) => void;` to the props interface, accept it in the destructure, and pass `onGenerateHtml={onGenerateHtml}` to `<VideoRow>` (next to the existing `onDeepDive={onDeepDive}` at line ~136).

- [ ] **Step 2: Thread the prop through VideoRow**

In `components/VideoRow.tsx`: add `onGenerateHtml: (videoId: string) => void;` to the props interface, accept it in the destructure, and pass `onGenerateHtml={onGenerateHtml}` to `<VideoMenu>` (next to the existing `onDeepDive={onDeepDive}` at line ~109).

- [ ] **Step 3: Wire `app/page.tsx`**

(a) Add the import near the other component imports:

```tsx
import HtmlDocStatusBar from '@/components/HtmlDocStatusBar';
```

(b) Add state next to the `deepDive` state (line ~33):

```tsx
  const [htmlJob, setHtmlJob] = useState<{ videoId: string; jobId: string; title: string; viewUrl: string } | null>(null);
```

(c) Add the handler next to `handleDeepDive` (line ~299):

```tsx
  const handleGenerateHtml = useCallback(
    async (videoId: string) => {
      const title = videos.find((v) => v.id === videoId)?.title ?? '';
      const viewUrl = `/api/html/${encodeURIComponent(videoId)}?outputFolder=${encodeURIComponent(outputFolder)}&type=summary`;
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/html-doc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputFolder }),
        });
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
        setHtmlJob({ videoId, jobId: data.jobId, title, viewUrl });
      } catch {
        // ignore — no status bar opened
      }
    },
    [outputFolder, videos],
  );

  const handleHtmlClose = useCallback(() => {
    setHtmlJob(null);
    const { col, order } = sortRef.current;
    fetchVideos(outputFolder, col, order); // refresh so the menu flips to View/Regenerate
  }, [fetchVideos, outputFolder]);
```

(d) Pass the prop to `<VideoList>` (next to `onDeepDive={handleDeepDive}`, line ~464):

```tsx
          onGenerateHtml={handleGenerateHtml}
```

(e) Mount the status bar next to the `{deepDive && ...}` block (line ~474):

```tsx
      {htmlJob && (
        <HtmlDocStatusBar
          videoId={htmlJob.videoId}
          jobId={htmlJob.jobId}
          title={htmlJob.title}
          viewUrl={htmlJob.viewUrl}
          onClose={handleHtmlClose}
        />
      )}
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass, no type errors. (If any component test for `VideoList`/`VideoRow` exists and now needs the new required prop, add `onGenerateHtml={() => {}}` to those render calls.)

- [ ] **Step 5: Commit (VideoMenu from Task 10 ships here, in one buildable commit)**

```bash
git add components/VideoMenu.tsx components/VideoList.tsx components/VideoRow.tsx app/page.tsx tests/components/VideoMenu.test.tsx tests/
git commit -m "feat(html-doc): VideoMenu items + wire generate-html through list, row, page"
```

---

## Task 12: E2E — generate → view flow

**Files:**
- Create: `tests/e2e/html-doc.spec.ts`

> Mocks Gemini at the **API boundary** (per `dev-process` mocking table: E2E mocks at the route level, not the lib boundary). Use the project's existing E2E harness/fixtures pattern — inspect a sibling spec (e.g. the deep-dive or quick-view E2E) for how it seeds a temp playlist folder and stubs Gemini, and mirror it.

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/html-doc.spec.ts`. Required scenarios (use existing fixture helpers for folder seeding + Gemini stubbing):

```ts
import { test, expect } from '@playwright/test';

// Fixture set MUST include: one video with summaryHtml = null (EN), one with summaryHtml set,
// and at least one KO video (lang: 'ko') — per dev-process conditional-rendering + KO rules.

test('generates an HTML doc from an existing summary and reveals the View link', async ({ page }) => {
  // seed a temp playlist with a summary .md + index (summaryHtml: null); stub POST gemini transform
  await page.goto('/');
  // open the row menu, click "Generate HTML doc"
  // assert the status bar appears, runs, then shows the "View HTML doc" link
  // assert the link href has BOTH params:
  //   const href = await link.getAttribute('href');
  //   const u = new URL(href!, page.url());
  //   expect(u.searchParams.get('outputFolder')).toBe(<seeded folder>);
  //   expect(u.searchParams.get('type')).toBe('summary');
});

test('a video that already has summaryHtml shows View + Regenerate, no Generate', async ({ page }) => {
  // seed with summaryHtml set; open menu; assert View link + Regenerate button; no "Generate HTML doc"
});

test('surfaces an error in the status bar when the transform fails (no file written)', async ({ page }) => {
  // stub the transform to 500/throw; click Generate; assert status bar role=alert error; menu still "Generate"
});

test('KO summary generates without mangling', async ({ page }) => {
  // seed a KO video; generate; fetch the served HTML and assert it contains Korean text
});
```

- [ ] **Step 2: Run E2E**

Run: `npx playwright test tests/e2e/html-doc.spec.ts`
Expected: PASS (4 scenarios). Assert **all** params on the View link (`outputFolder` + `type`) — not just one.

- [ ] **Step 3: Full suite + commit**

Run: `npm test` (then `npx playwright test`)
Expected: all green.

```bash
git add tests/e2e/html-doc.spec.ts
git commit -m "test(html-doc): E2E generate→view, regenerate, error, KO"
```

---

## Self-Review

**Spec coverage:**
- Caching model (generate-once, cache, regenerate) → Tasks 5 (write+index), 8 (serve), 10 (menu states). ✓
- Summary-only scope → serve route reads `summaryHtml`; menu gates on `summaryMd`. ✓
- Approach 1 (structured transform + pure renderer, no Pandoc) → Tasks 3, 4. ✓
- Deterministic parse of meta/tldr/takeaways/sections; ordinal stripping → Task 2. ✓
- Transform contract (flash, JSON, faithful, count guard) → Task 4. ✓
- Output file format (filename, head provenance, self-contained, KO serif, footer) → Task 3 tests. ✓
- URL contracts (POST, SSE, serve) → Tasks 6, 7, 8; menu/page links Tasks 10, 11. ✓
- Non-blocking status bar + dismissal → Task 9 (+ View-link refinement for popup-blocking). ✓
- Menu states incl. null vs set `summaryHtml` and absent `summaryMd` → Task 10. ✓
- Hard-fail, no partial cache → Task 5 test "writes nothing…". ✓
- HTML escaping (security) → Task 3 injection test. ✓
- Testing layers (unit/api/component/E2E, KO fixture, all-params link assertion) → Tasks 1–12. ✓

**Placeholder scan:** No TBD/TODO. The earlier vestigial-scaffold locals (`metaLine` in parse, `metaBits`/`sourceNote` in render) were removed in the post-Codex revision; the code blocks are now clean.

**Type consistency:** `runHtmlDoc(videoId, outputFolder, onProgress)`, `generateMagazineModel(sections, language)`, `parseSummaryMarkdown(md)`, `renderMagazineHtml(parsed, model)`, `summaryHtml`, `htmls/<base>.html`, `onGenerateHtml` — names consistent across all tasks and the spec.

**Decision deviations from the spec (intentional, noted):**
1. Transform lives in `lib/gemini.ts` (`generateMagazineModel`), not a separate `lib/html-doc/transform.ts` — respects the project's Gemini mocking boundary. (Codex M6 suggests a thin wrapper to preserve the spec's module boundary — **open decision**.)
2. On `done`, the status bar surfaces a clickable **View link** in addition to `window.open` — avoids browser popup-blocking of a programmatic open after async work.

**Medium decisions (user-confirmed 2026-06-09):**
- **M1 (inline markdown): ACCEPTED** — callout text and transformed leads/bullets render as escaped plain text; inline `**bold**`/links are not interpreted (source nuance stays in the `.md`).
- **M6 (transform module boundary): keep in `lib/gemini.ts`** — no separate `transform.ts` wrapper; respects the Gemini mocking boundary.

Post-Codex revision: all 3 Blocking + 6 High + M2–M5 resolved inline (see Codex Review Resolutions table).
