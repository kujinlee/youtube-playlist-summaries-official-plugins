# Deep-Dive Version-Aware Regeneration (+ Timestamps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the deep-dive HTML feature to parity with the summary's version-aware regeneration (PR #4) and add clickable per-section ▶ YouTube timestamps to deep-dives.

**Architecture:** Mirror the proven summary pattern in a parallel module (`lib/deep-dive/`). A `deepDiveVersion` ({major,minor}) drives an `ensureDeepDiveHtml` orchestrator: major-stale → re-run the transcript cascade (resolving `[[TS:i]]` tokens at generation time, like `generateSummary`) → render + store HTML; minor-stale → cheap re-render from the existing `.md`; current → no-op. The `.md` is the cached model (no envelope). HTML is eagerly rendered and tracked via a new `deepDiveHtml` index field. The menu unifies the two existing deep-dive items into one version-aware "Deep Dive doc" action.

**Tech Stack:** Next.js (app router, route handlers), TypeScript, Zod, jest + ts-jest (SWC, no typecheck — `tsc --noEmit` is the real type gate), @testing-library/react, Playwright. Gemini + YouTube mocked at the lib boundary; routes mocked at the route level for E2E.

**Spec:** `docs/superpowers/specs/2026-06-20-deep-dive-version-aware-regeneration-design.md`

**Reference files to mirror (read before starting):**
- `lib/doc-version.ts`, `lib/html-doc/ensure.ts`, `lib/html-doc/rerender.ts` — the summary pattern.
- `lib/gemini.ts:67-115` (`generateSummary`) — token instruction + `resolveTranscriptTokens` at generation.
- `lib/transcript-timestamps.ts` — `buildIndexedTranscript`, `resolveTranscriptTokens` (reuse verbatim).
- `app/api/videos/[id]/html-doc/route.ts` — guard/lock/grace pattern to copy.
- `components/HtmlDocStatusBar.tsx` — `viewUrl` prop pattern to mirror.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/version.ts` | Shared `isOlder(a,b)` comparator on `{major,minor}` | Create |
| `lib/doc-version.ts` | Summary version; re-imports `isOlder` from `lib/version` | Modify |
| `lib/deep-dive/version.ts` | `DeepDiveVersion`, `CURRENT_DEEP_DIVE_VERSION`, `needsRegenerate` | Create |
| `lib/deep-dive/ensure.ts` | `ensureDeepDiveHtml` orchestrator (decision tree) | Create |
| `lib/deep-dive/write-doc.ts` | `writeDeepDiveDoc` — cascade + write `.md` (resolved ▶, NO pdf) | Create |
| `lib/gemini.ts` | Deep-dive generators: indexed transcript + token instruction + internal `resolveTranscriptTokens` | Modify |
| `lib/deep-dive.ts` | Old `runDeepDive` — removed; cascade logic moves to `write-doc.ts` | Modify/Remove |
| `lib/html-doc/generate-deep-dive.ts` | `runDeepDiveHtml` (return rel path too) + new `reRenderDeepDiveHtml` | Modify |
| `lib/html-doc/render-deep-dive.ts` | UNCHANGED (renders markdown that already has ▶ lines) | — |
| `types/index.ts` | `Video.deepDiveVersion?`, `Video.deepDiveHtml?` | Modify |
| `app/api/videos/[id]/deep-dive/route.ts` | Drive `ensureDeepDiveHtml`; guard/lock/grace | Modify |
| `app/api/html/[id]/route.ts` | `type=deep-dive` reads stored `deepDiveHtml` (lazy fallback) | Modify |
| `components/VideoMenu.tsx` | Unify "Deep Dive" + "View Deep Dive HTML" → one "Deep Dive doc" | Modify |
| `components/DeepDiveStatusBar.tsx` | `viewUrl` prop → "View Deep Dive doc" link on done | Modify |
| `app/page.tsx` | `busyVideoId` reflects either job; pass `viewUrl` to DeepDiveStatusBar | Modify |

---

## Task 1: Shared `isOlder` + deep-dive version module + types

**Files:**
- Create: `lib/version.ts`
- Modify: `lib/doc-version.ts`
- Create: `lib/deep-dive/version.ts`
- Modify: `types/index.ts:57-75` (VideoSchema)
- Test: `tests/lib/version.test.ts`, `tests/lib/deep-dive/version.test.ts`

- [ ] **Step 1: Write the failing test for the shared comparator**

`tests/lib/version.test.ts`:
```ts
import { isOlder } from '../../lib/version';

describe('isOlder', () => {
  it('is true when major is smaller', () => {
    expect(isOlder({ major: 1, minor: 9 }, { major: 2, minor: 0 })).toBe(true);
  });
  it('is true when major equal and minor smaller', () => {
    expect(isOlder({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(true);
  });
  it('is false when equal', () => {
    expect(isOlder({ major: 2, minor: 1 }, { major: 2, minor: 1 })).toBe(false);
  });
  it('is false when newer', () => {
    expect(isOlder({ major: 3, minor: 0 }, { major: 2, minor: 9 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx jest version.test` — Expected: FAIL, "Cannot find module '../../lib/version'".

- [ ] **Step 3: Create `lib/version.ts`**

```ts
/** A two-part version. */
export interface Version {
  major: number;
  minor: number;
}

/** True when `a` is an older version than `b` (major dominates, then minor). */
export function isOlder(a: Version, b: Version): boolean {
  return a.major < b.major || (a.major === b.major && a.minor < b.minor);
}
```

- [ ] **Step 4: Re-point `lib/doc-version.ts` at the shared comparator**

Replace the local `isOlder` (lines 10-13) with a re-export, keeping the public API identical:
```ts
import { isOlder } from './version';
export { isOlder };
```
Leave `DocVersion`, `CURRENT_DOC_VERSION`, `needsResummarize` as-is. (`DocVersion` stays structurally compatible with `Version`.)

- [ ] **Step 5: Write the failing test for the deep-dive version module**

`tests/lib/deep-dive/version.test.ts`:
```ts
import { CURRENT_DEEP_DIVE_VERSION, needsRegenerate } from '../../../lib/deep-dive/version';

describe('deep-dive version', () => {
  it('CURRENT is {2,0}', () => {
    expect(CURRENT_DEEP_DIVE_VERSION).toEqual({ major: 2, minor: 0 });
  });
  it('needsRegenerate when stored major is behind', () => {
    expect(needsRegenerate({ major: 1, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(true);
  });
  it('does NOT need regenerate on a minor-only gap', () => {
    expect(needsRegenerate({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(false);
  });
});
```

- [ ] **Step 6: Run it, confirm it fails**

Run: `npx jest deep-dive/version` — Expected: FAIL, module not found.

- [ ] **Step 7: Create `lib/deep-dive/version.ts`**

```ts
import type { Version } from '../version';

/** Deep-dive output version. MAJOR = .md/prompt format (bump ⇒ re-run cascade). MINOR = HTML render/style (bump ⇒ cheap re-render from .md). */
export type DeepDiveVersion = Version;

/** The version current code produces. major 2 = ▶ section timestamps. */
export const CURRENT_DEEP_DIVE_VERSION: DeepDiveVersion = { major: 2, minor: 0 };

/** True when reaching `current` from `stored` requires re-running the Gemini cascade (a .md-format / major advance). */
export function needsRegenerate(stored: DeepDiveVersion, current: DeepDiveVersion): boolean {
  return stored.major < current.major;
}
```

- [ ] **Step 8: Add the index fields to `types/index.ts`**

In `VideoSchema` (after line 59, `summaryHtml`), add:
```ts
  deepDiveHtml: z.string().nullable().optional(),
  deepDiveVersion: DocVersionSchema.optional(), // absent ⇒ pre-feature {1,0}; stamped to CURRENT_DEEP_DIVE_VERSION on (re)generation
```
(`DocVersionSchema` already exists at line 40 and matches the `{major,minor}` shape.)

- [ ] **Step 9: Run the new tests + the existing summary version tests (regression)**

Run: `npx jest version doc-version` — Expected: PASS (new + existing `tests/lib/doc-version.test.ts` still green, proving the `isOlder` extraction is transparent).

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit` — Expected: no NEW errors (only the 2 pre-existing `theme.test.ts` baseline errors).

- [ ] **Step 11: Commit**

```bash
git add lib/version.ts lib/doc-version.ts lib/deep-dive/version.ts types/index.ts tests/lib/version.test.ts tests/lib/deep-dive/version.test.ts
git commit -m "feat(deep-dive): shared isOlder + deepDiveVersion module + index fields"
```

---

## Task 2: Deep-dive generators emit + resolve timestamps (`lib/gemini.ts`)

**Files:**
- Modify: `lib/gemini.ts` (`buildDeepDivePrompt`, `generateDeepDiveCombined`, `generateDeepDiveFromTranscript`)
- Test: `tests/lib/gemini-deepdive-timestamps.test.ts`

**Behavior:** the combined / transcript-only generators accept `segments` + `videoId`, embed `buildIndexedTranscript(segments)` in the prompt, instruct own-line `[[TS:i]]` tokens after each `## ` heading, and call `resolveTranscriptTokens` **before returning** so the returned markdown has resolved `▶` lines. Video-only (`generateDeepDive`) is unchanged.

- [ ] **Step 1: Write the failing test**

`tests/lib/gemini-deepdive-timestamps.test.ts`:
```ts
import type { TranscriptSegment } from '../../lib/transcript-timestamps';

// Capture the prompt and return canned markdown WITH a token.
const generateContent = jest.fn(async () => ({ response: { text: () => '## A\n\n[[TS:0]]\n\nbody\n\n## B\n\n[[TS:1]]\n\nmore' } }));
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent }),
  })),
}));

const SEGMENTS: TranscriptSegment[] = [
  { text: 'intro', offset: 0, duration: 60 },
  { text: 'middle', offset: 60, duration: 60 },
];

describe('generateDeepDiveFromTranscript with timestamps', () => {
  beforeEach(() => { generateContent.mockClear(); process.env.GEMINI_API_KEY = 'k'; });

  it('embeds the indexed transcript + token instruction and resolves tokens to ▶ lines', async () => {
    const { generateDeepDiveFromTranscript } = await import('../../lib/gemini');
    const out = await generateDeepDiveFromTranscript(SEGMENTS, 'en', 'vid123');
    const prompt = generateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('[0 @0:00] intro');
    expect(prompt).toContain('[[TS:<index>]]');
    // Tokens resolved → ▶ lines with real URL; no raw token survives.
    expect(out).toContain('▶ [0:00–1:00](https://www.youtube.com/watch?v=vid123&t=0s)');
    expect(out).not.toContain('[[TS:');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx jest gemini-deepdive-timestamps` — Expected: FAIL (signature is `(transcript: string, …)`, no indexed transcript / resolution).

- [ ] **Step 3: Add a timestamp instruction to `buildDeepDivePrompt`**

Add an optional 4th param and an instruction block (mirrors `generateSummary`'s wording at gemini.ts:84). Change the signature to:
```ts
export function buildDeepDivePrompt(
  lang: string,
  mode: 'video' | 'transcript' | 'combined',
  withTimestamps = false,
): string {
```
Inside, build the requirements list as today, and when `withTimestamps` is true append this bullet to the Requirements list:
```ts
  const timestampRule = withTimestamps
    ? `\n- Immediately AFTER each \`## \` heading line, a line containing ONLY a token of the form [[TS:<index>]], where <index> is the bracketed number of the transcript segment (from the indexed transcript) where that section begins. The indices MUST strictly increase down the document.`
    : '';
```
Insert `${timestampRule}` into the returned template right after the "Preserve grounded specifics" bullet. When `withTimestamps`, the transcript is supplied as the indexed list (the caller appends it), so also change the combined/transcript callers to note "The transcript is an indexed list, one segment per line as [<index> @<timestamp>] <text>." (append that sentence in the generator, see Step 4).

- [ ] **Step 4: Update the two generators to take segments + resolve**

Add the import at the top of `lib/gemini.ts` (it already imports `buildIndexedTranscript, resolveTranscriptTokens`) and `import type { TranscriptSegment } from './transcript-timestamps';` (already imported).

Replace `generateDeepDiveFromTranscript`:
```ts
export async function generateDeepDiveFromTranscript(
  segments: TranscriptSegment[],
  language: 'en' | 'ko',
  videoId: string,
): Promise<string> {
  const client = new GoogleGenerativeAI(getApiKey());
  const model = client.getGenerativeModel({ model: DEEPDIVE_MODEL });
  const lang = language === 'ko' ? 'Korean (한국어)' : 'English';
  const indexed = buildIndexedTranscript(segments);
  const prompt = buildDeepDivePrompt(lang, 'transcript', true) +
    '\n\nThe transcript is an indexed list, one segment per line as [<index> @<timestamp>] <text>:' +
    '\n\n<transcript>\n' + indexed + '\n</transcript>';
  try {
    const result = await model.generateContent(prompt, { timeout: REQUEST_TIMEOUT_MS });
    return resolveTranscriptTokens(result.response.text(), segments, videoId);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini deep-dive (transcript) failed: ${cause}`, { cause: err });
  }
}
```

Replace `generateDeepDiveCombined`:
```ts
export async function generateDeepDiveCombined(
  youtubeUrl: string,
  segments: TranscriptSegment[],
  language: 'en' | 'ko',
  videoId: string,
): Promise<string> {
  const client = new GoogleGenerativeAI(getApiKey());
  const model = client.getGenerativeModel({ model: DEEPDIVE_MODEL });
  const lang = language === 'ko' ? 'Korean (한국어)' : 'English';
  const indexed = buildIndexedTranscript(segments);
  const request = {
    contents: [{
      role: 'user',
      parts: [
        { fileData: { fileUri: youtubeUrl, mimeType: 'video/mp4' } },
        { text: `${buildDeepDivePrompt(lang, 'combined', true)}\n\nThe transcript is an indexed list, one segment per line as [<index> @<timestamp>] <text>:\n\n<transcript>\n${indexed}\n</transcript>` },
      ],
    }],
  };
  try {
    const result = await model.generateContent(request, { timeout: REQUEST_TIMEOUT_MS });
    return resolveTranscriptTokens(result.response.text(), segments, videoId);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini deep-dive (combined) failed: ${cause}`, { cause: err });
  }
}
```
Leave `generateDeepDive` (video-only) unchanged.

- [ ] **Step 5: Run the new test + the existing deep-dive gemini tests**

Run: `npx jest gemini-deepdive` — Expected: the new test PASSES. Existing `tests/lib/gemini-deepdive-combined.test.ts` / `gemini-deepdive-prompt.test.ts` will FAIL on the changed signatures — update those call sites to pass `segments`/`videoId` (they currently pass a string). Fix them to the new signature and keep their intent.

- [ ] **Step 6: Run full gemini suite + typecheck**

Run: `npx jest gemini` then `npx tsc --noEmit` — Expected: all green; no new tsc errors.

- [ ] **Step 7: Commit**

```bash
git add lib/gemini.ts tests/lib/gemini-deepdive-timestamps.test.ts tests/lib/gemini-deepdive-combined.test.ts tests/lib/gemini-deepdive-prompt.test.ts
git commit -m "feat(deep-dive): generators emit + resolve ▶ timestamps (indexed transcript)"
```

---

## Task 3: Deep-dive HTML render + cheap re-render (`lib/html-doc/generate-deep-dive.ts`)

**Files:**
- Modify: `lib/html-doc/generate-deep-dive.ts`
- Test: `tests/lib/html-doc/generate-deep-dive.test.ts` (extend)

**Behavior:** `runDeepDiveHtml` additionally returns the written rel path so the orchestrator can store it. Add `reRenderDeepDiveHtml(videoId, outputFolder)` — reads the existing `.md`, renders, atomic-writes `htmls/<base>.html`, returns `{ status, htmlPath }`. The `.md` is the source of truth (no model envelope); only guards on `.md` presence.

- [ ] **Step 1: Write the failing test**

`tests/lib/html-doc/generate-deep-dive.test.ts` (add):
```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { reRenderDeepDiveHtml } from '../../../lib/html-doc/generate-deep-dive';

function tmpFolderWithDeepDive(md: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
  fs.writeFileSync(path.join(dir, 'playlist-index.json'), JSON.stringify({
    playlistUrl: 'https://youtube.com/playlist?list=x', outputFolder: dir,
    videos: [{ id: 'v1', title: 'T', youtubeUrl: 'https://youtube.com/watch?v=v1', language: 'en',
      durationSeconds: 100, archived: false,
      ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 }, overallScore: 3,
      summaryMd: null, summaryPdf: null, deepDiveMd: '1-t-deep-dive.md', deepDivePdf: null,
      processedAt: new Date().toISOString() }],
  }));
  fs.writeFileSync(path.join(dir, '1-t-deep-dive.md'), md);
  return dir;
}

it('reRenderDeepDiveHtml writes html from the .md and returns its rel path', () => {
  const dir = tmpFolderWithDeepDive('---\nvideo_id: "v1"\nlang: EN\n---\n\n# T (Deep Dive)\n\n## A\n\nbody');
  const res = reRenderDeepDiveHtml('v1', dir);
  expect(res.status).toBe('rerendered');
  expect(res.htmlPath).toBe('htmls/1-t-deep-dive.html');
  expect(fs.existsSync(path.join(dir, 'htmls/1-t-deep-dive.html'))).toBe(true);
});

it('reRenderDeepDiveHtml returns skipped-no-md when the video has no deepDiveMd', () => {
  const dir = tmpFolderWithDeepDive('x');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  idx.videos[0].deepDiveMd = null;
  fs.writeFileSync(path.join(dir, 'playlist-index.json'), JSON.stringify(idx));
  expect(reRenderDeepDiveHtml('v1', dir).status).toBe('skipped-no-md');
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx jest generate-deep-dive` — Expected: FAIL, `reRenderDeepDiveHtml` not exported.

- [ ] **Step 3: Implement `reRenderDeepDiveHtml` + return rel path from `runDeepDiveHtml`**

In `lib/html-doc/generate-deep-dive.ts`, change `runDeepDiveHtml` to return `{ html: string; htmlPath: string }` (currently returns `html`). Add the rel path:
```ts
  const htmlRel = `htmls/${base}.html`;
  // ... after the atomic write ...
  return { html, htmlPath: htmlRel };
```
Then add:
```ts
export type DeepDiveReRenderResult =
  | { status: 'rerendered'; htmlPath: string }
  | { status: 'skipped-not-eligible' }
  | { status: 'skipped-no-md' };

/** Re-render one deep-dive's HTML from its existing .md — no Gemini, no transcript fetch.
 * The .md (already containing resolved ▶ lines) is the source of truth. */
export function reRenderDeepDiveHtml(videoId: string, outputFolder: string): DeepDiveReRenderResult {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);
  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) return { status: 'skipped-not-eligible' };
  if (!video.deepDiveMd) return { status: 'skipped-no-md' };

  let mdContent: string;
  try { mdContent = fs.readFileSync(path.join(outputFolder, video.deepDiveMd), 'utf-8'); }
  catch { return { status: 'skipped-no-md' }; }

  const html = renderDeepDiveHtml(mdContent, video.deepDiveMd);
  const base = video.deepDiveMd.replace(/\.md$/, '');
  const htmlRel = `htmls/${base}.html`;
  const finalPath = path.join(outputFolder, htmlRel);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  return { status: 'rerendered', htmlPath: htmlRel };
}
```

- [ ] **Step 4: Update the serve route's call site for the new return shape**

`app/api/html/[id]/route.ts:84` currently does `const html = await runDeepDiveHtml(...)`. Change to `const { html } = await runDeepDiveHtml(...)`. (Full serve-route change is Task 6; this keeps it compiling.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest generate-deep-dive` then `npx tsc --noEmit` — Expected: PASS; no new tsc errors.

- [ ] **Step 6: Commit**

```bash
git add lib/html-doc/generate-deep-dive.ts app/api/html/[id]/route.ts tests/lib/html-doc/generate-deep-dive.test.ts
git commit -m "feat(deep-dive): reRenderDeepDiveHtml (cheap, from .md) + runDeepDiveHtml returns path"
```

---

## Task 4: `writeDeepDiveDoc` + `ensureDeepDiveHtml` orchestrator

**Files:**
- Create: `lib/deep-dive/write-doc.ts` (cascade + write `.md`, resolved ▶, NO pdf)
- Create: `lib/deep-dive/ensure.ts` (`ensureDeepDiveHtml` decision tree)
- Test: `tests/lib/deep-dive/write-doc.test.ts`, `tests/lib/deep-dive/ensure.test.ts`

**Behavior:** `writeDeepDiveDoc` extracts the cascade from the old `runDeepDive` (fetch segments → combined → transcript-only → video-only), writes the `.md` (frontmatter + resolved ▶ body), returns `{ deepDiveMd }`. **No PDF** (D6 — mirrors `writeSummaryDoc`). `ensureDeepDiveHtml` runs the Staleness→action table, stamping `deepDiveVersion` + `deepDiveHtml` only on full success.

> **Conditional behaviors adversarial review (REQUIRED before tests):** this task has >8 behaviors, an SSE progress sequence, and 4 error paths. Before Step 1, enumerate the behaviors table in this plan file and run a Codex adversarial review of it (`codex:rescue --fresh`), per dev-process. Save to `docs/reviews/task-4-ensure-deepdive-codex.md`.

**Enumerated Behaviors:**

| # | Behavior | Trigger | Expected |
|---|----------|---------|----------|
| 1 | First-time generate | `deepDiveMd` null | cascade → write `.md` → render+store `deepDiveHtml` → stamp `{2,0}` |
| 2 | Major-stale regenerate | `needsRegenerate(stored)` | same as #1 |
| 3 | HTML missing, md current | `.md` current, `deepDiveHtml` null | render from `.md` → store → stamp |
| 4 | Minor-stale | `isOlder(stored,CURRENT)`, html present | `reRenderDeepDiveHtml` → store → stamp |
| 5 | Already current | none of the above | no-op, emit `done`, no Gemini |
| 6 | Combined path | transcript segments fetched | uses `generateDeepDiveCombined`, ▶ present |
| 7 | Transcript-only fallback | combined throws | `generateDeepDiveFromTranscript`, ▶ present |
| 8 | Video-only fallback | no segments / both throw | `generateDeepDive`, NO ▶, still stamp `{2,0}` |
| 9 | All paths fail | every generator throws | throw; **no stamp**; error propagates to route |
| 10 | Render fails after md write | `renderDeepDiveHtml` throws | throw; **no stamp** |
| 11 | Video not in index | bad id | throw `Video not found` |
| 12 | Progress events | any success path | `start` … `step`* … `done` (done after stamp) |

- [ ] **Step 1: Write failing tests for `writeDeepDiveDoc`**

`tests/lib/deep-dive/write-doc.test.ts` — mock `./gemini` and `../youtube`:
```ts
jest.mock('../../../lib/gemini');
jest.mock('../../../lib/youtube');
import * as gemini from '../../../lib/gemini';
import * as youtube from '../../../lib/youtube';
import fs from 'fs'; import os from 'os'; import path from 'path';
import { writeDeepDiveDoc } from '../../../lib/deep-dive/write-doc';

const SEGS = [{ text: 'a', offset: 0, duration: 10 }, { text: 'b', offset: 10, duration: 10 }];
function folder() { /* same tmp helper as Task 3, with deepDiveMd: null */ }

it('combined path writes .md with resolved ▶ body and no PDF', async () => {
  (youtube.fetchTranscriptSegments as jest.Mock).mockResolvedValue(SEGS);
  (gemini.generateDeepDiveCombined as jest.Mock).mockResolvedValue('## A\n\n▶ [0:00–0:10](https://www.youtube.com/watch?v=v1&t=0s)\n\nbody');
  const dir = folder();
  const res = await writeDeepDiveDoc(/* video */, dir, () => {});
  expect(res.deepDiveMd).toBe('1-t-deep-dive.md');
  const md = fs.readFileSync(path.join(dir, '1-t-deep-dive.md'), 'utf-8');
  expect(md).toContain('▶ [0:00–0:10]');
  expect(res).not.toHaveProperty('deepDivePdf'); // PDF left stale (D6)
});

it('falls back to video-only when no segments (no ▶, still succeeds)', async () => {
  (youtube.fetchTranscriptSegments as jest.Mock).mockRejectedValue(new Error('no transcript'));
  (gemini.generateDeepDive as jest.Mock).mockResolvedValue('## A\n\nbody');
  // ... assert .md written without ▶
});
```
(Use the Task-3 tmp helper; the `video` arg is the index entry — see the implementation signature in Step 3.)

- [ ] **Step 2: Run, confirm fails** — `npx jest deep-dive/write-doc` → module not found.

- [ ] **Step 3: Implement `lib/deep-dive/write-doc.ts`**

Port the cascade + `.md` assembly from the existing `lib/deep-dive.ts:36-126` **with two changes**: (a) fetch `fetchTranscriptSegments` (not `fetchTranscript`) and pass `segments`/`videoId` to the generators; (b) **drop the PDF block** (lines 128-131) and the `deepDivePdf` field. Signature:
```ts
import fs from 'fs';
import path from 'path';
import { generateDeepDive, generateDeepDiveCombined, generateDeepDiveFromTranscript } from '../gemini';
import { fetchTranscriptSegments } from '../youtube';
import type { Video, ProgressEvent } from '../../types';

export async function writeDeepDiveDoc(
  video: Video,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
): Promise<{ deepDiveMd: string }> {
  // 1. onProgress step 'Fetching transcript…'
  // 2. let segments via fetchTranscriptSegments(video.id) in try/catch → null on failure
  // 3. cascade: segments ? combined(url,segments,lang,id) catch → fromTranscript(segments,lang,id) catch → deepDive(url,lang)
  //            : deepDive(url,lang)   [collect errors[]; throw on all-fail]
  // 4. strip leading H1, build frontmatter (copy lib/deep-dive.ts:88-123 verbatim), write <base>-deep-dive.md
  // 5. invalidate htmls/<base>-deep-dive.html cache (copy lines 84-86)
  // 6. return { deepDiveMd: `${base}-deep-dive.md` }
}
```
(Reproduce the frontmatter/meta/body assembly from `lib/deep-dive.ts` exactly — do not paraphrase it.)

- [ ] **Step 4: Run write-doc tests** — `npx jest deep-dive/write-doc` → PASS.

- [ ] **Step 5: Write failing tests for `ensureDeepDiveHtml`** (cover behaviors #1-#12)

`tests/lib/deep-dive/ensure.test.ts` — mock `./write-doc`, `../html-doc/generate-deep-dive`, and use a tmp index. Key cases:
```ts
it('major-stale: regenerates, renders, stamps {2,0} + deepDiveHtml', async () => { /* stored {1,0} */ });
it('minor-stale: cheap re-render, no writeDeepDiveDoc call', async () => { /* stored {2,0}, CURRENT {2,1} */ });
it('html missing but md current: renders from md, stamps', async () => {});
it('already current: no-op, emits done, no writeDeepDiveDoc/render', async () => {});
it('does NOT stamp when writeDeepDiveDoc throws', async () => {});
it('emits done AFTER the version stamp', async () => { /* assert order via mock call sequence */ });
```

- [ ] **Step 6: Run, confirm fails** — module not found.

- [ ] **Step 7: Implement `lib/deep-dive/ensure.ts`** (mirror `lib/html-doc/ensure.ts`)

```ts
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../index-store';
import { writeDeepDiveDoc } from './write-doc';
import { runDeepDiveHtml, reRenderDeepDiveHtml } from '../html-doc/generate-deep-dive';
import { CURRENT_DEEP_DIVE_VERSION, needsRegenerate, type DeepDiveVersion } from './version';
import { isOlder } from '../version';
import type { ProgressEvent } from '../../types';

const PRE_FEATURE: DeepDiveVersion = { major: 1, minor: 0 };

export async function ensureDeepDiveHtml(
  videoId: string,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  current: DeepDiveVersion = CURRENT_DEEP_DIVE_VERSION,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);
  const video = readIndex(outputFolder).videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);

  const stored: DeepDiveVersion = video.deepDiveVersion ?? PRE_FEATURE;
  onProgress({ type: 'start' });

  if (!video.deepDiveMd || needsRegenerate(stored, current)) {
    const { deepDiveMd } = await writeDeepDiveDoc(video, outputFolder, onProgress);
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 1, total: 1 });
    const { htmlPath } = await runDeepDiveHtml(videoId, outputFolder);
    updateVideoFields(outputFolder, videoId, { deepDiveMd, deepDiveHtml: htmlPath, deepDiveVersion: current });
  } else if (!video.deepDiveHtml) {
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 1, total: 1 });
    const { htmlPath } = await runDeepDiveHtml(videoId, outputFolder);
    updateVideoFields(outputFolder, videoId, { deepDiveHtml: htmlPath, deepDiveVersion: current });
  } else if (isOlder(stored, current)) {
    onProgress({ type: 'step', videoId, step: 'Re-rendering HTML…', current: 1, total: 1 });
    const rr = reRenderDeepDiveHtml(videoId, outputFolder);
    const htmlPath = rr.status === 'rerendered' ? rr.htmlPath : (await runDeepDiveHtml(videoId, outputFolder)).htmlPath;
    updateVideoFields(outputFolder, videoId, { deepDiveHtml: htmlPath, deepDiveVersion: current });
  } else {
    onProgress({ type: 'done' });
    return;
  }

  onProgress({ type: 'done' });
}
```

- [ ] **Step 8: Run ensure tests** — `npx jest deep-dive/ensure` → PASS.

- [ ] **Step 9: Full suite + typecheck** — `npx jest` then `npx tsc --noEmit` → all green (note: `lib/deep-dive.ts`/`runDeepDive` is still present and now unused; it's removed in Task 5).

- [ ] **Step 10: Codex adversarial review of the code** (per Per-Task Checklist). Save to `docs/reviews/task-4-ensure-deepdive-codex.md`. Address High/P1 findings, re-run tests.

- [ ] **Step 11: Commit**

```bash
git add lib/deep-dive/write-doc.ts lib/deep-dive/ensure.ts tests/lib/deep-dive/ docs/reviews/task-4-ensure-deepdive-codex.md
git commit -m "feat(deep-dive): writeDeepDiveDoc (no pdf) + ensureDeepDiveHtml orchestrator"
```

---

## Task 5: API route — version-aware + guard/lock/grace (`deep-dive/route.ts`)

**Files:**
- Modify: `app/api/videos/[id]/deep-dive/route.ts`
- Remove: `lib/deep-dive.ts` (`runDeepDive` — superseded by `ensureDeepDiveHtml` + `writeDeepDiveDoc`)
- Test: `tests/api/deep-dive-post.test.ts`

**Behavior:** mirror `html-doc/route.ts` exactly — `ensureDeepDiveHtml`, `getActiveJob` double-submit guard, `releaseJobLock` + `GRACE_MS` delete, dev-logger on failure.

- [ ] **Step 1: Write failing test** `tests/api/deep-dive-post.test.ts` (model on `tests/api/regenerate.test.ts`):
```ts
it('returns the existing jobId on a double-submit for the same (folder, video)', async () => { /* mock ensureDeepDiveHtml to hang; POST twice; assert same jobId */ });
it('drives ensureDeepDiveHtml and returns a jobId', async () => {});
```

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Rewrite the route** — copy `app/api/videos/[id]/html-doc/route.ts` verbatim, swapping `ensureHtmlDoc`→`ensureDeepDiveHtml`, import path `../../../../../lib/deep-dive/ensure`, and the logError tag `html-doc:`→`deep-dive:`. Keep the `getActiveJob`/`releaseJobLock`/`GRACE_MS` machinery identical.

- [ ] **Step 4: Delete `lib/deep-dive.ts`** and fix any remaining imports (`grep -rn "from.*lib/deep-dive'" --include=*.ts` — should only be the old route, now rewritten).

- [ ] **Step 5: Run route tests + full suite + typecheck.** Expected: PASS; no new tsc errors; no dangling import of `runDeepDive`.

- [ ] **Step 6: Commit**

```bash
git add app/api/videos/[id]/deep-dive/route.ts tests/api/deep-dive-post.test.ts
git rm lib/deep-dive.ts
git commit -m "feat(deep-dive): route drives ensureDeepDiveHtml (guard/lock/grace); drop runDeepDive"
```

---

## Task 6: Serve route reads stored `deepDiveHtml` (`html/[id]/route.ts`)

**Files:**
- Modify: `app/api/html/[id]/route.ts:70-89`
- Test: `tests/api/html-serve.test.ts` (or extend the existing serve test)

**Behavior:** `type=deep-dive` serves the stored `video.deepDiveHtml` (guarded), falling back to lazy `runDeepDiveHtml` when it's null (old data).

- [ ] **Step 1: Write failing tests:**
```ts
it('serves the stored deepDiveHtml file when present', async () => {});
it('falls back to lazy render when deepDiveHtml is null but deepDiveMd exists', async () => {});
it('404s when neither deepDiveHtml nor deepDiveMd exist', async () => {});
```

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement** — replace the `type === 'deep-dive'` block (lines 70-89):
```ts
  // type === 'deep-dive'
  const stored = video.deepDiveHtml;
  if (stored) {
    const bad = guard(stored);
    if (bad) return bad;
    try { return serveHtml(fs.readFileSync(path.resolve(outputFolder, stored), 'utf-8')); }
    catch { /* fall through to lazy render */ }
  }
  if (!video.deepDiveMd) {
    return new Response(JSON.stringify({ error: 'deep dive not available' }), { status: 404 });
  }
  try {
    const { html } = await runDeepDiveHtml(videoId, outputFolder);
    return serveHtml(html);
  } catch {
    return new Response(JSON.stringify({ error: 'failed to render deep dive html' }), { status: 500 });
  }
```

- [ ] **Step 4: Run serve tests + typecheck.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/html/[id]/route.ts tests/api/html-serve.test.ts
git commit -m "feat(deep-dive): serve route reads stored deepDiveHtml (lazy fallback)"
```

---

## Task 7: VideoMenu — unify into one version-aware "Deep Dive doc"

**Files:**
- Modify: `components/VideoMenu.tsx`
- Test: `tests/components/VideoMenu.test.tsx` (extend)

**Behavior:** remove the "Deep Dive" (regenerate) item (lines 97-101) and the "View Deep Dive HTML" item (lines 136-146); add one "Deep Dive doc" item mirroring "HTML doc" (lines 87-96): link when current, button when stale/never, disabled+hourglass when busy.

- [ ] **Step 1: Write failing component tests:**
```ts
it('shows "Deep Dive doc" as a link when current (deepDiveHtml set, version current)', () => {
  // video.deepDiveHtml='htmls/x.html', deepDiveVersion={major:2,minor:0}
  // expect a link with href containing 'type=deep-dive' AND the outputFolder param
});
it('shows "Deep Dive doc" as a regenerate button when stale (no deepDiveVersion)', () => {
  // expect a <button>; clicking calls onDeepDive(video.id)
});
it('shows "Deep Dive doc" as a button when never generated (deepDiveMd null)', () => {});
it('disables "Deep Dive doc" with an hourglass when busy', () => {});
```

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement** — import `CURRENT_DEEP_DIVE_VERSION` from `@/lib/deep-dive/version` and reuse `isOlder` from `@/lib/doc-version` (re-exported). Replace the "Deep Dive" `<li>` (97-101) with the unified item, and delete the "View Deep Dive HTML" `<li>` (136-146):
```tsx
<li role="none">
  {(() => {
    const current = !!video.deepDiveHtml && !isOlder(video.deepDiveVersion ?? { major: 1, minor: 0 }, CURRENT_DEEP_DIVE_VERSION);
    if (busy) return <span aria-disabled="true" className={disabledClass}>Deep Dive doc <span aria-hidden="true">⏳</span></span>;
    return current
      ? <a href={deepDiveHtmlHref} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>Deep Dive doc</a>
      : <button type="button" onClick={() => { onDeepDive(video.id); onClose(); }} className={itemClass}>Deep Dive doc</button>;
  })()}
</li>
```
(`deepDiveHtmlHref` already exists at line 50. Keep "Open Deep Dive in Obsidian" and "View Deep Dive PDF" items as-is.)

- [ ] **Step 4: Run** `npx jest VideoMenu` → PASS. Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add components/VideoMenu.tsx tests/components/VideoMenu.test.tsx
git commit -m "feat(deep-dive): unify menu into one version-aware 'Deep Dive doc' item"
```

---

## Task 8: Hourglass reflects either job (`app/page.tsx`)

**Files:**
- Modify: `app/page.tsx` (the `busyVideoId` passed to `<VideoList>`)
- Covered by: E2E (Task 10) per the project's TDD policy (UI wiring).

**Behavior:** today `busyVideoId` derives from the summary (`htmlJob`) only. It must be set while EITHER the summary or the deep-dive job is running, so the row hourglass shows for deep-dive regeneration too.

- [ ] **Step 1: Read `app/page.tsx`** — locate the deep-dive job state and the summary `htmlJob` state, and the `busyVideoId={…}` prop on `<VideoList>`.

- [ ] **Step 2: Implement** — change the `busyVideoId` expression to the deep-dive job's videoId when a deep-dive job is active, else the summary job's videoId. (Both jobs target one video at a time; if your state shape differs, derive `busyVideoId` from whichever job is non-null.) Example:
```tsx
busyVideoId={deepDiveJob?.videoId ?? htmlJob?.videoId ?? null}
```
(Use the actual state variable names found in Step 1.)

- [ ] **Step 3: Typecheck** `npx tsc --noEmit`. (Behavior verified in Task 10 E2E.)

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(deep-dive): row hourglass reflects deep-dive job too"
```

---

## Task 9: DeepDiveStatusBar — "View Deep Dive doc" link on done

**Files:**
- Modify: `components/DeepDiveStatusBar.tsx`, `app/page.tsx` (pass `viewUrl`)
- Test: `tests/components/DeepDiveStatusBar.test.tsx` (extend)

**Behavior:** add a `viewUrl` prop (mirroring `HtmlDocStatusBar`); on `done`, render a "View Deep Dive doc" link to it. Keep the existing ✕ and auto-close dismissal paths; align the auto-close delay to the summary bar's.

- [ ] **Step 1: Write failing tests:**
```ts
it('renders a "View Deep Dive doc" link to viewUrl on done', () => {
  // drive a 'done' SSE event via the FakeEventSource; expect a link with href === viewUrl
});
it('still auto-closes after done (onClose called)', () => {});
it('still closes on the ✕ button', () => {});
```
(Model the SSE faking on `tests/components/DeepDiveStatusBar.test.tsx`'s existing setup.)

- [ ] **Step 2: Run, confirm fails.**

- [ ] **Step 3: Implement** — add `viewUrl: string` to `DeepDiveStatusBarProps`; in the `state.status === 'done'` block (line 108-110), render the link beside/instead of "✓ Done":
```tsx
{state.status === 'done' && (
  <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 underline flex-shrink-0">
    View Deep Dive doc
  </a>
)}
```
Confirm the auto-close delay matches `HtmlDocStatusBar` (read it; align the `setTimeout` value at line 53).

- [ ] **Step 4: Wire `viewUrl` in `app/page.tsx`** — where `<DeepDiveStatusBar>` is rendered, pass `viewUrl={`/api/html/${encodeURIComponent(videoId)}?outputFolder=${encodeURIComponent(outputFolder)}&type=deep-dive`}` (use the same videoId/outputFolder the bar already receives).

- [ ] **Step 5: Run** `npx jest DeepDiveStatusBar` → PASS. Then `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add components/DeepDiveStatusBar.tsx app/page.tsx tests/components/DeepDiveStatusBar.test.tsx
git commit -m "feat(deep-dive): status bar shows 'View Deep Dive doc' link on done"
```

---

## Task 10: E2E (Playwright) — full flow + edge fixtures

**Files:**
- Test: `tests/e2e/deep-dive-doc.spec.ts`
- Fixtures: extend the E2E playlist fixture per the rules below.

**Fixtures (dev-process E2E rule — cover null AND non-null):**
- Video A: `deepDiveVersion {1,0}` (stale, pre-Bundle-B), transcript available.
- Video B: `deepDiveHtml` set + `deepDiveVersion {2,0}` (current).
- Video C: `deepDiveMd: null` (never generated).
- Video D: no transcript (forces video-only path; deep-dive at `{2,0}` with no ▶).

Mock at the **route level**: `POST /api/videos/[id]/deep-dive` resolves the SSE job; `GET /api/html/[id]?type=deep-dive` returns canned HTML.

- [ ] **Step 1: Write the E2E spec** with these blocks:
```ts
test('stale video → "Deep Dive doc" is a button → regenerates → becomes a link', async ({ page }) => {
  // click button; assert hourglass appears on the row; on done, status bar shows View link
});
test('current video → "Deep Dive doc" is a link; href asserts ALL params', async ({ page }) => {
  const href = await page.getByRole('link', { name: 'Deep Dive doc' }).getAttribute('href');
  const url = new URL(href!, 'http://x');
  expect(url.searchParams.get('type')).toBe('deep-dive');     // assert EVERY param
  expect(url.searchParams.get('outputFolder')).toBeTruthy();
});
test('status bar dismissal — ✕ button hides it', async ({ page }) => {});
test('status bar dismissal — auto-close after done hides it', async ({ page }) => {});
test('no-transcript video → regenerates via video-only, no ▶ lines in served HTML', async ({ page }) => {});
test('idempotent — second open of a current doc is a link, no regenerate POST fired', async ({ page }) => {});
```

- [ ] **Step 2: Run** `npx playwright test --grep "Deep Dive doc"` → PASS (start the dev server per repo convention).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/deep-dive-doc.spec.ts tests/e2e/fixtures/*
git commit -m "test(deep-dive): E2E flow, link params, dismissal, no-transcript, idempotency"
```

---

## Final verification (before PR)

- [ ] `npx jest` — full suite green (note the known `pdf.test.ts` puppeteer flake passes in isolation).
- [ ] `npx tsc --noEmit` — no new errors beyond the 2 pre-existing `theme.test.ts` baseline.
- [ ] `npx playwright test` — E2E green.
- [ ] Manual: a real pre-Bundle-B deep-dive → "Deep Dive doc" → regenerates → ▶ timestamps in the served HTML, `deepDiveVersion {2,0}` stamped, hourglass shown during, View link on done; PDF mtime unchanged; second click is a link (no regen).
- [ ] Whole-feature Claude review + Codex adversarial review; save to `docs/reviews/`.

---

## Self-Review (plan vs spec)

**Spec coverage:** §3 version → Task 1; §4 orchestrator → Task 4; §4 timestamps (resolve-at-generation) → Task 2; §5 output format → Tasks 2+4; §6 UI (menu/hourglass/status bar) → Tasks 7/8/9; §7 API + serve → Tasks 5/6; §8 error handling → Task 4 (behaviors #9/#10) + route dev-logger (Task 5); §9 testing → every task + Task 10; §10 non-goals (no PDF) → Task 4 Step 3 (PDF dropped); §11 file structure → File Structure table. No gaps.

**Type consistency:** `ensureDeepDiveHtml(videoId, outputFolder, onProgress, current?)` matches the route call (Task 5) and `ensureHtmlDoc`'s shape. `runDeepDiveHtml` returns `{ html, htmlPath }` (Task 3) — consumed in Task 4 (`htmlPath`) and Task 6 (`html`). `reRenderDeepDiveHtml` returns `{ status, htmlPath }` (Task 3) — consumed in Task 4. `CURRENT_DEEP_DIVE_VERSION`/`needsRegenerate` (Task 1) used in Task 4/7. `deepDiveHtml`/`deepDiveVersion` fields (Task 1) used in Tasks 4/6/7.

**Behavior note (flag to user):** dropping PDF generation (Task 4) means the "Deep Dive doc" action no longer produces a PDF; existing deep-dive PDFs are left untouched (stale). This follows D6 / the summary precedent but is a behavior change from the old `runDeepDive`.
