# Dig Window-Capping + Anchor-Aware Frame Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dig pipeline's single full-section slide-clip download with a per-token extend-on-demand capped download plus anchor-aware, cut-bounded, settle-based frame selection.

**Architecture:** Pure decision logic (cut parsing + frame selection) lives in a new `lib/dig/frame-select.ts`, unit-tested against synthetic sequences. The I/O orchestrator in `lib/dig/slides.ts` downloads a small base window per token and extends forward one segment at a time only while the chosen frame is still improving and no slide cut has been crossed. `DIG_GENERATOR_VERSION` 5 → 6 so existing dug sections re-render on demand.

**Tech Stack:** TypeScript, Node `node:child_process` (`execFile`), `yt-dlp`, `ffmpeg`, Jest + ts-jest (SWC, no typecheck — `tsc --noEmit` is the real type gate).

**Spec:** `docs/superpowers/specs/2026-06-27-dig-window-capping-design.md`

## Global Constraints

- **Security invariants (unchanged, verbatim from current `slides.ts`):** `assertVideoId(videoId)` called before any exec; `youtubeUrl` always server-built from the validated id; `execFile` (argv array) only — never `exec`/shell strings; asset paths containment-checked against `assetsRoot` before write; temp clips always deleted in `finally`.
- **No real network in unit/component tests** — mock `node:child_process` at the module boundary (existing `tests/lib/dig/slides.test.ts` pattern).
- **Type gate:** `npx tsc --noEmit` must be clean before every commit (Jest uses SWC and does NOT typecheck).
- **Env-override pattern:** all tunable constants read via the existing `numEnv(name, def)` helper, names prefixed `DIG_`.
- **Test gate per task:** targeted `npx jest <file>` green → full `npm test` green → commit.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `lib/dig/frame-select.ts` | Pure: parse scene-change offsets; choose best frame (anchor/cut-bound/plateau) | **Create** |
| `tests/lib/dig/frame-select.test.ts` | Unit tests for the pure logic (synthetic sequences) | **Create** |
| `lib/dig/slides.ts` | I/O orchestrator: per-token extend-on-demand download + selection; constants/env | **Modify** |
| `tests/lib/dig/slides.test.ts` | Orchestrator call-pattern + degradation tests (mocked exec) | **Modify** |
| `tests/lib/dig/slides-helpers.test.ts` | Remove tests for deleted helpers; keep `numEnv` tests | **Modify** |
| `lib/dig/generate.ts` | Bump `DIG_GENERATOR_VERSION` 5 → 6 | **Modify** |
| `docs/reviews/dig-window-capping-calibration.md` | Empirical scene-threshold calibration record | **Create** |

**Shared types (defined in Task 1/2, used by Task 4):**

```ts
// lib/dig/frame-select.ts
export interface SampledFrame { offset: number; size: number; } // offset = seconds relative to token.sec
export interface FrameChoice { bestIndex: number; bestOffset: number; atTrailingEdge: boolean; }
export function parseSceneChanges(ffmpegStderr: string, baseOffset: number): number[];
export function chooseFrame(
  frames: SampledFrame[],
  sceneChanges: number[],
  cfg?: { anchorOffset?: number; flatEps?: number; plateauFrac?: number },
): FrameChoice;
```

---

### Task 1: `parseSceneChanges` — collect all scene-change offsets

**Files:**
- Create: `lib/dig/frame-select.ts`
- Test: `tests/lib/dig/frame-select.test.ts`

**Interfaces:**
- Produces: `parseSceneChanges(ffmpegStderr: string, baseOffset: number): number[]` — every `pts_time` in the `showinfo` stderr, each converted to an offset by adding `baseOffset` (the clip-start-relative-to-`sec` value, e.g. `-3`). Ascending, finite, deduplicated.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/dig/frame-select.test.ts
import { parseSceneChanges } from '@/lib/dig/frame-select';

describe('parseSceneChanges', () => {
  it('returns every pts_time shifted by baseOffset, ascending', () => {
    const stderr =
      '[Parsed_showinfo_1 @ 0x1] n:0 pts_time:2.0 ...\n' +
      '[Parsed_showinfo_1 @ 0x1] n:1 pts_time:5.5 ...\n';
    // clip started 3s before sec → baseOffset = -3
    expect(parseSceneChanges(stderr, -3)).toEqual([-1, 2.5]);
  });
  it('returns [] when no scene changes are present', () => {
    expect(parseSceneChanges('no scene info', -3)).toEqual([]);
  });
  it('dedupes and sorts', () => {
    const stderr = 'pts_time:4.0 x\npts_time:1.0 y\npts_time:4.0 z\n';
    expect(parseSceneChanges(stderr, 0)).toEqual([1, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest frame-select`
Expected: FAIL — `parseSceneChanges` not exported / module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/dig/frame-select.ts
export interface SampledFrame { offset: number; size: number; }
export interface FrameChoice { bestIndex: number; bestOffset: number; atTrailingEdge: boolean; }

/** Every `pts_time` from ffmpeg `showinfo` stderr, shifted by `baseOffset`
 *  (clip-start position relative to the token's `sec`). Ascending, deduped, finite. */
export function parseSceneChanges(ffmpegStderr: string, baseOffset: number): number[] {
  const out = new Set<number>();
  const re = /pts_time:([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ffmpegStderr)) !== null) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) out.add(t + baseOffset);
  }
  return [...out].sort((a, b) => a - b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest frame-select`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/frame-select.ts tests/lib/dig/frame-select.test.ts
git commit -m "feat(dig): parseSceneChanges — all scene-change offsets (pure)"
```

---

### Task 2: `chooseFrame` — anchor/cut-bound/plateau selection

**Files:**
- Modify: `lib/dig/frame-select.ts`
- Test: `tests/lib/dig/frame-select.test.ts`

**Interfaces:**
- Consumes: `SampledFrame { offset, size }`, scene-change offsets from Task 1.
- Produces: `chooseFrame(frames, sceneChanges, cfg?) → FrameChoice { bestIndex, bestOffset, atTrailingEdge }`.
  - `anchorOffset` default `0` (the frame nearest `sec`).
  - Boundary = first scene change strictly `> anchorOffset`; candidates are frames with `anchorOffset <= offset < boundary`.
  - If `(maxSize − minSize) / maxSize < flatEps` (default `0.10`) → **stable**, pick the candidate nearest `anchorOffset`.
  - Else → **build**, pick the first candidate with `size >= maxSize * plateauFrac` (default `0.97`).
  - `atTrailingEdge` = no boundary found (`Infinity`) AND the chosen frame is the last candidate (size still rising at the span's end → caller should extend).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/dig/frame-select.test.ts  (append)
import { chooseFrame, type SampledFrame } from '@/lib/dig/frame-select';

const F = (offset: number, size: number): SampledFrame => ({ offset, size });

describe('chooseFrame', () => {
  it('A. stable slide: ~flat sizes → picks the anchor (offset 0), not trailing edge', () => {
    const frames = [F(-3, 100), F(-2, 101), F(-1, 100), F(0, 102), F(1, 101), F(2, 100)];
    const c = chooseFrame(frames, []); // no cuts
    expect(c.bestOffset).toBe(0);
    expect(c.atTrailingEdge).toBe(false);
  });

  it('B. fast-cut: cut at +3 bounds the window → anchor chosen, never the later bigger slide', () => {
    // big slide AFTER the cut would win on size, but it is past the boundary
    const frames = [F(0, 100), F(1, 101), F(2, 100), F(3, 500), F(4, 520)];
    const c = chooseFrame(frames, [3]); // hard cut at +3
    expect(c.bestOffset).toBe(0);
    expect(c.atTrailingEdge).toBe(false);
  });

  it('C. build: sizes climb to a plateau → picks first plateau frame', () => {
    const frames = [F(0, 100), F(2, 140), F(4, 180), F(6, 198), F(8, 200), F(10, 200)];
    const c = chooseFrame(frames, []); // no cut; plateauFrac 0.97 → 200*0.97=194 → offset 6
    expect(c.bestOffset).toBe(6);
    expect(c.atTrailingEdge).toBe(false); // plateau reached before the last frame
  });

  it('C-edge: still climbing at the last frame → atTrailingEdge true (extend)', () => {
    const frames = [F(0, 100), F(2, 140), F(4, 180), F(6, 230)];
    const c = chooseFrame(frames, []); // monotonic up, best == last, no cut
    expect(c.bestOffset).toBe(6);
    expect(c.atTrailingEdge).toBe(true);
  });

  it('ignores scene changes at or before the anchor', () => {
    const frames = [F(0, 100), F(2, 140), F(4, 200)];
    const c = chooseFrame(frames, [-1, 0]); // both <= anchor → no boundary
    expect(c.bestOffset).toBe(4);
    expect(c.atTrailingEdge).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest frame-select`
Expected: FAIL — `chooseFrame` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/dig/frame-select.ts  (append)
export function chooseFrame(
  frames: SampledFrame[],
  sceneChanges: number[],
  cfg: { anchorOffset?: number; flatEps?: number; plateauFrac?: number } = {},
): FrameChoice {
  if (frames.length === 0) throw new Error('chooseFrame: no frames');
  const anchorOffset = cfg.anchorOffset ?? 0;
  const flatEps = cfg.flatEps ?? 0.1;
  const plateauFrac = cfg.plateauFrac ?? 0.97;

  // Boundary = first hard cut strictly after the anchor; slide ends there.
  const cut = sceneChanges.find((c) => c > anchorOffset);
  const bound = cut ?? Infinity;

  // Candidates: the anchor frame and everything up to (not including) the cut.
  const cand = frames.filter((f) => f.offset >= anchorOffset && f.offset < bound);
  const pool = cand.length > 0 ? cand : frames;

  const sizes = pool.map((f) => f.size);
  const maxSize = Math.max(...sizes);
  const minSize = Math.min(...sizes);

  // Anchor = candidate whose offset is closest to anchorOffset.
  const anchorFrame = pool.reduce((a, b) =>
    Math.abs(b.offset - anchorOffset) < Math.abs(a.offset - anchorOffset) ? b : a,
  );

  let best: SampledFrame;
  if (maxSize <= 0 || (maxSize - minSize) / maxSize < flatEps) {
    best = anchorFrame; // stable slide → use the anchor (sec)
  } else {
    best = pool.find((f) => f.size >= maxSize * plateauFrac) ?? anchorFrame; // build → first plateau
  }

  const lastCand = pool[pool.length - 1];
  const atTrailingEdge = bound === Infinity && best.offset === lastCand.offset;

  return { bestIndex: frames.indexOf(best), bestOffset: best.offset, atTrailingEdge };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest frame-select`
Expected: PASS (all `chooseFrame` + `parseSceneChanges` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/frame-select.ts tests/lib/dig/frame-select.test.ts
git commit -m "feat(dig): chooseFrame — anchor/cut-bound/plateau frame selection (pure)"
```

---

### Task 3: Calibrate `DIG_SCENE_THRESHOLD` (empirical)

**Files:**
- Create: `docs/reviews/dig-window-capping-calibration.md`
- Modify: `lib/dig/slides.ts` (set the calibrated default in Task 5; this task only DETERMINES it)

**Why no unit test:** the threshold lives in the ffmpeg `gt(scene,T)` pass over real video, which cannot run offline. The *logic* that consumes scene offsets is already unit-tested in Task 2. This task picks the constant empirically and records the evidence.

- [ ] **Step 1: Pick 6 representative tokens spanning regimes** (from the spike set): stable `Lm8BLHkxiAo 344`, `yjim3_bAkqA 537`; fast-cut `P_E29-87THI 333`, `P_E29-87THI 444`; build `P_E29-87THI 113`, `yjim3_bAkqA 526`.

- [ ] **Step 2: For each, run scene detection at thresholds {0.15, 0.20, 0.25, 0.30, 0.40}** over `[sec−3, sec+18]` and record the detected cut offsets:

```bash
yt-dlp -q --download-sections "*$((sec-3))-$((sec+18))" -f 'bv[height<=720]' -o /tmp/cal.mp4 "https://www.youtube.com/watch?v=$VID"
for T in 0.15 0.20 0.25 0.30 0.40; do
  echo "T=$T"; ffmpeg -hide_banner -loglevel info -i /tmp/cal.mp4 \
    -vf "select='gt(scene,$T)',showinfo" -f null - 2>&1 | grep -oE 'pts_time:[0-9.]+'
done
```

- [ ] **Step 3: Choose the threshold** that best matches visually-labeled boundaries: fires on the fast-cut decks (`333`, `444`) and does NOT fire mid-build on `113` (build increments must read as same-slide). Record per-token results, the chosen value, and rationale in `docs/reviews/dig-window-capping-calibration.md`.

- [ ] **Step 4: Commit the calibration record** (the constant itself is set in Task 5):

```bash
git add docs/reviews/dig-window-capping-calibration.md
git commit -m "docs(dig): scene-threshold calibration record for window-capping"
```

---

### Task 4: Orchestrator — per-token extend-on-demand download + selection

**Files:**
- Modify: `lib/dig/slides.ts` (replace `captureBestFrame` usage and the single-section download in `resolveSlideTokens`; add `captureSlideFrame` + segment helpers)
- Test: `tests/lib/dig/slides.test.ts`

**Interfaces:**
- Consumes: `chooseFrame`, `parseSceneChanges` (Tasks 1–2); existing `assertVideoId`, `parseSlideTokens`, `resolveAssetPath`, `stripUnresolvedSlideTokens`.
- New constants (via `numEnv`, set in `slides.ts`): `BACK_PAD=3`, `BASE_FWD=6`, `SEG=6`, `MAX_FWD=30` (`SCENE_THRESHOLD` default = Task 3's value, `SAMPLE_FPS=2` retained).
- Produces: internal `captureSlideFrame(opts: { videoId, youtubeUrl, sec, endSec, outPath }): Promise<void>` — downloads/extends, writes the chosen frame to `outPath`, throws if no frame could be produced; deletes its own temp clips. The per-token download moves INSIDE this function (one clip per token, not one per section).

**Behavior table (contract for tests):**

| # | Scenario | Trigger | Expected |
|---|---|---|---|
| 1 | Stable slide | base window, flat sizes, no cut | 1 `yt-dlp` call; anchor frame written |
| 2 | Fast-cut | base window, cut within it | 1 `yt-dlp` call; never extends; anchor written |
| 3 | Build settling within base | best interior + plateau | 1 `yt-dlp` call; plateau frame written |
| 4 | Build still climbing | best at trailing edge, no cut | extends: 2–3 `yt-dlp` calls until plateau or `MAX_FWD` |
| 5 | Safety cap | keeps climbing past `sec+MAX_FWD` | stops at cap; best-so-far written |
| 6 | Base download fails | `yt-dlp` non-zero/ENOENT on first segment | token dropped (`[dig-slide-miss]`), others unaffected |
| 7 | Extension download fails | base ok, later segment fails | best-so-far written (NOT dropped) |
| 8 | Token at `endSec` | `endSec − sec < base` | window clamped to `endSec`; single frame still written |

- [ ] **Step 1: Write failing tests** (extend the existing mock harness; reuse `mockFfmpegPipeline` style but assert per-token `yt-dlp` call counts and extension behavior)

```ts
// tests/lib/dig/slides.test.ts  (append a describe block)
// The shared mock already routes yt-dlp / scene / fps / frames:v. Add helpers to
// count yt-dlp invocations and to make the fps pass emit controlled frame sizes
// per segment so chooseFrame's atTrailingEdge can be driven deterministically.

test('orchestrator: stable slide → one yt-dlp call, anchor frame written', async () => {
  // scene 'none', flat frame sizes → no extend
  mockFfmpegPipeline('', [100, 100, 100]); // sceneStderr empty, equal sizes
  const out = await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(out).toContain('![S](assets/abc12345678/300-300.jpg)');
  const ytCalls = mockExecFile.mock.calls.filter((c: unknown[]) => c[0] === 'yt-dlp');
  expect(ytCalls.length).toBe(1);
});

test('orchestrator: build still climbing → extends (≥2 yt-dlp calls), stops on plateau', async () => {
  // First segment frames strictly increasing & best == last (trailing edge),
  // second segment plateaus. Mock returns rising sizes on call 1, flat-high on call 2.
  mockRisingThenPlateau();
  await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  const ytCalls = mockExecFile.mock.calls.filter((c: unknown[]) => c[0] === 'yt-dlp');
  expect(ytCalls.length).toBeGreaterThanOrEqual(2);
});

test('orchestrator: extension download fails → best-so-far written, token NOT dropped', async () => {
  mockBaseOkThenDownloadFail(); // base ok + trailing edge; 2nd yt-dlp throws
  const out = await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(out).toContain('![S](assets/abc12345678/300-300.jpg)'); // still resolved
});

test('orchestrator: base download fails → token stripped, others kept', async () => {
  mockExecFile.mockImplementation((cmd: string, _a: string[], cb: (e: Error | null, so?: string, se?: string) => void) =>
    cmd === 'yt-dlp' ? cb(new Error('HTTP 403')) : cb(null, '', ''));
  const out = await resolveSlideTokens('a [[SLIDE:300|S]] b', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).not.toContain('![');
});
```

> Implementer note: add the small mock factories (`mockRisingThenPlateau`, `mockBaseOkThenDownloadFail`) next to the existing `mockFfmpegPipeline`, driving the `fps=` pass to write frame files whose byte sizes encode the desired size profile per `yt-dlp` segment (track an invocation counter in closure).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest slides.test -t orchestrator`
Expected: FAIL — `captureSlideFrame` not implemented / extend behavior absent.

- [ ] **Step 3: Implement `captureSlideFrame` + wire into `resolveSlideTokens`**

Add constants near the existing ones:

```ts
const BACK_PAD = numEnv('DIG_BACK_PAD', 3);
const BASE_FWD = numEnv('DIG_BASE_FWD', 6);
const SEG = numEnv('DIG_SEG', 6);
const MAX_FWD = numEnv('DIG_MAX_FWD', 30);
// SCENE_THRESHOLD default = value chosen in Task 3 (e.g. 0.25); SAMPLE_FPS retained.
```

New capture function (replaces `captureBestFrame`):

```ts
import { chooseFrame, parseSceneChanges, type SampledFrame } from '@/lib/dig/frame-select';

/** Download a small window around `sec` and extend forward only while the chosen
 *  frame is still improving and no slide cut has been crossed; write the chosen
 *  frame to `outPath`. Throws if no frame could be produced. */
async function captureSlideFrame(opts: {
  videoId: string; youtubeUrl: string; sec: number; endSec: number; outPath: string;
}): Promise<void> {
  const { youtubeUrl, sec, endSec, outPath } = opts;
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const winStart = Math.max(0, sec - BACK_PAD);
  const cap = Math.min(endSec, sec + MAX_FWD);
  let winEnd = Math.min(cap, sec + BASE_FWD);

  const frames: Array<SampledFrame & { path: string }> = [];
  const sceneChanges: number[] = [];
  const tmpClips: string[] = [];
  let downloadedTo = winStart;
  let baseDone = false;

  try {
    while (true) {
      const clip = path.join(cacheDir, `clip-${crypto.randomUUID()}.mp4`);
      tmpClips.push(clip);
      try {
        await execFileAsync('yt-dlp', [
          '--download-sections', `*${downloadedTo}-${winEnd}`,
          '-f', 'bv[height<=720]', '-o', clip, youtubeUrl,
        ]);
      } catch (err) {
        if (!baseDone) throw err;       // base failed → caller drops the token
        break;                          // extension failed → use best-so-far
      }
      baseDone = true;

      // Sample this segment at SAMPLE_FPS; frame k → offset (relative to sec).
      const segDir = fs.mkdtempSync(path.join(cacheDir, 'frames-'));
      try {
        await execFileAsync('ffmpeg', [
          '-y', '-i', clip, '-vf', `fps=${SAMPLE_FPS}`, '-q:v', '2',
          path.join(segDir, 'f_%03d.jpg'),
        ]);
        const segBase = downloadedTo - sec; // offset of this segment's first frame
        const names = fs.readdirSync(segDir).filter((n) => n.endsWith('.jpg')).sort();
        names.forEach((n, i) => {
          const p = path.join(segDir, n);
          // mkdtemp dir is deleted at function end via tmpDirs; move frame out first.
          const kept = path.join(cacheDir, `frame-${crypto.randomUUID()}.jpg`);
          fs.renameSync(p, kept);
          frames.push({ offset: segBase + i / SAMPLE_FPS, size: fs.statSync(kept).size, path: kept });
        });

        const { stderr } = await runCapture('ffmpeg', [
          '-i', clip, '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-',
        ]);
        for (const o of parseSceneChanges(stderr, segBase)) sceneChanges.push(o);
      } finally {
        fs.rmSync(segDir, { recursive: true, force: true });
      }

      if (frames.length === 0) throw new Error('no frames sampled');
      const choice = chooseFrame(frames, sceneChanges);
      // Stop unless the slide is still climbing at the trailing edge AND room remains.
      if (!choice.atTrailingEdge || winEnd >= cap) {
        fs.copyFileSync(frames[choice.bestIndex].path, outPath);
        return;
      }
      downloadedTo = winEnd;
      winEnd = Math.min(cap, winEnd + SEG);
    }

    // Loop broke on extension failure → write best-so-far.
    if (frames.length === 0) throw new Error('no frames sampled');
    const choice = chooseFrame(frames, sceneChanges);
    fs.copyFileSync(frames[choice.bestIndex].path, outPath);
  } finally {
    for (const c of tmpClips) { try { fs.unlinkSync(c); } catch { /* ignore */ } }
    for (const f of frames) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
  }
}
```

Rewrite the body of `resolveSlideTokens` to drop the single-section download and call `captureSlideFrame` per token (keep the validation, containment guard, token rewrite, and final strip exactly as-is):

```ts
// inside resolveSlideTokens, REPLACE the try/catch that downloaded one clip +
// the per-token captureBestFrame call with:
let result = markdown;
for (const token of tokens) {
  const assetPath = resolveAssetPath(assetsRoot, videoId, sectionId, token.sec);
  const resolvedRoot = path.resolve(assetsRoot);
  if (!assetPath.startsWith(resolvedRoot + path.sep)) {
    console.warn('[dig-slide-miss] asset path escaped assetsRoot — skipping token:', token.raw);
    result = result.replace(token.raw, '');
    continue;
  }
  fs.mkdirSync(path.resolve(assetsRoot, videoId), { recursive: true });
  try {
    await captureSlideFrame({ videoId, youtubeUrl, sec: token.sec, endSec, outPath: assetPath });
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

(The outer `youtubeUrl` build and `assertVideoId`/`parseSlideTokens`/empty-token short-circuit stay. The old function-level `tmpClip` + outer `try/finally` that deleted one clip are removed — each `captureSlideFrame` now owns its clips.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest slides.test -t orchestrator`
Expected: PASS (scenarios 1–8 covered by the added tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/dig/slides.ts tests/lib/dig/slides.test.ts
git commit -m "feat(dig): per-token extend-on-demand capped download + anchor-aware selection"
```

---

### Task 5: Remove dead helpers, bump version, finalize constants

**Files:**
- Modify: `lib/dig/slides.ts` (delete `captureBestFrame`, `singleFrameCapture`, `parseFirstSceneChange`, `pickLargestFile`, `MAX_WINDOW_SEC`; set calibrated `SCENE_THRESHOLD` default)
- Modify: `tests/lib/dig/slides-helpers.test.ts` (remove `parseFirstSceneChange` + `pickLargestFile` tests; keep `numEnv` tests)
- Modify: `tests/lib/dig/slides.test.ts` (remove any captureBestFrame-specific assertions superseded by Task 4)
- Modify: `lib/dig/generate.ts` (`DIG_GENERATOR_VERSION` 5 → 6)

**Interfaces:**
- Removes: `captureBestFrame`, `singleFrameCapture`, `parseFirstSceneChange`, `pickLargestFile`, `MAX_WINDOW_SEC` (all now unused — `chooseFrame`/`parseSceneChanges` replace the last two; per-token download replaces the first two).

- [ ] **Step 1: Delete the dead functions/constants from `slides.ts`** (lines for `parseFirstSceneChange`, `singleFrameCapture`, `captureBestFrame`, `pickLargestFile`, and the `MAX_WINDOW_SEC` const). Set `SCENE_THRESHOLD` default to Task 3's calibrated value.

- [ ] **Step 2: Remove their tests** from `tests/lib/dig/slides-helpers.test.ts` (the `parseFirstSceneChange` and `pickLargestFile` describe blocks) and any superseded `captureBestFrame` cases in `slides.test.ts`. Keep the `numEnv` describe block.

- [ ] **Step 3: Bump the version**

```ts
// lib/dig/generate.ts
export const DIG_GENERATOR_VERSION = 6;
```

- [ ] **Step 4: Verify no dangling references**

Run: `grep -rn "captureBestFrame\|singleFrameCapture\|parseFirstSceneChange\|pickLargestFile\|MAX_WINDOW_SEC" lib/ tests/`
Expected: no matches.

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: `tsc` clean; all suites green.

- [ ] **Step 6: Commit**

```bash
git add lib/dig/slides.ts lib/dig/generate.ts tests/lib/dig/slides-helpers.test.ts tests/lib/dig/slides.test.ts
git commit -m "refactor(dig): drop fixed-window helpers; bump DIG_GENERATOR_VERSION 5→6"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §3.1 extend-on-demand download | Task 4 |
| §3.2 anchor/cut-bound/settle selection | Task 2 (logic), Task 4 (wiring) |
| §3.3 cut detector + recalibration | Task 1 (parse), Task 3 (threshold) |
| §3.4 settle/plateau | Task 2 (`flatEps`/`plateauFrac`) |
| §4 pure units vs I/O split | Tasks 1–2 (pure) vs Task 4 (I/O) |
| §5 error degradation (base vs extension fail) | Task 4 scenarios 6–7 |
| §6 testing (synthetic + call-pattern + regression) | Tasks 2, 4, 5 |
| §7 scope: 3-token cap OUT | not implemented (correct) |
| §8 migration: v5→6 | Task 5 |
| §9 constants/env | Task 4 (constants), Task 3 (threshold) |

**2. Placeholder scan:** Task 3 has no code-step placeholder (it is an explicitly empirical task with exact commands). The two mock factories in Task 4 are described with their behavior + an implementer note; they are test scaffolding parameterizing the existing `mockFfmpegPipeline` pattern, not logic placeholders.

**3. Type consistency:** `SampledFrame {offset,size}`, `FrameChoice {bestIndex,bestOffset,atTrailingEdge}`, `parseSceneChanges(stderr, baseOffset)`, `chooseFrame(frames, sceneChanges, cfg?)`, `captureSlideFrame({videoId,youtubeUrl,sec,endSec,outPath})` — names/signatures consistent across Tasks 1, 2, 4, 5.

---

## Post-Plan Gate (dev-process.md)

Before dispatching any implementation subagent:
- [ ] Adversarial review of THIS plan (Codex `--fresh`; fall back to Claude adversarial review if Codex unavailable) → save to `docs/reviews/plan-dig-window-capping-codex.md` (or `-review.md` for the Claude fallback)
- [ ] Address Blocking/High findings; present Medium for decision
- [ ] Explicit human approval to proceed
