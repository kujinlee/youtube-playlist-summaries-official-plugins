# Section "Dig Deeper" with Slide Screenshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full deep-dive doc with on-demand, per-section "dig deeper" elaboration that grounds each summary section in a clipped Gemini call and inserts slide screenshots, accumulating into a per-video dig-deeper companion doc.

**Architecture:** A reader digs one summary section; the server re-parses the summary `.md`, windows the transcript to that section, issues a clipped `gemini-2.5-pro` REST call (`video_metadata` offsets — verified to bill only the clip), resolves `[[TS:i]]` (existing) and `[[SLIDE:sec|caption]]` (new, yt-dlp+ffmpeg) tokens, and upserts the result into `<basename>-dig-deeper.md`. Trigger is non-blocking POST→SSE, mirroring the existing deep-dive job pattern.

**Tech Stack:** Next.js (app router), TypeScript, jest+ts-jest (SWC, no typecheck — `tsc --noEmit` is the real gate), @testing-library/react, Playwright; markdown-it; yt-dlp + ffmpeg (new system-binary dependency); Gemini via raw REST `fetch`.

**Spec:** `docs/superpowers/specs/2026-06-24-section-dig-deeper-screenshots-design.md` (rev 2). **Review:** `docs/reviews/spec-dig-deeper-screenshots-review.md`. Task 0 spike already DONE (clipping honored, timestamps absolute, ~$0.046/section).

## Global Constraints

- **No SDK migration.** The dig Gemini call uses a direct REST `fetch` to `…/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`; the legacy `@google/generative-ai` SDK stays for all other calls.
- **Timestamps are absolute** (Task 0): `[[SLIDE:sec]]` `sec` is original-video seconds; `ffmpeg -ss (sec - S)`.
- **`sectionId = startSec`** threads timeline/nav/resolver/upsert.
- **Exec discipline:** yt-dlp/ffmpeg only via `execFile`/`spawn` with **argv arrays** — never a shell string. `videoId` validated by `assertVideoId(videoId)` (exported, `lib/index-store.ts:33`; `VIDEO_ID_RE` itself is module-private — do NOT import it). `youtubeUrl` constructed server-side from `videoId`, never request-supplied.
- **POST transport (H-2):** the trigger POST sends `{ outputFolder, force? }` in the **JSON body** (mirroring `deep-dive/route.ts:17-18`), NOT query params. The `view detail` and `dig-state` GETs use query params. `[sectionId]` route param arrives as a **string** — `Number()` it and validate non-negative integer (L-4).
- **No summary version bump** (avoids 236-Gemini re-summarize). `digVersion` is a provenance stamp only — it never triggers auto-regeneration.
- **Renderer safety:** companion HTML uses `new MarkdownIt({ html: false })`; captions sanitized before interpolation. HTML always base64-inlines images, never a relative `img src`.
- **Mocking boundaries:** Gemini at the `fetch` boundary; yt-dlp/ffmpeg at the `execFile` boundary; E2E mocks at the API route level. No real network/exec in unit tests.
- **TDD:** failing test first (RED), confirm failure, minimal impl (GREEN), targeted test then `npm test` before commit. `npx tsc --noEmit` must pass before each commit (jest uses SWC and won't catch type errors).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/transcript-timestamps.ts` (modify) | add optional `videoDuration` param to `resolveTranscriptTokens` (H2 tail-drop fix) |
| `lib/dig/section-window.ts` (create) | pure windowing: `ParsedSection` → `{ sectionId, startSec, endSec, transcriptWindow, summaryProse }` |
| `lib/dig/slide-tokens.ts` (create) | pure `[[SLIDE:sec\|caption]]` parse/validate/sanitize/dedupe/cap |
| `lib/dig/slides.ts` (create) | exec yt-dlp+ffmpeg, asset-path guard, token→`![]()` rewrite, fallbacks |
| `lib/dig/generate.ts` (create) | `buildDigPrompt` + clipped Gemini REST call |
| `lib/dig/companion-doc.ts` (create) | idempotent upsert into `<basename>-dig-deeper.md`; assets-before-doc ordering |
| `lib/html-doc/render-dig-deeper.ts` (create) | render dig-deeper `.md` → self-contained HTML with base64-inlined slides |
| `types/index.ts` (modify) | add `digDeeperMd`/`digDeeperHtml` to `VideoSchema` (Zod, not a TS interface) |
| `app/api/videos/[id]/dig/[sectionId]/route.ts` (create) | POST: create job, orchestrate units |
| `app/api/videos/[id]/dig/[sectionId]/stream/route.ts` (create) | GET: subscribe job by `jobId` |
| `app/api/videos/[id]/dig-state/route.ts` (create) | GET: dug `sectionId` list for control toggling |
| `app/api/html/[id]/route.ts` (modify) | accept `type=dig-deeper` |
| `lib/html-doc/render.ts` (modify) | emit the new dig control for ALL timestamped sections (drop `hasDeepDive` gating) — Task 12 |
| `lib/html-doc/nav.ts` (modify) | dug-state fetch on load + control state machine (not-dug/loading/dug/error) |
| **Test locations (B-2):** all unit/component tests live under `tests/` (`testMatch` only discovers `tests/lib/**`, `tests/api/**`, `tests/components/**`). Mirror source: `lib/dig/X.ts` → `tests/lib/dig/X.test.ts`; route tests → `tests/api/<name>.test.ts`. Import sources via the `@/` alias (`@/lib/dig/X`), configured in `jest.config.ts:9`. E2E: `e2e/dig-deeper.spec.ts`. | |

---

## Task 1: Add optional `videoDuration` to `resolveTranscriptTokens` (H2 fix)

**Files:**
- Modify: `lib/transcript-timestamps.ts:62`
- Test: `tests/lib/transcript-timestamps.test.ts`

**Interfaces:**
- Produces: `resolveTranscriptTokens(markdown: string, segments: TranscriptSegment[], videoId: string | null, videoDuration?: number): string` — when `videoDuration` is given, it is used as the upper bound instead of `lastSeg.offset + lastSeg.duration`, so a *windowed* segment array no longer drops tokens at the window's tail. Omitting it preserves existing behavior exactly.

- [ ] **Step 1: Write the failing test**
```ts
import { resolveTranscriptTokens } from '@/lib/transcript-timestamps';

test('windowed segments resolve the tail token when full duration is passed', () => {
  // window = two segments at 600s and 660s; full video is 1279s long
  const segments = [
    { text: 'a', offset: 600, duration: 30 },
    { text: 'b', offset: 660, duration: 30 },
  ];
  // [[TS:1]] is the last (tail) segment — without a duration bound it would be dropped.
  const out = resolveTranscriptTokens('point [[TS:1]] here', segments, 'vid123', 1279);
  expect(out).toContain('data-t="660"');     // tail token survived
  expect(out).not.toContain('[[TS:1]]');      // token was replaced, not left raw
  // B-1: the tail token's END must use the passed full duration (21:19), not the window end,
  // proving videoDuration gates the :119 end computation too — not just the :97 candidate filter.
  expect(out).toContain('21:19');             // formatTimestamp(1279)
});

test('omitting videoDuration preserves prior behavior (no signature break)', () => {
  const segments = [{ text: 'a', offset: 10, duration: 5 }];
  const out = resolveTranscriptTokens('x [[TS:0]] y', segments, 'vid123');
  expect(out).toContain('data-t="10"');
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx jest transcript-timestamps -t "tail token"`
Expected: FAIL — tail token dropped (`[[TS:1]]` still present) because duration is derived from the window.

- [ ] **Step 3: Implement minimal change**
Add the optional 4th param. The duration bound is computed at `transcript-timestamps.ts:85` (`const videoDuration = … lastSeg.offset + lastSeg.duration …`) and reused at `:97` (candidate filter) and `:119` (last token's end). Change only the `:85` definition to `const videoDuration = videoDuration_param ?? Math.floor(lastSeg.offset + lastSeg.duration)` (rename the param to avoid shadowing). Both `:97` and `:119` then honor the passed value automatically. Change nothing else.

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx jest transcript-timestamps`
Expected: PASS (new + all existing).

- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/transcript-timestamps.ts tests/lib/transcript-timestamps.test.ts
git commit -m "feat(dig): optional videoDuration bound for windowed token resolution"
```

---

## Task 2: `section-window.ts` (pure windowing)

**Files:**
- Create: `lib/dig/section-window.ts`
- Test: `tests/lib/dig/section-window.test.ts`

**Interfaces:**
- Consumes: `ParsedSection` (`lib/html-doc/types.ts:12`, has `prose`, `timeRange?: {startSec,endSec}|null`), `TranscriptSegment` (`lib/transcript-timestamps.ts:2`, `{text, offset, duration}`).
- Produces:
```ts
export interface SectionWindow {
  sectionId: number; startSec: number; endSec: number;
  transcriptWindow: TranscriptSegment[]; summaryProse: string;
}
export function windowForSection(
  section: ParsedSection, allSections: ParsedSection[],
  segments: TranscriptSegment[], durationSeconds: number,
): SectionWindow | null   // null when section has no timeRange (not dig-enabled)
```

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Window mid-list | section with next sibling | `endSec` = next section's `startSec` |
| 2 | Last section | no next sibling | `endSec` = `durationSeconds` |
| 3 | No timeRange | `timeRange` null/undefined | return `null` (not dig-enabled) |
| 4 | Transcript slice | segments span window | only segments with `offset ∈ [startSec, endSec)` |
| 5 | Empty window | no segments in range | `transcriptWindow = []` (still valid) |
| 6 | Empty prose | `prose` blank after strip | fall back to `section.title` so prompt is non-empty |
| 7 | Duplicate startSec (L1) | two sections same `startSec` | next-by-index used for `endSec`; documented collision |

- [ ] **Step 1: Write failing tests** (one per behavior)
```ts
import { windowForSection } from '@/lib/dig/section-window';
const seg = (offset: number) => ({ text: `s${offset}`, offset, duration: 10 });
const sec = (startSec: number | null, prose = 'body') => ({
  numeral: '1', title: 'T', prose,
  timeRange: startSec == null ? null : { startSec, endSec: startSec + 1 },
});

test('mid-list window ends at next section start', () => {
  const a = sec(100), b = sec(200);
  const w = windowForSection(a, [a, b], [seg(100), seg(150), seg(250)], 999)!;
  expect(w).toMatchObject({ sectionId: 100, startSec: 100, endSec: 200 });
  expect(w.transcriptWindow.map(s => s.offset)).toEqual([100, 150]); // 250 excluded
});
test('last section ends at duration', () => {
  const a = sec(100), b = sec(200);
  expect(windowForSection(b, [a, b], [], 900)!.endSec).toBe(900);
});
test('section without timeRange is not dig-enabled', () => {
  const a = sec(null);
  expect(windowForSection(a, [a], [], 900)).toBeNull();
});
test('empty prose falls back to title', () => {
  const a = sec(100, '   '); const b = sec(200);
  expect(windowForSection(a, [a, b], [], 900)!.summaryProse).toBe('T');
});
```

- [ ] **Step 2: Run to verify fail** — Run: `npx jest section-window` → FAIL ("windowForSection is not a function").
- [ ] **Step 3: Implement** per the interface + behaviors (sort `allSections` by `timeRange.startSec`; find index of `section`; `endSec` = next's `startSec` ?? `durationSeconds`; filter segments; prose fallback to title when blank).
- [ ] **Step 4: Run** — Run: `npx jest section-window` → PASS.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/dig/section-window.ts tests/lib/dig/section-window.test.ts
git commit -m "feat(dig): pure section-window with transcript slicing"
```

---

## Task 3: `slide-tokens.ts` (pure `[[SLIDE]]` grammar)

**Files:**
- Create: `lib/dig/slide-tokens.ts`
- Test: `tests/lib/dig/slide-tokens.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SlideToken { raw: string; sec: number; caption: string; } // sec already absolute
export function parseSlideTokens(
  markdown: string, startSec: number, endSec: number,
): SlideToken[]   // validated, deduped by sec, capped at 3, captions sanitized
export function sanitizeCaption(s: string): string
```
Grammar: `/\[\[SLIDE:(\d+)(?:\|([^\]]*))?\]\]/g` — `sec` = leading integer; caption = up to first `]`, split on first `|`.

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Valid token | `[[SLIDE:312\|Diagram]]` in [300,400] | one token `{sec:312, caption:'Diagram'}` |
| 2 | Out of range | `sec` ∉ [S,E] | dropped |
| 3 | Non-numeric/negative | `[[SLIDE:abc]]`, `[[SLIDE:-5]]` | dropped |
| 4 | Pipe in caption | `[[SLIDE:312\|perceive \| plan]]` | caption = `perceive plan` (split on FIRST pipe; inner pipe sanitized out) |
| 5 | Dedupe | two tokens same `sec` | one token, first caption |
| 6 | Cap | 5 valid tokens | first 3 kept |
| 7 | Caption injection | caption `]( javascript:alert(1))` | `]`,`(`,`)` stripped by `sanitizeCaption` |
| 8 | No caption | `[[SLIDE:312]]` | caption = `''` |
| 9 | Newline/control | caption with `\n` | collapsed to space; length capped 160 |

- [ ] **Step 1: Write failing tests** (one per behavior)
```ts
import { parseSlideTokens, sanitizeCaption } from '@/lib/dig/slide-tokens';
test('valid token in range', () => {
  expect(parseSlideTokens('x [[SLIDE:312|Diagram]] y', 300, 400))
    .toEqual([{ raw: '[[SLIDE:312|Diagram]]', sec: 312, caption: 'Diagram' }]);
});
test('out-of-range dropped', () => {
  expect(parseSlideTokens('[[SLIDE:999|x]]', 300, 400)).toEqual([]);
});
test('dedupe by sec keeps first caption', () => {
  const t = parseSlideTokens('[[SLIDE:312|A]] [[SLIDE:312|B]]', 300, 400);
  expect(t).toHaveLength(1); expect(t[0].caption).toBe('A');
});
test('cap at 3', () => {
  const md = [310,320,330,340,350].map(s => `[[SLIDE:${s}|c]]`).join(' ');
  expect(parseSlideTokens(md, 300, 400)).toHaveLength(3);
});
test('caption injection neutralized', () => {
  expect(sanitizeCaption('](javascript:alert(1))')).not.toMatch(/[\]\)\(]/);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the regex parse, integer coercion, range filter, `sanitizeCaption` (strip `][()|` + control chars, collapse whitespace, slice 160), dedupe by `sec`, cap 3.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/dig/slide-tokens.ts tests/lib/dig/slide-tokens.test.ts
git commit -m "feat(dig): [[SLIDE]] token grammar, sanitization, dedupe, cap"
```

---

## Task 4: `slides.ts` (yt-dlp + ffmpeg extraction)

**Files:**
- Create: `lib/dig/slides.ts`
- Test: `tests/lib/dig/slides.test.ts`

**Interfaces:**
- Consumes: `parseSlideTokens` (Task 3); `assertVideoId`, `VIDEO_ID_RE` semantics (`lib/index-store.ts`).
- Produces:
```ts
export async function resolveSlideTokens(markdown: string, opts: {
  videoId: string; startSec: number; endSec: number; assetsRoot: string;
  sectionId: number;
}): Promise<string>   // tokens rewritten to ![caption](assets/<videoId>/<sectionId>-<sec>.jpg)
```
Uses `execFile` (from `node:child_process`, promisified) — mocked in tests via `jest.mock('node:child_process')`.

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | No tokens | markdown has no `[[SLIDE]]` | returned unchanged; **execFile never called** |
| 2 | Happy path | one valid token | yt-dlp `--download-sections "*S-E"` argv; ffmpeg `-ss (sec-S)`; token→`![cap](assets/<vid>/<sid>-<sec>.jpg)` |
| 3 | Missing binary (L4) | execFile throws ENOENT | tokens stripped, returns text-only; no throw |
| 4 | Download gated | yt-dlp exits non-zero | all tokens stripped, text-only |
| 5 | One frame fails | ffmpeg fails for token #2 only | #2 dropped, #1 kept |
| 6 | Path containment (M3) | crafted videoId with `/` or `..` | rejected before any exec (assert within `assetsRoot`) |
| 7 | argv not shell (H3) | always | `execFile('yt-dlp', [..array..])`, no `exec`/string |

- [ ] **Step 1: Write failing tests** with `child_process` mocked
```ts
jest.mock('node:child_process');
import { execFile } from 'node:child_process';
import { resolveSlideTokens } from '@/lib/dig/slides';

test('no tokens → no exec, unchanged', async () => {
  const out = await resolveSlideTokens('plain text', {
    videoId: 'abc12345678', startSec: 300, endSec: 400, assetsRoot: '/tmp/a', sectionId: 300 });
  expect(out).toBe('plain text');
  expect(execFile).not.toHaveBeenCalled();
});

test('happy path rewrites token and uses argv arrays', async () => {
  (execFile as unknown as jest.Mock).mockImplementation((_c, _a, cb) => cb(null, '', ''));
  const out = await resolveSlideTokens('see [[SLIDE:352|Loop]]', {
    videoId: 'abc12345678', startSec: 300, endSec: 400, assetsRoot: '/tmp/a', sectionId: 300 });
  expect(out).toContain('![Loop](assets/abc12345678/300-352.jpg)');
  const cmds = (execFile as unknown as jest.Mock).mock.calls.map(c => c[0]);
  expect(cmds).toEqual(expect.arrayContaining(['yt-dlp', 'ffmpeg']));
  // argv is an array, never a shell string:
  (execFile as unknown as jest.Mock).mock.calls.forEach(c => expect(Array.isArray(c[1])).toBe(true));
});

test('missing binary falls back to text-only', async () => {
  (execFile as unknown as jest.Mock).mockImplementation((_c,_a,cb) => cb(Object.assign(new Error('enoent'), { code: 'ENOENT' })));
  const out = await resolveSlideTokens('see [[SLIDE:352|Loop]]', {
    videoId: 'abc12345678', startSec: 300, endSec: 400, assetsRoot: '/tmp/a', sectionId: 300 });
  expect(out).toBe('see ');           // token stripped, no image, no throw
});

test('crafted videoId rejected before exec', async () => {
  await expect(resolveSlideTokens('[[SLIDE:352|x]]', {
    videoId: '../etc', startSec: 300, endSec: 400, assetsRoot: '/tmp/a', sectionId: 300 }))
    .rejects.toThrow();
  expect(execFile).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** parse via Task 3; if none, return unchanged. Validate via `assertVideoId(videoId)` (H-4 — `VIDEO_ID_RE` is not exported; `assertVideoId` throws on traversal chars); build `youtubeUrl` server-side; resolve `assetPath = path.resolve(assetsRoot, videoId, `${sectionId}-${sec}.jpg`)` and assert `assetPath.startsWith(path.resolve(assetsRoot) + path.sep)`. `execFile('yt-dlp', ['--download-sections', `*${S}-${E}`, '-f', 'bv[height<=720]', '-o', tmp, youtubeUrl])`; per token `execFile('ffmpeg', ['-ss', String(sec-S), '-i', tmp, '-frames:v','1','-q:v','2', assetPath])`; rewrite token. Catch ENOENT/non-zero → strip remaining tokens, log `[dig-slide-miss]`; per-frame failure → drop that token. Write tmp clip under `.cache/`; delete in `finally`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: gitignore `.cache/` (M-1) + typecheck + commit**
```bash
grep -qxF '/.cache/' .gitignore || printf '\n/.cache/\n' >> .gitignore
npx tsc --noEmit
git add lib/dig/slides.ts tests/lib/dig/slides.test.ts .gitignore
git commit -m "feat(dig): slide extraction via yt-dlp+ffmpeg with argv safety + fallbacks"
```

---

## Task 5: `generate.ts` (clipped Gemini REST call)

**Files:**
- Create: `lib/dig/generate.ts`
- Test: `tests/lib/dig/generate.test.ts`

**Interfaces:**
- Consumes: `SectionWindow` (Task 2); `buildIndexedTranscript` (`lib/transcript-timestamps.ts:36`); `GEMINI_API_KEY` env.
- Produces:
```ts
export function buildDigPrompt(lang: 'en'|'ko', startSec: number, endSec: number): string
export async function generateDig(window: SectionWindow, videoId: string, lang: 'en'|'ko'): Promise<string> // raw markdown
```
Uses global `fetch` (mocked in tests).

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Request shape | any call | body has `file_data.file_uri` = `https://www.youtube.com/watch?v=<videoId>` and part-level `video_metadata.{start_offset:{seconds:S},end_offset:{seconds:E}}` |
| 2 | Prompt clip range | any | prompt text contains "[S,E]" / start+end seconds and the ≤3-slide + `[[SLIDE]]`/`[[TS:i]]` instructions |
| 3 | Returns markdown | 200 + candidates | returns `candidates[0].content.parts[0].text` |
| 4 | HTTP error | non-200 | throws (so the job emits `error`) — one retry on transient per `REQUEST_TIMEOUT_MS` posture |
| 5 | Lang | `ko` | prompt instructs Korean output |

- [ ] **Step 1: Write failing tests** with `global.fetch` mocked
```ts
import { buildDigPrompt, generateDig } from '@/lib/dig/generate';

test('buildDigPrompt names the clip range and slide rules', () => {
  const p = buildDigPrompt('en', 300, 400);
  expect(p).toMatch(/300/); expect(p).toMatch(/400/);
  expect(p).toMatch(/\[\[SLIDE:/); expect(p).toMatch(/\[\[TS:/);
});

test('generateDig sends clipped video_metadata + server-built url', async () => {
  const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: 'MD' }] } }],
                     usageMetadata: { promptTokenCount: 35000 } }), { status: 200 }));
  const win = { sectionId: 300, startSec: 300, endSec: 400, transcriptWindow: [], summaryProse: 'p' };
  const md = await generateDig(win as any, 'abc12345678', 'en');
  expect(md).toBe('MD');
  const body = JSON.parse((spy.mock.calls[0][1] as any).body);
  const part = body.contents[0].parts[0];
  expect(part.file_data.file_uri).toBe('https://www.youtube.com/watch?v=abc12345678');
  expect(part.video_metadata.start_offset.seconds).toBe(300);
  expect(part.video_metadata.end_offset.seconds).toBe(400);
});

test('non-200 throws after retry', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
  await expect(generateDig({ sectionId:1,startSec:1,endSec:2,transcriptWindow:[],summaryProse:'p' } as any,
    'abc12345678', 'en')).rejects.toThrow();
});

test('retries once on transient failure then succeeds (M-4)', async () => {
  const spy = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(new Response('busy', { status: 503 }))
    .mockResolvedValueOnce(new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 }));
  const md = await generateDig({ sectionId:1,startSec:1,endSec:2,transcriptWindow:[],summaryProse:'p' } as any,
    'abc12345678', 'en');
  expect(md).toBe('OK');
  expect(spy).toHaveBeenCalledTimes(2);   // one retry
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `buildDigPrompt` (the §3d prompt, parameterized by S/E/lang) and `generateDig` (build body per Behavior 1, POST via `fetch`, one retry on transient failure/timeout, parse text, throw on non-200/missing candidates). Read model id from `process.env.GEMINI_DEEPDIVE_MODEL ?? 'gemini-2.5-pro'`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): clipped gemini-2.5-pro REST call + dig prompt"
```

---

## Task 6: `companion-doc.ts` (idempotent upsert)

**Files:**
- Create: `lib/dig/companion-doc.ts`
- Test: `tests/lib/dig/companion-doc.test.ts` (uses `fs.mkdtemp` temp dirs — real fs, no network)

**Interfaces:**
- Produces:
```ts
export interface DugSection { sectionId: number; startSec: number; title: string; bodyMarkdown: string; generatedAt: string; }
export async function upsertDugSection(opts: {
  digDeeperPath: string; videoTitle: string; videoId: string;
  language: 'en'|'ko'; sourceVideoUrl: string; section: DugSection;
}): Promise<void>
export async function readDugSectionIds(digDeeperPath: string): Promise<number[]>
```

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | First write | file absent | create with frontmatter + one `## ` block; `sections:[{sectionId}]` |
| 2 | Add second section | existing file | both blocks present, ordered by `startSec` |
| 3 | Re-dig (upsert) | same `sectionId` again | that block replaced, others untouched, no dup frontmatter entry |
| 4 | Ordering | out-of-order inserts | body + frontmatter sorted by `startSec` ascending |
| 5 | Atomic | write | temp file + rename (no partial file on crash) |
| 6 | `readDugSectionIds` | file present | returns frontmatter `sections[].sectionId`; `[]` if absent |
| 7 | `generatedAt` passed in | — | stamped from caller (no `Date.now()` inside — keep pure/testable) |

- [ ] **Step 1: Write failing tests**
```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { upsertDugSection, readDugSectionIds } from '@/lib/dig/companion-doc';

const base = (p: string, section: any) => ({
  digDeeperPath: p, videoTitle: 'V', videoId: 'abc12345678',
  language: 'en' as const, sourceVideoUrl: 'https://yt/x', section });

test('first write creates frontmatter + block; readDugSectionIds reflects it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-')); const p = path.join(dir, 'v-dig-deeper.md');
  await upsertDugSection(base(p, { sectionId: 312, startSec: 312, title: 'Loop', bodyMarkdown: 'x', generatedAt: 'T' }));
  const md = await readFile(p, 'utf8');
  expect(md).toMatch(/## Loop/); expect(md).toMatch(/sectionId: 312/);
  expect(await readDugSectionIds(p)).toEqual([312]);
});

test('second section ordered by startSec; re-dig replaces in place', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-')); const p = path.join(dir, 'v-dig-deeper.md');
  await upsertDugSection(base(p, { sectionId: 312, startSec: 312, title: 'B', bodyMarkdown: 'b1', generatedAt: 'T' }));
  await upsertDugSection(base(p, { sectionId: 100, startSec: 100, title: 'A', bodyMarkdown: 'a1', generatedAt: 'T' }));
  await upsertDugSection(base(p, { sectionId: 312, startSec: 312, title: 'B', bodyMarkdown: 'b2', generatedAt: 'T' }));
  const md = await readFile(p, 'utf8');
  expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B')); // ordered
  expect(md).toContain('b2'); expect(md).not.toContain('b1'); // replaced
  expect(await readDugSectionIds(p)).toEqual([100, 312]);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement (M-3 — no YAML lib exists; specify the exact format).** No reusable block-YAML helper exists (`parse.ts:4` `frontmatterField` is a single-field regex, unexported; `gray-matter` is not a dependency). Hand-roll for this fixed schema only: frontmatter delimited by `---` lines; scalar fields `title/videoId/language/sourceVideoUrl` as `key: "value"`; `digVersion: { major: 1, minor: 0 }` inline; and the `sections:` list as block sequence:
```yaml
sections:
  - sectionId: 312
    startSec: 312
    generatedAt: "2026-06-24T12:00:00Z"
```
  Parse by reading lines between the `---` fences; for `sections`, collect `- sectionId:`/`startSec:`/`generatedAt:` triples. Upsert block keyed by `sectionId`, sort body + `sections` by `startSec`, write via temp-file + `rename`. `readDugSectionIds` returns the `sectionId` integers (or `[]` if the file/`sections` key is absent). Keep `generatedAt` an input param (no `Date.now()` inside — testability).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/dig/companion-doc.ts tests/lib/dig/companion-doc.test.ts
git commit -m "feat(dig): idempotent dig-deeper companion doc upsert"
```

---

## Task 7: `render-dig-deeper.ts` (HTML render + base64 slide inlining)

**Files:**
- Create: `lib/html-doc/render-dig-deeper.ts`
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts`

**Interfaces:**
- Consumes: `markdown-it` with `{ html: false }` (mirror `render-deep-dive.ts:11`); `NAV_CSS`/`NAV_SCRIPT`, theme from `lib/html-doc/theme.ts`.
- Produces: `export function renderDigDeeperHtml(mdContent: string, mdPath: string): string`

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Image inlined | `![cap](assets/v/300-352.jpg)` + file exists | `<img ... src="data:image/jpeg;base64,…" alt="cap">` (no relative src) |
| 2 | Missing asset | referenced file absent | `<img>` omitted or alt-only placeholder; **no 500, no broken relative src** |
| 3 | HTML escaped | caption/body with `<script>` | escaped (markdown-it `html:false`) |
| 4 | ▶ links preserved | `data-t` anchors | rendered as in deep-dive |
| 5 | Self-contained | output | CSS/theme/NAV inlined; opens from disk |

- [ ] **Step 1: Write failing tests** (write a tiny real JPEG into a temp `assets/` for Behavior 1; reference a missing file for Behavior 2).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement (M-5 — prefer a renderer rule over HTML regex):** override markdown-it's `image` rule so, at render time, an `assets/…` src is resolved against `dirname(mdPath)`, read, and emitted as a `data:image/jpeg;base64,…` `<img>`; **if the file is missing, drop the `<img>` entirely** (decision: drop, not alt-only) so no relative `src` ever ships. Test asserts BOTH `expect(html).not.toMatch(/src="assets\//)` AND, for the present-file case, `src="data:image/jpeg;base64,`. Inline CSS/theme/NAV like `render-deep-dive.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/html-doc/render-dig-deeper.ts tests/lib/html-doc/render-dig-deeper.test.ts
git commit -m "feat(dig): dig-deeper HTML renderer with base64 slide inlining"
```

---

## Task 8: Index fields `digDeeperMd` / `digDeeperHtml` (B-3: `Video` is a Zod schema)

**Files:**
- Modify: `types/index.ts` — `Video` is `z.infer<typeof VideoSchema>` (`:46-78`); add the fields to **`VideoSchema`**, mirroring `summaryHtml`/`deepDiveHtml` (`:59-60`). There is no `types.ts` and no TS `interface Video`.
- Test: `tests/lib/index-store.test.ts` (or a new `tests/lib/video-schema.test.ts`).

**Interfaces:**
- Produces (in `VideoSchema`): `digDeeperMd: z.string().nullable().optional()`, `digDeeperHtml: z.string().nullable().optional()` → `Video.digDeeperMd?: string | null`, `Video.digDeeperHtml?: string | null`.

> **B-3 note:** a plain write→read round-trip will NOT fail before the change — `readIndex` does `JSON.parse` with no Zod parse, so unknown fields already survive. The RED test must exercise **`VideoSchema.parse(...)`** (or `PlaylistIndexSchema.parse`) directly, so the field is dropped/typed only after it's added to the schema.

- [ ] **Step 1: Write failing test**
```ts
import { VideoSchema } from '@/types';   // '@/types' resolves to types/index.ts via the @/ alias
test('VideoSchema carries digDeeperMd/digDeeperHtml', () => {
  const parsed = VideoSchema.parse({
    id: 'abc12345678', /* …minimum required fields per VideoSchema… */
    digDeeperMd: 'x-dig-deeper.md', digDeeperHtml: 'x-dig-deeper.html',
  });
  expect(parsed.digDeeperMd).toBe('x-dig-deeper.md');
  expect(parsed.digDeeperHtml).toBe('x-dig-deeper.html');
});
```
(Populate the required fields by copying a valid `Video` fixture already used in `tests/`.)

- [ ] **Step 2: Run** → FAIL — `VideoSchema.parse` strips the unknown keys, so `parsed.digDeeperMd` is `undefined`.
- [ ] **Step 3: Implement** — add the two `z.string().nullable().optional()` fields to `VideoSchema`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add types/index.ts tests/lib/index-store.test.ts
git commit -m "feat(dig): VideoSchema digDeeperMd/digDeeperHtml fields"
```

---

## Task 9: POST trigger route + orchestration

**Files:**
- Create: `app/api/videos/[id]/dig/[sectionId]/route.ts`
- Test: `tests/api/dig-post.test.ts` — **model on `tests/api/deep-dive-post.test.ts`** (copy its `Request`-builder, `params: Promise<{id}>` handling, and `jest.mock('@/lib/job-registry')` + `_resetJobRegistry()` setup; H-5). Mock `@/lib/dig/*`.

**Interfaces:**
- Consumes: Tasks 2–8; `createJob/emitJobEvent/getActiveJob/releaseJobLock/deleteJob` (`lib/job-registry.ts`), `assertOutputFolder/assertVideoId` (`lib/index-store.ts`), `parseSummaryMarkdown` (`lib/html-doc/parse.ts` — returns `{ sections: ParsedSection[] }`), `resolveTranscriptTokens` (Task 1), `resolveTranscriptSegments` (existing).
- Produces: `POST` reading `{ outputFolder, force? }` from the **JSON body** (H-2) → `{ jobId }`. Mirrors `app/api/videos/[id]/deep-dive/route.ts` (grace window, lock release on terminal). `sectionId` param is coerced via `Number()` and validated as a non-negative integer (L-4).

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Happy path | valid POST | creates job, runs: parse summary → window → generateDig → resolve TS (with full duration) → resolveSlideTokens → upsert → render+save HTML → set index fields → `done`; returns `{jobId}` |
| 2 | Missing outputFolder (body) | absent | 400 |
| 3 | Invalid videoId / non-integer sectionId | bad | 400 (no job); test asserts `Number('abc')`/negative → 400 (L-4) |
| 4 | Section not found | `sectionId` matches no parsed section | `error` event, no doc mutation |
| 5 | Same-section in-flight (H7/H-3) | second POST while loading | returns existing `jobId`; **test asserts `getActiveJob` was called with the exact key `${outputFolder}::${videoId}::${sectionId}`** and `generateDig` called once |
| 6 | `force=1` | re-dig | overwrites that section's block |
| 7 | Gemini fails | generateDig throws | `error` event; no partial doc write |
| 8 | yt-dlp gated | slides fallback | `done` with text-only doc |
| 9 | Assets-before-doc | always | assets written before the `.md` rename (renderer never sees missing asset) |

- [ ] **Step 1: Write failing tests** for Behaviors 1–9 (mock units; assert orchestration order, in-flight key, status codes, terminal events).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the handler: read `outputFolder`/`force` from `await request.json()` (H-2); `Number(sectionId)` + non-negative-integer guard (L-4); copy the deep-dive route's job/lock/grace scaffolding; `createJob(jobId, key)` with `key = ${outputFolder}::${videoId}::${sectionId}` (H-3); orchestrate the pipeline; emit `step`/`done`/`error`.
- [ ] **Step 4: Run** targeted → then `npm test`.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add "app/api/videos/[id]/dig/[sectionId]/route.ts" tests/api/dig-post.test.ts
git commit -m "feat(dig): POST dig trigger route + per-section orchestration"
```

---

## Task 10: GET stream route + dig-state route

**Files:**
- Create: `app/api/videos/[id]/dig/[sectionId]/stream/route.ts` (copy deep-dive `stream/route.ts` verbatim — subscribe by `?jobId=`)
- Create: `app/api/videos/[id]/dig-state/route.ts`
- Test: `tests/api/dig-state.test.ts` (model on `tests/api/html-serve.test.ts` for the GET harness; mock `@/lib/dig/companion-doc`)

**Interfaces:**
- `GET stream?jobId=` → SSE subscription only, no side effects (mirror existing).
- `GET dig-state?outputFolder=` → `{ sectionIds: number[] }` via `readDugSectionIds` (Task 6) on the video's `<basename>-dig-deeper.md`.

**Enumerated Behaviors (dig-state):**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Doc exists | dug sections present | `{ sectionIds: [..] }` |
| 2 | Doc absent | never dug | `{ sectionIds: [] }` |
| 3 | Bad outputFolder/videoId | invalid | 400 |

- [ ] **Step 1: Write failing tests** for dig-state (mock `readDugSectionIds`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both routes.
- [ ] **Step 4: Run** targeted → `npm test`.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add "app/api/videos/[id]/dig/[sectionId]/stream/route.ts" "app/api/videos/[id]/dig-state/route.ts" tests/api/dig-state.test.ts
git commit -m "feat(dig): GET stream subscribe + dig-state route"
```

---

## Task 11: Extend `html/[id]` serve route for `type=dig-deeper`

**Files:**
- Modify: `app/api/html/[id]/route.ts` (the type-allowlist at `:27-30`)
- Test: extend `tests/api/html-serve.test.ts`.

**Interfaces:**
- `GET /api/html/[id]?outputFolder=&type=dig-deeper` → serves `renderDigDeeperHtml` of the video's `digDeeperMd`.

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | dig-deeper served | `type=dig-deeper`, doc exists | 200 HTML from `renderDigDeeperHtml` |
| 2 | Unknown type still 400 | `type=banana` | 400 (allowlist still rejects others) |
| 3 | Doc absent | `type=dig-deeper`, no doc | 404 |

- [ ] **Step 1: Write failing test** for Behaviors 1–3.
- [ ] **Step 2: Run** → FAIL (current code 400s on `dig-deeper`).
- [ ] **Step 3: Implement** — add `dig-deeper` to the allowlist; branch to `renderDigDeeperHtml`.
- [ ] **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add "app/api/html/[id]/route.ts" tests/api/html-serve.test.ts
git commit -m "feat(dig): serve type=dig-deeper HTML"
```

---

## Task 12: Repoint the summary dig control (B-4 / spec D1)

**Why:** Today `render.ts:83` emits the control only `(hasDeepDive && startSec != null)` and `digControl('deep-dive', startSec)` (`nav.ts:8`) renders a cross-doc link to the **legacy** deep-dive doc. With deep-dive replaced (D1), the control must appear on **every timestamped section** regardless of `deepDiveMd`, and must drive the new POST→SSE flow — otherwise Tasks 9–11's routes are never invoked.

**Files:**
- Modify: `lib/html-doc/render.ts:83` (gating) and `lib/html-doc/nav.ts:8` (`digControl` signature/markup)
- Test: `tests/lib/html-doc/render.test.ts` (or the existing render test) + `tests/lib/html-doc/nav.test.ts`

**Interfaces:**
- `digControl(startSec: number): string` — drop the `targetType` param; emit `<a class="dig" data-section="${startSec}" data-t="${startSec}">dig deeper ▶</a>` (the state machine in Task 13 owns behavior). Update `render.ts` to `const dig = startSec != null ? digControl(startSec) : '';` (drop `hasDeepDive`). Also drop the now-unused `hasDeepDive` plumbing if it becomes dead (check `render-deep-dive.ts` still needs its own counterpart control — keep that path; only the summary→dig path changes).

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Control on every timestamped section | section has `startSec`, `deepDiveMd` null | dig control present (was absent before) |
| 2 | No control without timestamp | `startSec == null` | no control |
| 3 | Markup carries sectionId | any | `data-section="${startSec}"` present |

- [ ] **Step 1: Write failing test** — render a summary whose video has `deepDiveMd: null` and a timestamped section; assert the dig control is emitted with `data-section`. (Currently fails: gated out.)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the gating + `digControl` signature change; fix all callers (`wireDigLinks` is rewritten in Task 13).
- [ ] **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/html-doc/render.ts lib/html-doc/nav.ts tests/lib/html-doc/render.test.ts
git commit -m "feat(dig): emit dig control on all timestamped sections (replace deep-dive)"
```

---

## Task 13: `nav.ts` dug-state fetch + control state machine (H-1)

**Scope note (H-1):** `NAV_SCRIPT` (`nav.ts:42-58`) is today a ~12-line IIFE with no fetch/EventSource/state. This task adds a real client state machine as inline browser JS (no imports, no TS — it ships as a string). It is the largest client surface; treat its behaviors below as the contract.

**Files:**
- Modify: `lib/html-doc/nav.ts` — extend `NAV_SCRIPT`; keep `wireDigLinks` for jsdom-testable logic, repoint it to the POST→SSE flow.
- Test: `tests/lib/html-doc/nav.test.ts` (jsdom; mock `global.fetch` and `EventSource`)

**Interfaces:**
- Consumes: routes from Tasks 9–11; the `outputFolder` is read from a page-level data attribute / existing global the summary HTML already exposes (verify how the current summary HTML passes `outputFolder` to client JS; reuse that channel).
- Produces: on load, fetch `GET dig-state?outputFolder=` → for each `[data-section]` in the returned `sectionIds`, render "view detail ↓"; the rest stay "dig deeper ▶". Click not-dug → `POST /api/videos/[id]/dig/[sectionId]` with `{outputFolder}` body → subscribe `GET …/stream?jobId=` (EventSource) → ⏳ → on `done` "view detail ↓", on `error` "⚠ retry". `↻` → POST with `{outputFolder, force:true}`.

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Dug on load | dig-state lists sectionId | "view detail ↓" linking `/api/html/[id]?outputFolder=<enc>&type=dig-deeper#t=<startSec>` (assert ALL params) |
| 2 | dig-state fetch fails | network error on load | controls default to "dig deeper ▶" (fail-open, not blank) |
| 3 | Not-dug click | click | **POST** (assert method, not GET) with `{outputFolder}` body; then EventSource to stream?jobId; control ⏳ |
| 4 | Job done | stream emits `done` | control → "view detail ↓" with all params |
| 5 | Job error event | stream emits `{type:'error'}` | control → ⚠ retry |
| 6 | EventSource transport error | `onerror` (not a job event) | control → ⚠ retry (distinct from #5 but same UI) |
| 7 | Double-click while loading | click during ⏳ | second click ignored (no 2nd POST) |
| 8 | force re-dig | ↻ on dug | POST `{outputFolder, force:true}` |

- [ ] **Step 1: Write failing tests** for Behaviors 1–8 (jsdom; mock `fetch` + a fake `EventSource`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the `NAV_SCRIPT` state machine + `wireDigLinks` logic.
- [ ] **Step 4: Run** → PASS; `npm test`.
- [ ] **Step 5: Typecheck + commit**
```bash
npx tsc --noEmit
git add lib/html-doc/nav.ts tests/lib/html-doc/nav.test.ts
git commit -m "feat(dig): nav dug-state fetch + dig control state machine"
```

---

## Task 14: E2E (Playwright)

**Files:**
- Create: `e2e/dig-deeper.spec.ts`
- Fixtures: one video **with** slides (Gemini returns `[[SLIDE]]`), one **without** (text-only) — mock at the **API route** level.

**Enumerated Behaviors:**

| # | Behavior | Expected |
|---|---|---|
| 1 | Dig a section (with slides) | POST issued (assert method=POST), spinner, then "view detail ↓"; companion HTML shows `<img src="data:image/jpeg;base64,...">` |
| 2 | Dig a section (no slides) | text-only block, no `<img>` |
| 3 | View detail link params | assert `outputFolder` AND `type=dig-deeper` AND `#t=<startSec>` (all params) |
| 4 | Error path | mocked 500 → ⚠ retry visible |
| 5 | Bare GET does not generate (B2) | GET to the trigger URL must not create a doc |

- [ ] **Step 1: Write failing E2E** for Behaviors 1–5.
- [ ] **Step 2: Run** — `npx playwright test --grep dig-deeper` → FAIL.
- [ ] **Step 3: Wire** any missing test hooks/fixtures.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**
```bash
git add e2e/dig-deeper.spec.ts
git commit -m "test(dig): E2E with/without slides, URL params, POST-not-GET"
```

---

## Self-Review (rev 2 — post plan review)

**Spec coverage:** §0 spike → done (no task). §3a window → T2. §3b REST → T5. §3c grammar/H2 → T1,T3. §4 slides → T4. §5 doc format → T6. §6 UI/B1/B2 → T9,T10,T13. D1 replace-control → **T12 (new)**. §7 errors/H7 → T4,T9. H6 (renderer/serve/index) → T7,T8(VideoSchema),T11. testing → every task + T14. **No uncovered spec requirement.**

**Tasks (14):** 1 resolver duration · 2 section-window · 3 SLIDE grammar · 4 slides exec · 5 gemini REST · 6 companion-doc · 7 renderer · 8 VideoSchema fields · 9 POST orchestration · 10 stream+dig-state · 11 html serve · 12 repoint control (D1) · 13 nav state machine · 14 E2E.

**Plan-review findings folded in:** B-1 (T1 line :85 + tail-end assert), B-2 (all tests under `tests/`, `@/` imports), B-3 (T8 VideoSchema + real RED), B-4 (T12 new), H-1 (T13 expanded behaviors), H-2 (POST body transport), H-3 (T9 lock-key assertion), H-4 (assertVideoId), H-5 (model on `tests/api/deep-dive-post.test.ts`), M-1 (`.cache/` gitignore T4), M-3 (T6 explicit YAML), M-4 (T5 retry test), M-5 (T7 drop-img + renderer rule), L-4 (sectionId coercion). M-2 accepted coverage gap (exec only unit-mocked).

**Placeholders:** none. **Type consistency:** `sectionId`/`startSec` `number` throughout; `SectionWindow`/`SlideToken`/`DugSection` defined once; `resolveSlideTokens`/`generateDig`/`upsertDugSection`/`readDugSectionIds`/`renderDigDeeperHtml`/`digControl(startSec)` names consistent across producer/consumer.
