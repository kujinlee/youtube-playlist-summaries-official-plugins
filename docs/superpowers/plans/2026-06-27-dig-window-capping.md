# Dig Window-Capping via Gemini Slide Windows — Implementation Plan (rev 3, Gemini-window)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-section slide download with Gemini-provided per-slide windows: Gemini emits `[[SLIDE:start|end|caption]]`, and the pipeline downloads exactly `[start, min(end, start+MAX_CAPTURE_SEC)]` and writes the most-built frame.

**Architecture:** Three focused changes — the dig prompt asks for start/end + build-collapse (`generate.ts`), the parser carries `endSec` (`slide-tokens.ts`), and capture becomes a single bounded `yt-dlp` call + existing `pickLargestFile` (`slides.ts`). The rev-2 mechanical cut detector / extend-on-demand machinery is deleted; no `frame-select.ts`.

**Tech Stack:** TypeScript, Node `node:child_process` (`execFile`), `yt-dlp`, `ffmpeg`, Jest + ts-jest (SWC — `tsc --noEmit` is the real type gate).

**Spec:** `docs/superpowers/specs/2026-06-27-dig-window-capping-design.md` (rev 3)
**Supersedes:** the rev-2 mechanical plan (extend-on-demand + scene-threshold cut detector), per the duration-reliability spikes.

## Global Constraints

- **Security invariants (verbatim from `slides.ts`):** `assertVideoId(videoId)` before any exec; `youtubeUrl` server-built from the validated id; `execFile` argv-array only — never shell strings; asset paths containment-checked against `assetsRoot` **before** any write to `outPath`; temp clips always deleted in `finally`.
- **No real network in unit/component tests** — mock `node:child_process` at the module boundary (existing `slides.test.ts` pattern).
- **Type gate:** `npx tsc --noEmit` clean before every commit. (`noUncheckedIndexedAccess` is OFF — verified.)
- **Env-override pattern:** tunable constants via `numEnv(name, def)`, `DIG_` prefix.
- **Test gate per task:** targeted `npx jest <file>` green → full `npm test` green → commit. **No task may commit a red suite.**
- **`SlideToken` field name:** the start field stays `sec` (semantics now = the slide's settled start); a new `endSec: number | null` is added. Keeping `sec` avoids a rename ripple through `slides.ts`.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `lib/dig/generate.ts` | `buildDigPrompt` SLIDE rule → start/end + collapse; `DIG_GENERATOR_VERSION` 5→6 | **Modify** |
| `tests/lib/dig/generate.test.ts` | assert new prompt instruction; version → 6 | **Modify** |
| `lib/dig/slide-tokens.ts` | grammar `start\|end\|caption`; `SlideToken.endSec`; tolerant parse + validation | **Modify** |
| `tests/lib/dig/slide-tokens.test.ts` | add `endSec` to two shape assertions; new start/end cases | **Modify** |
| `lib/dig/slides.ts` | `captureSlideFrame` = one bounded download + `pickLargestFile`; delete `captureBestFrame`/`singleFrameCapture`/`parseFirstSceneChange`/`runCapture`/`SCENE_THRESHOLD`/`MAX_WINDOW_SEC`; add `MAX_CAPTURE_SEC`/`DEFAULT_FWD` | **Modify** |
| `tests/lib/dig/slides.test.ts` | replace old-download-behavior tests with window/most-built tests | **Modify** |
| `tests/lib/dig/slides-helpers.test.ts` | remove `parseFirstSceneChange` block; KEEP `pickLargestFile` + `numEnv` | **Modify** |

---

### Task 1: Prompt — emit `start|end` + collapse builds; bump version

**Files:**
- Modify: `lib/dig/generate.ts` (the `[[SLIDE:...]]` bullet in `buildDigPrompt`, its example line, and `DIG_GENERATOR_VERSION`)
- Test: `tests/lib/dig/generate.test.ts`

**Interfaces:**
- Produces: a `buildDigPrompt` whose SLIDE instruction requests two timestamps (settled-start, replaced-end) and a one-token-per-build collapse rule. `DIG_GENERATOR_VERSION = 6`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/dig/generate.test.ts — append in the 'buildDigPrompt — slide selectivity' describe
it('requests a start AND end timestamp for each slide', () => {
  const s = buildDigPrompt('en', 0, 100);
  expect(s).toMatch(/\[\[SLIDE:M:SS\|M:SS\|caption\]\]/);
  expect(s).toMatch(/replaced by different content or leaves the screen/i);
});
it('instructs one collapsed token for an animated build', () => {
  const s = buildDigPrompt('en', 0, 100);
  expect(s).toMatch(/fully[- ]assembled/i);
  expect(s).toMatch(/do not list each step/i);
});
// update the existing DIG_GENERATOR_VERSION test:
//   expect(DIG_GENERATOR_VERSION).toBe(6);
```

Update the existing assertion at `tests/lib/dig/generate.test.ts:188` from `toBe(5)` to `toBe(6)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest generate.test -t "start AND end"`
Expected: FAIL — prompt lacks the new instruction.

- [ ] **Step 3: Edit `buildDigPrompt`** — replace the single `[[SLIDE:M:SS|caption]]` bullet (currently one paragraph) with the start/end + collapse version, and update the caption-rule example to two times:

```ts
// lib/dig/generate.ts — inside buildDigPrompt's returned template, replace the SLIDE bullet:
- Emit [[SLIDE:M:SS|M:SS|caption]] when an on-screen visual carries meaning words alone cannot fully convey — a diagram, chart, architecture/flow figure, data visualization, a UI/result screenshot whose spatial layout matters, OR a slide showing code, a command, terminal/CLI output, or config whose on-screen text is the point. Emit it ONLY when that content is actually shown on screen — do NOT transcribe code into a fenced block, and do NOT invent a slide for code that is merely spoken. NEVER for title cards, bullet lists, quotes, tips, or a speaker on camera. The FIRST M:SS is the moment the slide is FULLY BUILT and settled (after any build/animation finishes); the SECOND M:SS is the moment it is replaced by different content or leaves the screen. For an animated build/diagram that assembles in steps, emit ONE token at the fully-assembled moment — do not list each step.
- The caption is a short plain-English description of the slide. It MUST NOT contain the characters [ ] ( ) or | — describe the slide in words; never paste raw code, YAML, or shell into the caption. (example: [[SLIDE:3:51|4:02|Diagram showing four capabilities]])
```

And bump the constant:

```ts
export const DIG_GENERATOR_VERSION = 6;
```

- [ ] **Step 4: Run tests** — `npx jest generate.test` → PASS (new + existing, version 6).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): prompt emits slide start|end + collapses builds; version 5→6"
```

---

### Task 2: Parser — `start|end` grammar + `SlideToken.endSec`

**Files:**
- Modify: `lib/dig/slide-tokens.ts` (`TOKEN_RE`, `SlideToken`, `parseSlideTokens`)
- Test: `tests/lib/dig/slide-tokens.test.ts`

**Interfaces:**
- Produces: `SlideToken { raw: string; sec: number; endSec: number | null; caption: string }`. `parseSlideTokens(md, windowStart, windowEnd)` parses `[[SLIDE:<time>|<time>|<caption>]]`. Tolerant: first field = `sec` (settled start); if the second field parses as a time and `> sec` it becomes `endSec` (clamped to `windowEnd`), else the field is the caption and `endSec = null`. Dedup by `sec`, cap 3 (unchanged). `sec` validated `∈ [windowStart, windowEnd]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/dig/slide-tokens.test.ts
// 1) Update the two existing shape assertions to include endSec:
//    line ~6:  .toEqual([{ raw: '[[SLIDE:312|Diagram]]', sec: 312, endSec: null, caption: 'Diagram' }]);
//    line ~116: .toEqual([{ raw: '[[SLIDE:5:2|cap]]', sec: 302, endSec: null, caption: 'cap' }]);
// 2) Append new cases:
it('parses start|end|caption into sec + endSec', () => {
  expect(parseSlideTokens('[[SLIDE:333|339|code box]]', 300, 400))
    .toEqual([{ raw: '[[SLIDE:333|339|code box]]', sec: 333, endSec: 339, caption: 'code box' }]);
});
it('parses clock start|end', () => {
  const t = parseSlideTokens('[[SLIDE:5:33|5:39|cap]]', 300, 400);
  expect(t[0].sec).toBe(333); expect(t[0].endSec).toBe(339);
});
it('old single-time format → endSec null (tolerant)', () => {
  expect(parseSlideTokens('[[SLIDE:312|Diagram]]', 300, 400)[0].endSec).toBeNull();
});
it('end <= start is rejected → endSec null', () => {
  expect(parseSlideTokens('[[SLIDE:333|333|x]]', 300, 400)[0].endSec).toBeNull();
  expect(parseSlideTokens('[[SLIDE:333|330|x]]', 300, 400)[0].endSec).toBeNull();
});
it('end beyond the window is clamped to windowEnd', () => {
  expect(parseSlideTokens('[[SLIDE:333|999|x]]', 300, 400)[0].endSec).toBe(400);
});
it('caption with a pipe still sanitizes (end absent)', () => {
  expect(parseSlideTokens('[[SLIDE:312|perceive | plan]]', 300, 400)[0].caption).toBe('perceive plan');
});
it('numeric two-field caption is NOT eaten as an end (B-1)', () => {
  // no trailing '|' after 2024 → lookahead fails → 2024 is the caption, not an end
  expect(parseSlideTokens('[[SLIDE:333|2024]]', 300, 400))
    .toEqual([{ raw: '[[SLIDE:333|2024]]', sec: 333, endSec: null, caption: '2024' }]);
  expect(parseSlideTokens('[[SLIDE:333|42]]', 300, 400)[0].caption).toBe('42');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest slide-tokens`
Expected: FAIL — `endSec` undefined / shape mismatch.

- [ ] **Step 3: Edit `slide-tokens.ts`** — grammar, interface, parse loop:

```ts
// SlideToken: add endSec
export interface SlideToken { raw: string; sec: number; endSec: number | null; caption: string; }

// Grammar: <time>(|<end-time>)?(|caption)?  — the end-time group has a (?=\|) lookahead so it
// ONLY matches when a caption field follows it (three-field form). This prevents a numeric two-field
// caption like [[SLIDE:333|2024]] from being mis-grabbed as an end (B-1): with no trailing '|', the
// lookahead fails and '2024' falls through to the caption group. Two-field start|X is always start+caption.
const TOKEN_RE =
  /\[\[SLIDE:(\d{1,2}:\d{1,2}(?::\d{1,2})?|\d+)(?:\|(\d{1,2}:\d{1,2}(?::\d{1,2})?|\d+)(?=\|))?(?:\|([^\]]*))?\]\]/g;

export function parseSlideTokens(markdown: string, windowStart: number, windowEnd: number): SlideToken[] {
  const results: SlideToken[] = [];
  const seenSecs = new Set<number>();
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(markdown)) !== null) {
    if (results.length >= 3) break;
    const raw = match[0];
    const sec = clockToSeconds(match[1]);
    if (!Number.isFinite(sec) || sec < 0) continue;
    if (sec < windowStart || sec > windowEnd) continue;
    if (seenSecs.has(sec)) continue;

    let endSec: number | null = null;
    if (match[2] != null) {
      const e = clockToSeconds(match[2]);
      if (Number.isFinite(e) && e > sec) endSec = Math.min(e, windowEnd);
    }
    const caption = sanitizeCaption(match[3] ?? '');
    seenSecs.add(sec);
    results.push({ raw, sec, endSec, caption });
  }
  return results;
}
```

(Rename the parameter names `startSec`/`endSec` → `windowStart`/`windowEnd` to avoid shadowing the token's `endSec`; update the doc comment's rule list to mention the optional end + clamp.)

- [ ] **Step 4: Run tests** — `npx jest slide-tokens` → PASS (new + existing).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit   # slides.ts still compiles: it reads token.sec (unchanged); token.endSec is new/unused until Task 3
git add lib/dig/slide-tokens.ts tests/lib/dig/slide-tokens.test.ts
git commit -m "feat(dig): parse slide start|end into SlideToken.endSec (tolerant)"
```

---

### Task 3: Capture — bounded one-call download + most-built frame; delete dead helpers

**Files:**
- Modify: `lib/dig/slides.ts`
- Test: `tests/lib/dig/slides.test.ts`, `tests/lib/dig/slides-helpers.test.ts`

**Interfaces:**
- Consumes: `SlideToken.endSec` (Task 2); existing `pickLargestFile`, `numEnv`, `assertVideoId`, `parseSlideTokens`, `resolveAssetPath`, `stripUnresolvedSlideTokens`, `execFileAsync`.
- New constants: `MAX_CAPTURE_SEC = numEnv('DIG_MAX_CAPTURE_SEC', 10)`, `DEFAULT_FWD = numEnv('DIG_DEFAULT_FWD', 6)`. Keep `SAMPLE_FPS`.
- Deletes: `captureBestFrame`, `singleFrameCapture`, `parseFirstSceneChange`, `runCapture`, `SCENE_THRESHOLD`, `MAX_WINDOW_SEC`.
- Produces: `captureSlideFrame({ youtubeUrl, startSec, endSec, outPath })` — one bounded download + `pickLargestFile`. **SECURITY: trusts `outPath`; caller containment-checks first.**

**Behavior table (test contract):**

| # | Scenario | Trigger | Expected |
|---|---|---|---|
| 1 | endSec present | `end > start` | window `[start, min(end, start+MAX_CAPTURE_SEC)]`; one yt-dlp call; largest frame written |
| 2 | endSec null | parser gave no end | window `[start, start+DEFAULT_FWD]`; one yt-dlp call |
| 3 | long slide | `end - start > MAX_CAPTURE_SEC` | window capped at `start+MAX_CAPTURE_SEC` |
| 4 | yt-dlp fails | ENOENT / non-zero | token stripped (`[dig-slide-miss]`), other tokens kept |
| 5 | no frames | ffmpeg writes nothing | token dropped |
| 6 | security | any token | server-built URL; argv arrays only; containment before write |

- [ ] **Step 1: Write failing tests** (adapt the existing mock harness; `getOpts()` = `{videoId:'abc12345678', startSec:300, endSec:400, assetsRoot:tmpAssetsRoot, sectionId:300}`)

```ts
const ytArgs = () => (mockExecFile.mock.calls.find((c: unknown[]) => c[0] === 'yt-dlp')![1] as string[]);

test('endSec present → window [start, min(end, start+MAX_CAPTURE_SEC)], one call, largest written', async () => {
  mockFfmpegPipeline('', [10, 500, 50]);                       // fps writes 3 frames; 500 is largest
  const out = await resolveSlideTokens('see [[SLIDE:333|341|S]]', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(out).toContain('![S](assets/abc12345678/300-333.jpg)');
  expect(mockExecFile.mock.calls.filter((c: unknown[]) => c[0] === 'yt-dlp').length).toBe(1);
  expect(ytArgs().join(' ')).toContain('*333-341');           // min(341, 333+10)=341 — distinct from the other paths
  expect(fs.statSync(path.join(tmpAssetsRoot, 'abc12345678', '300-333.jpg')).size).toBe(500);
});
test('endSec null → window [start, start+DEFAULT_FWD]', async () => {
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('see [[SLIDE:333|S]]', { ...getOpts(), startSec: 300, endSec: 400 }); // no end → null
  expect(ytArgs().join(' ')).toContain('*333-337');           // 333 + DEFAULT_FWD(4) — distinct path (H-1)
});
test('long slide → window capped at start+MAX_CAPTURE_SEC', async () => {
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('see [[SLIDE:333|399|S]]', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(ytArgs().join(' ')).toContain('*333-343');           // 333 + MAX_CAPTURE(10) — distinct
});
test('B-2: one yt-dlp call PER token (download count = token count, locked cost)', async () => {
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('a [[SLIDE:310|315|A]] b [[SLIDE:333|341|B]] c [[SLIDE:360|365|C]] d',
    { ...getOpts(), startSec: 300, endSec: 400 });
  expect(mockExecFile.mock.calls.filter((c: unknown[]) => c[0] === 'yt-dlp').length).toBe(3);
});
test('yt-dlp fails → token stripped, others kept', async () => {
  mockExecFile.mockImplementation((cmd: string, _a: string[], cb: (e: Error|null, so?: string, se?: string) => void) =>
    cmd === 'yt-dlp' ? cb(new Error('HTTP 403')) : cb(null, '', ''));
  const out = await resolveSlideTokens('a [[SLIDE:333|339|S]] b', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(out).not.toContain('[[SLIDE:'); expect(out).not.toContain('![');
});
test('security: server-built URL + argv arrays only', async () => {
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('see [[SLIDE:333|339|S]]', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(ytArgs()).toContain('https://www.youtube.com/watch?v=abc12345678');
  mockExecFile.mock.calls.forEach((c: unknown[]) => expect(Array.isArray(c[1])).toBe(true));
});
```

> The shared `mockFfmpegPipeline(sceneStderr, frameSizes)` already writes `frameSizes.length` frames (via `Buffer.alloc`) for the `fps=` pass. With the cut detector gone, the scene-pass branch is simply never invoked — pass `''` for the unused stderr arg.

- [ ] **Step 2: Run tests to verify they fail** — `npx jest slides.test` → FAIL (`*333-339` window absent; old code downloads `*300-400`).

- [ ] **Step 3: Implement.** Add constants; add `captureSlideFrame`; rewrite the `resolveSlideTokens` loop; delete dead helpers.

```ts
// constants near the existing ones (delete SCENE_THRESHOLD, MAX_WINDOW_SEC)
const SAMPLE_FPS = numEnv('DIG_SAMPLE_FPS', 2);
const MAX_CAPTURE_SEC = numEnv('DIG_MAX_CAPTURE_SEC', 10);
const DEFAULT_FWD = numEnv('DIG_DEFAULT_FWD', 4);   // M-3: shorter blind window when Gemini omits end

/** Download exactly the slide's lifespan and write the most-built frame.
 *  Window = [startSec, min(endSec, startSec+MAX_CAPTURE_SEC)] when endSec is usable,
 *  else [startSec, startSec+DEFAULT_FWD]. SECURITY: trusts outPath — caller checks containment. */
async function captureSlideFrame(opts: {
  youtubeUrl: string; startSec: number; endSec: number | null; outPath: string;
}): Promise<void> {
  const { youtubeUrl, startSec, endSec, outPath } = opts;
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const rawEnd = endSec != null && endSec > startSec
    ? Math.min(endSec, startSec + MAX_CAPTURE_SEC)
    : startSec + DEFAULT_FWD;
  const winEnd = Math.max(rawEnd, startSec + 1);  // M-1: guard a degenerate window (e.g. DIG_DEFAULT_FWD="" → 0)

  const clip = path.join(cacheDir, `clip-${crypto.randomUUID()}.mp4`);
  const framesDir = fs.mkdtempSync(path.join(cacheDir, 'frames-'));
  try {
    await execFileAsync('yt-dlp', [
      '--download-sections', `*${startSec}-${winEnd}`,
      '-f', 'bv[height<=720]', '-o', clip, youtubeUrl,
    ]);
    await execFileAsync('ffmpeg', [
      '-y', '-i', clip, '-vf', `fps=${SAMPLE_FPS}`, '-q:v', '2',
      path.join(framesDir, 'f_%03d.jpg'),
    ]);
    const best = pickLargestFile(framesDir);
    if (!best) throw new Error('no frames sampled');
    fs.copyFileSync(best, outPath);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
    try { fs.unlinkSync(clip); } catch { /* ignore */ }
  }
}
```

`resolveSlideTokens` — keep `assertVideoId`, the empty-token short-circuit, and the server-built `youtubeUrl`; remove the module-level single-section download + outer clip `try/finally`; loop per token:

```ts
let result = markdown;
for (const token of tokens) {
  const assetPath = resolveAssetPath(assetsRoot, videoId, sectionId, token.sec);
  const resolvedRoot = path.resolve(assetsRoot);
  if (!assetPath.startsWith(resolvedRoot + path.sep)) {            // containment BEFORE any write
    console.warn('[dig-slide-miss] asset path escaped assetsRoot — skipping token:', token.raw);
    result = result.replace(token.raw, '');
    continue;
  }
  fs.mkdirSync(path.resolve(assetsRoot, videoId), { recursive: true });
  try {
    await captureSlideFrame({ youtubeUrl, startSec: token.sec, endSec: token.endSec, outPath: assetPath });
    const imgRef = `![${token.caption}](assets/${videoId}/${sectionId}-${token.sec}.jpg)`;
    const escapedRaw = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escapedRaw, 'g'), () => imgRef);
  } catch (err: unknown) {
    console.warn('[dig-slide-miss] capture failed for token', token.raw, ':', (err as Error).message);
    const escapedRaw2 = token.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escapedRaw2, 'g'), () => '');
  }
}
return stripUnresolvedSlideTokens(result);
```

Delete `captureBestFrame`, `singleFrameCapture`, `parseFirstSceneChange`, `runCapture`, and the `SCENE_THRESHOLD`/`MAX_WINDOW_SEC` consts. **Keep** `pickLargestFile`, `numEnv`, `SAMPLE_FPS`, `resolveAssetPath`, `stripUnresolvedSlideTokens`.

**Rewrite the module header (H-2)** — `lib/dig/slides.ts:1-13` currently describes "downloading a section clip" and scene detection. Replace it to describe the new model: per-token bounded download `[start, min(end, start+MAX_CAPTURE_SEC)]` from the Gemini-supplied window, most-built frame via `pickLargestFile`, each token owning its temp clip (deleted in `finally`). Keep the security-invariant list verbatim. Also confirm `ResolveSlideTokensOpts.startSec`/`endSec` are documented as the *section* window (distinct from `SlideToken.endSec`, the per-slide end).

- [ ] **Step 4: Remove obsolete tests + the dead import (H-3).** In `tests/lib/dig/slides-helpers.test.ts`: delete the `parseFirstSceneChange` `describe` block **and remove `parseFirstSceneChange` from the import on line 4** (`import { numEnv, pickLargestFile } from '@/lib/dig/slides';`) — leaving it there fails `tsc` once the function is deleted. **Keep** `pickLargestFile` and `numEnv` blocks (both functions are retained). In `slides.test.ts`, delete legacy cases that assert the removed internals (`-ss <relStart>`, `--download-sections *300-400`, `-frames:v 1` single-frame, the `-y` single-frame test, scene-bounds-window, `captureBestFrame: …`).

- [ ] **Step 5: Verify no dangling refs**

Run: `grep -rn "captureBestFrame\|singleFrameCapture\|parseFirstSceneChange\|runCapture\|SCENE_THRESHOLD\|MAX_WINDOW_SEC" lib/ tests/`
Expected: no matches.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean; all suites green.

- [ ] **Step 7: Commit**

```bash
git add lib/dig/slides.ts tests/lib/dig/slides.test.ts tests/lib/dig/slides-helpers.test.ts
git commit -m "feat(dig): bounded one-call capture from Gemini window; drop cut-detector helpers"
```

---

## Self-Review

**1. Spec coverage:** §3.1 prompt → Task 1; §3.2 parser/`endSec` → Task 2; §3.3 bounded capture + `pickLargestFile` → Task 3; §4 deletions → Task 3; §5 degradation (null end / yt-dlp fail / no frames) → Task 3 scenarios 2,4,5; §6 testing → all; §7 3-token cap OUT (unchanged); §8 version → Task 1; §9 constants → Tasks 1,3.

**2. Placeholder scan:** none — every code step shows complete code.

**3. Type consistency:** `SlideToken{raw,sec,endSec,caption}`, `parseSlideTokens(md,windowStart,windowEnd)`, `captureSlideFrame({youtubeUrl,startSec,endSec,outPath})` — consistent across Tasks 2,3. Each task commits green (Task 2 keeps `sec`, only adds `endSec`; Task 3 changes behavior and deletes its own obsolete tests in the same commit).

---

## Post-Plan Gate (dev-process.md)

- [ ] Adversarial review of THIS rev-3 plan (Codex `--fresh`; Claude fallback if Codex at limit) → `docs/reviews/plan-dig-window-capping-codex.md` (or `-review.md`)
- [ ] Address Blocking/High inline; present Medium for decision
- [ ] Explicit human approval before dispatching any implementation subagent
