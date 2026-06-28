# Dig Window-Capping + Anchor-Aware Frame Selection — Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dig pipeline's single full-section slide-clip download with a per-token extend-on-demand capped download plus anchor-aware, cut-bounded, settle-based frame selection.

**Architecture:** Pure decision logic (cut parsing + frame selection) lives in a new `lib/dig/frame-select.ts`, unit-tested against synthetic sequences. The I/O orchestrator in `lib/dig/slides.ts` downloads a small base window per token and extends forward one bounded segment at a time only while the slide is still building (size rising at the trailing edge) and no slide cut has been crossed. `DIG_GENERATOR_VERSION` 5 → 6 so existing dug sections re-render on demand.

**Tech Stack:** TypeScript, Node `node:child_process` (`execFile`), `yt-dlp`, `ffmpeg`, Jest + ts-jest (SWC, no typecheck — `tsc --noEmit` is the real type gate).

**Spec:** `docs/superpowers/specs/2026-06-27-dig-window-capping-design.md`
**Rev 2 incorporates:** adversarial review `docs/reviews/plan-dig-window-capping-review.md` (B6, H1, H3, H4, H5, H6, M1–M5, L1–L4).

## Global Constraints

- **Security invariants (unchanged, verbatim from current `slides.ts`):** `assertVideoId(videoId)` called before any exec; `youtubeUrl` always server-built from the validated id; `execFile` (argv array) only — never `exec`/shell strings; asset paths containment-checked against `assetsRoot` **before** any write to `outPath`; temp clips always deleted in `finally`.
- **No real network in unit/component tests** — mock `node:child_process` at the module boundary (existing `tests/lib/dig/slides.test.ts` pattern).
- **Type gate:** `npx tsc --noEmit` must be clean before every commit. (`noUncheckedIndexedAccess` is OFF in `tsconfig.json` — verified — so indexed access needs no extra guards, but the `frames.length === 0` throw stays.)
- **Env-override pattern:** all tunable constants read via the existing `numEnv(name, def)` helper, names prefixed `DIG_`.
- **Test gate per task:** targeted `npx jest <file>` green → full `npm test` green → commit. No task may commit a red suite.

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `lib/dig/frame-select.ts` | Pure: parse scene-change offsets; choose best frame (anchor/cut-bound/local-stability plateau) | **Create** |
| `tests/lib/dig/frame-select.test.ts` | Unit tests for the pure logic (synthetic sequences) | **Create** |
| `lib/dig/slides.ts` | I/O orchestrator: per-token extend-on-demand download + selection; constants/env | **Modify** |
| `tests/lib/dig/slides.test.ts` | Orchestrator call-pattern + degradation tests (mocked exec); remove tests for deleted internals | **Modify** |
| `tests/lib/dig/slides-helpers.test.ts` | Remove `parseFirstSceneChange`/`pickLargestFile` blocks; keep `numEnv` | **Modify** |
| `lib/dig/generate.ts` | Bump `DIG_GENERATOR_VERSION` 5 → 6 | **Modify** |
| `tests/lib/dig/generate.test.ts` | Update `toBe(5)` → `toBe(6)` (line 188) | **Modify** |
| `docs/reviews/dig-window-capping-calibration.md` | Empirical scene-threshold calibration record | **Create** |

**Shared types (Task 1/2, used by Task 4):**

```ts
// lib/dig/frame-select.ts
export interface SampledFrame { offset: number; size: number; } // offset = seconds relative to token.sec
export interface FrameChoice { bestIndex: number; bestOffset: number; atTrailingEdge: boolean; }
export function parseSceneChanges(ffmpegStderr: string, baseOffset: number): number[];
export function chooseFrame(
  frames: SampledFrame[],
  sceneChanges: number[],
  cfg?: { flatEps?: number },
): FrameChoice;
```

---

### Task 1: `parseSceneChanges` — collect all scene-change offsets

**Files:**
- Create: `lib/dig/frame-select.ts`
- Test: `tests/lib/dig/frame-select.test.ts`

**Interfaces:**
- Produces: `parseSceneChanges(ffmpegStderr: string, baseOffset: number): number[]` — every `pts_time` in the `showinfo` stderr, each `+ baseOffset` (the clip-start position relative to `sec`, e.g. `-3`). Ascending, finite, deduplicated. Correctness depends on the caller's `select='gt(scene,T)'` pre-filter so only scene-change frames reach `showinfo` (L1).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/dig/frame-select.test.ts
import { parseSceneChanges } from '@/lib/dig/frame-select';

describe('parseSceneChanges', () => {
  it('returns every pts_time shifted by baseOffset, ascending', () => {
    const stderr =
      '[Parsed_showinfo_1 @ 0x1] n:0 pts_time:2.0 ...\n' +
      '[Parsed_showinfo_1 @ 0x1] n:1 pts_time:5.5 ...\n';
    expect(parseSceneChanges(stderr, -3)).toEqual([-1, 2.5]); // clip started 3s before sec
  });
  it('returns [] when no scene changes are present', () => {
    expect(parseSceneChanges('no scene info', -3)).toEqual([]);
  });
  it('dedupes and sorts', () => {
    expect(parseSceneChanges('pts_time:4.0 x\npts_time:1.0 y\npts_time:4.0 z\n', 0)).toEqual([1, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest frame-select`
Expected: FAIL — module/function missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/dig/frame-select.ts
export interface SampledFrame { offset: number; size: number; }
export interface FrameChoice { bestIndex: number; bestOffset: number; atTrailingEdge: boolean; }

/** Every `pts_time` from ffmpeg `showinfo` stderr, shifted by `baseOffset`
 *  (clip-start position relative to the token's `sec`). Ascending, deduped, finite.
 *  Correctness depends on the caller pre-filtering with `select='gt(scene,T)'` so
 *  only scene-change frames emit showinfo lines. */
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

- [ ] **Step 4: Run test to verify it passes** — `npx jest frame-select` → PASS (3).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/frame-select.ts tests/lib/dig/frame-select.test.ts
git commit -m "feat(dig): parseSceneChanges — all scene-change offsets (pure)"
```

---

### Task 2: `chooseFrame` — anchor / cut-bound / local-stability plateau

**Files:**
- Modify: `lib/dig/frame-select.ts`
- Test: `tests/lib/dig/frame-select.test.ts`

**Interfaces:**
- Consumes: `SampledFrame { offset, size }`; scene-change offsets from Task 1.
- Produces: `chooseFrame(frames, sceneChanges, cfg?) → FrameChoice { bestIndex, bestOffset, atTrailingEdge }`.

**Algorithm (B6 + H3 fixes):**
1. **Anchor** = the frame whose `offset` is nearest `0` (the frame at `sec`; tolerates the fps grid placing it at ±0.5).
2. **Boundary** = first scene change strictly `> anchor.offset` (else `Infinity`). **Candidates** = frames with `anchor.offset <= offset < boundary` (the slide Gemini meant; never the next slide).
3. **Settle (local stability, not running-max):** walking candidates in order, the slide is settled at the first index `i` where the next frame is **not meaningfully larger** — `(pool[i+1].size − pool[i].size) / max(pool[i].size, 1) < flatEps` (default `0.10`). Pick `pool[i]`. This stops at the current slide's plateau even when a soft fade later defeats the cut detector — a missed cut can only let the walk run to the trailing edge (then extend by one bounded segment), never silently into the next slide's frame.
4. If no settle point (size strictly rising through the last candidate) → pick the **last** candidate; `atTrailingEdge = (boundary === Infinity) && pool.length >= 2` (still climbing, room to look further). A **flat or single-frame** window settles at step 3 → `atTrailingEdge = false` (H3: never extend a stable window).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/dig/frame-select.test.ts (append)
import { chooseFrame, type SampledFrame } from '@/lib/dig/frame-select';
const F = (offset: number, size: number): SampledFrame => ({ offset, size });

describe('chooseFrame', () => {
  it('A. stable: ~flat sizes → anchor (offset 0), not trailing edge', () => {
    const c = chooseFrame([F(-3,100),F(-2,101),F(-1,100),F(0,102),F(1,101),F(2,100)], []);
    expect(c.bestOffset).toBe(0);
    expect(c.atTrailingEdge).toBe(false);
  });
  it('B. fast-cut: cut at +3 bounds window → anchor, never the bigger later slide', () => {
    const c = chooseFrame([F(0,100),F(1,101),F(2,100),F(3,500),F(4,520)], [3]);
    expect(c.bestOffset).toBe(0);
    expect(c.atTrailingEdge).toBe(false);
  });
  it('C. build: rises then plateaus → first settled frame (offset 6), not trailing', () => {
    // growth 0.40,0.29,0.10,0.01 ; strict < 0.10 settles at the 0.01 step → offset 6 (size 198)
    const c = chooseFrame([F(0,100),F(2,140),F(4,180),F(6,198),F(8,200),F(10,200)], []);
    expect(c.bestOffset).toBe(6);
    expect(c.atTrailingEdge).toBe(false);
  });
  it('C-edge. still climbing at last frame → atTrailingEdge true (extend)', () => {
    const c = chooseFrame([F(0,100),F(2,140),F(4,180),F(6,230)], []); // 0.40,0.29,0.28 never < 0.10
    expect(c.bestOffset).toBe(6);
    expect(c.atTrailingEdge).toBe(true);
  });
  it('single-frame window → no extend (H3)', () => {
    const c = chooseFrame([F(0,100)], []);
    expect(c.bestOffset).toBe(0);
    expect(c.atTrailingEdge).toBe(false);
  });
  it('ignores scene changes at or before the anchor', () => {
    const c = chooseFrame([F(0,100),F(2,140),F(4,200)], [-1, 0]); // both <= anchor → no boundary
    expect(c.bestOffset).toBe(4);
    expect(c.atTrailingEdge).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest frame-select` → FAIL (`chooseFrame` missing).

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/dig/frame-select.ts (append)
export function chooseFrame(
  frames: SampledFrame[],
  sceneChanges: number[],
  cfg: { flatEps?: number } = {},
): FrameChoice {
  if (frames.length === 0) throw new Error('chooseFrame: no frames');
  const flatEps = cfg.flatEps ?? 0.1;

  // Anchor = frame nearest sec (offset 0).
  const anchor = frames.reduce((a, b) => (Math.abs(b.offset) < Math.abs(a.offset) ? b : a));

  // Boundary = first hard cut strictly after the anchor; the slide ends there.
  const cut = sceneChanges.find((c) => c > anchor.offset);
  const bound = cut ?? Infinity;

  // Candidates: anchor forward, up to (not including) the cut.
  const cand = frames.filter((f) => f.offset >= anchor.offset && f.offset < bound);
  const pool = cand.length > 0 ? cand : [anchor];

  // Local-stability settle: first frame whose successor is not meaningfully larger.
  let settleIdx = -1;
  for (let i = 0; i < pool.length - 1; i++) {
    const growth = (pool[i + 1].size - pool[i].size) / Math.max(pool[i].size, 1);
    if (growth < flatEps) { settleIdx = i; break; }
  }

  let best: SampledFrame;
  let atTrailingEdge: boolean;
  if (settleIdx >= 0) {
    best = pool[settleIdx];
    atTrailingEdge = false;
  } else {
    best = pool[pool.length - 1];          // strictly rising to the end → still building
    atTrailingEdge = bound === Infinity && pool.length >= 2;
  }

  return { bestIndex: frames.indexOf(best), bestOffset: best.offset, atTrailingEdge };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx jest frame-select` → PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/frame-select.ts tests/lib/dig/frame-select.test.ts
git commit -m "feat(dig): chooseFrame — anchor/cut-bound/local-stability selection (pure)"
```

---

### Task 3: Calibrate `DIG_SCENE_THRESHOLD` (empirical)

**Files:**
- Create: `docs/reviews/dig-window-capping-calibration.md`
- (the chosen constant is set in Task 4)

**Why no unit test:** the threshold lives in the ffmpeg `gt(scene,T)` pass over real video; the logic consuming its output is unit-tested in Task 2. **Calibration-failure policy (M4):** if no single threshold cleanly separates cuts from build-steps on the labeled set, **ship threshold-only anyway** — the local-stability plateau (Task 2, step 3) bounds a missed cut to at most one extend segment, so a slightly-wrong threshold degrades gracefully rather than wandering. Do NOT add a second metric (YAGNI); record the residual error instead.

- [ ] **Step 1: Pick 6 representative spike tokens:** stable `Lm8BLHkxiAo 344`, `yjim3_bAkqA 537`; fast-cut `P_E29-87THI 333`, `P_E29-87THI 444`; build `P_E29-87THI 113`, `yjim3_bAkqA 526`.

- [ ] **Step 2: For each, scene-detect at thresholds {0.15,0.20,0.25,0.30,0.40}** over `[sec−3, sec+18]`:

```bash
yt-dlp -q --download-sections "*$((sec-3))-$((sec+18))" -f 'bv[height<=720]' -o /tmp/cal.mp4 "https://www.youtube.com/watch?v=$VID"
for T in 0.15 0.20 0.25 0.30 0.40; do echo "T=$T"; ffmpeg -hide_banner -loglevel info -i /tmp/cal.mp4 \
  -vf "select='gt(scene,$T)',showinfo" -f null - 2>&1 | grep -oE 'pts_time:[0-9.]+'; done
```

- [ ] **Step 3: Choose the threshold** that fires on the fast-cut decks (`333`,`444`) without firing mid-build on `113`. Record per-token results, chosen value, residual error, and the M4 threshold-only decision in `docs/reviews/dig-window-capping-calibration.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/dig-window-capping-calibration.md
git commit -m "docs(dig): scene-threshold calibration record for window-capping"
```

---

### Task 4: Orchestrator — per-token extend-on-demand download + selection

**Files:**
- Modify: `lib/dig/slides.ts`
- Test: `tests/lib/dig/slides.test.ts`

**Interfaces:**
- Consumes: `chooseFrame`, `parseSceneChanges` (Tasks 1–2); existing `assertVideoId`, `parseSlideTokens`, `resolveAssetPath`, `stripUnresolvedSlideTokens`, `runCapture`, `execFileAsync`.
- New constants (via `numEnv`): `BACK_PAD=3`, `BASE_FWD=6`, `EXTEND_SEC=6`, `MAX_EXTENDS=3` (L4: explicit, replaces the ambiguous `DIG_SEG`/`MAX_FWD`); `SCENE_THRESHOLD` default = Task 3's value; `SAMPLE_FPS=2` retained. **M2:** `MAX_EXTENDS=3` bounds the download to ≤ **4 `yt-dlp` calls/token** (≤12/section). The 403 that motivated this work came from *one sustained ~19-minute transfer*, not call count; four sequential ~6–9s clips are small and fast. Reaching `sec + BASE_FWD + EXTEND_SEC*MAX_EXTENDS = sec+24` covers the longest build the spike observed (~18s).
- Produces: internal `captureSlideFrame({ videoId, youtubeUrl, sec, endSec, outPath }): Promise<void>` — downloads/extends, writes the chosen frame to `outPath`, throws if no frame could be produced; deletes its own temp clips/frames on every path. **(M1: `captureSlideFrame` TRUSTS `outPath`; the caller `resolveSlideTokens` performs the `assetsRoot` containment check before calling — see the comment in the code.)**

**H1 note:** the `fps` filter emits constant-rate frames from clip `t=0`, so a frame's `i / SAMPLE_FPS` equals its clip-relative `pts_time` — the **same timeline** the scene pass reports. Any keyframe-`δ` from `--download-sections` shifts *both* equally (absolute label fuzz only); selection runs on the actual downloaded frames' size profile, so the chosen frame is correct regardless.

**Behavior table (test contract):**

| # | Scenario | Trigger | Expected |
|---|---|---|---|
| 1 | Stable | flat sizes, no cut | 1 `yt-dlp`; anchor written |
| 2 | Fast-cut | cut within base | 1 `yt-dlp`; no extend; anchor written |
| 3 | Build settles in base | plateau before trailing edge | 1 `yt-dlp`; plateau frame written |
| 4 | Build climbing | trailing edge, no cut | 2–4 `yt-dlp`; stops on plateau |
| 5 | Safety cap | climbs past `MAX_EXTENDS` | stops after 4 calls; best-so-far written |
| 6 | Base download fails | `yt-dlp` throws on first segment | token dropped (`[dig-slide-miss]`), others kept |
| 7 | Extension download fails | base ok, later segment throws | best-so-far written (NOT dropped) |
| 8 | Token at endSec | `endSec − sec < BASE_FWD` | window clamped; frame still written; no extend |

**Mock contract (M3 — implement these helpers next to `mockFfmpegPipeline`):** an invocation counter maps the **Nth `yt-dlp` call → segment N (0-based)**; the immediately following `fps` ffmpeg call writes `sizeProfiles[N].length` frames whose byte sizes are `sizeProfiles[N]` (via `Buffer.alloc`), and the following `scene` ffmpeg call returns `sceneStderrs[N]` (default `''`). Distinguish ffmpeg passes by args: contains `'scene'` → scene pass (return stderr), else contains `'fps='` → frame pass (write files). Factories: `mockExtend(sizeProfiles: number[][], sceneStderrs?: string[])`; derive `mockStable`, `mockFastCut`, `mockRisingThenPlateau`, `mockCapClimb`, `mockBaseFail`, `mockExtendFail` from it.

- [ ] **Step 1: Write failing tests** (append a `describe` block; use the `mockExtend` factory)

```ts
test('1. stable slide → one yt-dlp call, anchor frame written', async () => {
  mockExtend([[100, 100, 100, 100]]);                 // flat → settles immediately
  const out = await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(out).toContain('![S](assets/abc12345678/300-300.jpg)');
  expect(ytCalls()).toBe(1);
});
test('2. fast-cut → one yt-dlp call, never extends', async () => {
  mockExtend([[100, 101, 100, 500, 520]], ['pts_time:3.0\n']); // cut at +3 bounds it
  await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(ytCalls()).toBe(1);
});
test('3. build settles within base → one call, plateau frame', async () => {
  mockExtend([[100, 140, 180, 198, 200, 200]]);        // settles at offset ~3
  await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(ytCalls()).toBe(1);
});
test('4. build climbing → extends ≥2 calls, stops on plateau', async () => {
  mockExtend([[100, 140, 180, 230], [232, 233, 233]]); // seg0 rising to edge; seg1 plateaus
  await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(ytCalls()).toBeGreaterThanOrEqual(2);
});
test('5. safety cap → at most 4 yt-dlp calls', async () => {
  mockExtend([[1,2,3,4],[5,6,7],[8,9,10],[11,12,13],[14,15,16]]); // always climbing
  await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(ytCalls()).toBeLessThanOrEqual(4);
});
test('6. base download fails → token stripped, others kept', async () => {
  mockExecFile.mockImplementation((cmd: string, _a: string[], cb: (e: Error|null, so?: string, se?: string) => void) =>
    cmd === 'yt-dlp' ? cb(new Error('HTTP 403')) : cb(null, '', ''));
  const out = await resolveSlideTokens('a [[SLIDE:300|S]] b', getOpts());
  expect(out).not.toContain('[[SLIDE:'); expect(out).not.toContain('![');
});
test('7. extension download fails → best-so-far written', async () => {
  mockExtendThenFail([[100, 140, 180, 230]]); // base ok + trailing edge; 2nd yt-dlp throws
  const out = await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  expect(out).toContain('![S](assets/abc12345678/300-300.jpg)');
});
test('8. token at endSec → window clamped, one call, frame written', async () => {
  mockExtend([[100, 100]]);
  const out = await resolveSlideTokens('see [[SLIDE:400|E]]', getOpts()); // endSec 400
  expect(out).toContain('![E](assets/abc12345678/300-400.jpg)');
  expect(ytCalls()).toBe(1);
});
```

> `ytCalls()` = `mockExecFile.mock.calls.filter(c => c[0] === 'yt-dlp').length`. `getOpts()` returns `{ videoId:'abc12345678', startSec:300, endSec:400, assetsRoot: tmpAssetsRoot, sectionId:300 }` (existing helper).

- [ ] **Step 2: Run tests to verify they fail** — `npx jest slides.test -t "yt-dlp call"` etc. → FAIL.

- [ ] **Step 3: Implement** — add constants, `captureSlideFrame`, and rewrite the `resolveSlideTokens` loop.

Constants near the existing ones:

```ts
const BACK_PAD = numEnv('DIG_BACK_PAD', 3);
const BASE_FWD = numEnv('DIG_BASE_FWD', 6);
const EXTEND_SEC = numEnv('DIG_EXTEND_SEC', 6);
const MAX_EXTENDS = numEnv('DIG_MAX_EXTENDS', 3);
// SCENE_THRESHOLD default = Task 3 value; SAMPLE_FPS retained.
```

`captureSlideFrame` (replaces `captureBestFrame`):

```ts
import { chooseFrame, parseSceneChanges, type SampledFrame } from '@/lib/dig/frame-select';

/** Download a small window around `sec` and extend forward (≤ MAX_EXTENDS bounded
 *  segments) only while the slide is still building and no cut has been crossed;
 *  write the chosen frame to `outPath`. Throws if no frame could be produced.
 *  SECURITY: trusts `outPath` — the caller MUST containment-check it first. */
async function captureSlideFrame(opts: {
  videoId: string; youtubeUrl: string; sec: number; endSec: number; outPath: string;
}): Promise<void> {
  const { youtubeUrl, sec, endSec, outPath } = opts;
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const winStart = Math.max(0, sec - BACK_PAD);
  const cap = Math.min(endSec, sec + BASE_FWD + EXTEND_SEC * MAX_EXTENDS);
  let winEnd = Math.min(cap, sec + BASE_FWD);

  const frames: Array<SampledFrame & { path: string }> = [];
  const sceneChanges: number[] = [];
  const tmpClips: string[] = [];
  let downloadedTo = winStart;
  let baseDone = false;
  let extends_ = 0;

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
        if (!baseDone) throw err;  // base failed → caller drops the token
        break;                     // extension failed → use best-so-far
      }
      baseDone = true;

      // Sample this segment at SAMPLE_FPS. fps filter is CFR from t=0, so frame k's
      // clip-relative time is k/SAMPLE_FPS; offset(to sec) = segBase + k/SAMPLE_FPS.
      const segBase = downloadedTo - sec;
      const segDir = fs.mkdtempSync(path.join(cacheDir, 'frames-'));
      try {
        await execFileAsync('ffmpeg', [
          '-y', '-i', clip, '-vf', `fps=${SAMPLE_FPS}`, '-q:v', '2',
          path.join(segDir, 'f_%03d.jpg'),
        ]);
        const names = fs.readdirSync(segDir).filter((n) => n.endsWith('.jpg')).sort();
        names.forEach((n, k) => {
          const kept = path.join(cacheDir, `frame-${crypto.randomUUID()}.jpg`);
          fs.renameSync(path.join(segDir, n), kept);
          frames.push({ offset: segBase + k / SAMPLE_FPS, size: fs.statSync(kept).size, path: kept });
        });
        const { stderr } = await runCapture('ffmpeg', [
          '-i', clip, '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-',
        ]);
        for (const o of parseSceneChanges(stderr, segBase)) sceneChanges.push(o);
      } finally {
        fs.rmSync(segDir, { recursive: true, force: true }); // empty after renames
      }

      if (frames.length === 0) throw new Error('no frames sampled');
      const choice = chooseFrame(frames, sceneChanges);
      if (!choice.atTrailingEdge || winEnd >= cap || extends_ >= MAX_EXTENDS) {
        fs.copyFileSync(frames[choice.bestIndex].path, outPath);
        return;
      }
      downloadedTo = winEnd;
      winEnd = Math.min(cap, winEnd + EXTEND_SEC);
      extends_++;
    }
    // Loop broke on extension failure → best-so-far.
    if (frames.length === 0) throw new Error('no frames sampled');
    const choice = chooseFrame(frames, sceneChanges);
    fs.copyFileSync(frames[choice.bestIndex].path, outPath);
  } finally {
    for (const c of tmpClips) { try { fs.unlinkSync(c); } catch { /* ignore */ } }
    for (const f of frames) { try { fs.unlinkSync(f.path); } catch { /* ignore */ } }
  }
}
```

Rewrite the `resolveSlideTokens` body — drop the single-section download + outer clip `try/finally`; keep validation, the empty-token short-circuit, the server-built `youtubeUrl`, the containment guard (before the call), token rewrite, and the final strip:

```ts
// inside resolveSlideTokens, after `const youtubeUrl = ...;`
let result = markdown;
for (const token of tokens) {
  const assetPath = resolveAssetPath(assetsRoot, videoId, sectionId, token.sec);
  const resolvedRoot = path.resolve(assetsRoot);
  if (!assetPath.startsWith(resolvedRoot + path.sep)) {                 // containment BEFORE any write
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

(Keep `assertVideoId`, `parseSlideTokens`, and the `tokens.length === 0` short-circuit above this. Remove the module-level `cacheDir`/`tmpClip` block and outer `finally` — each `captureSlideFrame` owns its clips.)

- [ ] **Step 4: Run tests to verify they pass** — `npx jest slides.test` → PASS (scenarios 1–8). Fix any pre-existing tests that asserted deleted internals **in Task 5** (they are removed there).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/dig/slides.ts tests/lib/dig/slides.test.ts
git commit -m "feat(dig): per-token extend-on-demand capped download + anchor-aware selection"
```

> Note: between Task 4 and Task 5 the suite has known-failing legacy tests (removed in Task 5). Run the **targeted** `npx jest slides.test -t "yt-dlp"` green before this commit; the **full** suite green gate is satisfied at the end of Task 5.

---

### Task 5: Remove dead helpers, bump version, green the full suite

**Files:**
- Modify: `lib/dig/slides.ts` — delete `captureBestFrame`, `singleFrameCapture`, `parseFirstSceneChange`, `pickLargestFile`, and the `MAX_WINDOW_SEC` const.
- Modify: `tests/lib/dig/slides-helpers.test.ts` — remove the `parseFirstSceneChange` and `pickLargestFile` `describe` blocks; **keep `numEnv`**.
- Modify: `tests/lib/dig/slides.test.ts` — delete the legacy `captureBestFrame`/single-frame tests superseded by Task 4: the cases asserting `-ss <relStart>`, the `--download-sections *startSec-endSec` range, `-frames:v 1` single-frame fallback, the `-y` single-frame test, and the scene-bounds-window test. **Re-home the surviving security/contract assertions** (server-built `youtube.com/watch?v=` URL; `execFile` argv-array — never a shell string) into the Task-4 orchestrator describe block if not already covered there.
- Modify: `lib/dig/generate.ts` — `DIG_GENERATOR_VERSION = 6`.
- Modify: `tests/lib/dig/generate.test.ts` — line 188 `toBe(5)` → `toBe(6)` (M5).

- [ ] **Step 1: Delete the dead functions/const** from `slides.ts` (`parseFirstSceneChange`, `singleFrameCapture`, `captureBestFrame`, `pickLargestFile`, `MAX_WINDOW_SEC`). Set `SCENE_THRESHOLD` default to Task 3's value.

- [ ] **Step 2: Remove/relocate tests.** Delete the `parseFirstSceneChange` + `pickLargestFile` blocks in `slides-helpers.test.ts`; delete the superseded legacy cases in `slides.test.ts`; ensure a server-built-URL and an argv-array assertion exist in the orchestrator block (add if missing):

```ts
test('security: builds the youtube URL server-side and uses argv arrays only', async () => {
  mockExtend([[100, 100]]);
  await resolveSlideTokens('see [[SLIDE:300|S]]', getOpts());
  const yt = mockExecFile.mock.calls.find((c: unknown[]) => c[0] === 'yt-dlp')!;
  expect((yt[1] as string[])).toContain('https://www.youtube.com/watch?v=abc12345678');
  mockExecFile.mock.calls.forEach((c: unknown[]) => expect(Array.isArray(c[1])).toBe(true));
});
```

- [ ] **Step 3: Bump version** — `export const DIG_GENERATOR_VERSION = 6;` and update `generate.test.ts:188` to `toBe(6)`.

- [ ] **Step 4: Verify no dangling references**

Run: `grep -rn "captureBestFrame\|singleFrameCapture\|parseFirstSceneChange\|pickLargestFile\|MAX_WINDOW_SEC" lib/ tests/`
Expected: no matches.

- [ ] **Step 5: Typecheck + full suite** — `npx tsc --noEmit && npm test` → `tsc` clean; all suites green.

- [ ] **Step 6: Commit**

```bash
git add lib/dig/slides.ts lib/dig/generate.ts tests/lib/dig/slides-helpers.test.ts tests/lib/dig/slides.test.ts tests/lib/dig/generate.test.ts
git commit -m "refactor(dig): drop fixed-window helpers; bump DIG_GENERATOR_VERSION 5→6"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §3.1 extend-on-demand download (bounded by `MAX_EXTENDS`) | Task 4 |
| §3.2 anchor/cut-bound/settle selection | Task 2 (logic), Task 4 (wiring) |
| §3.3 cut detector + recalibration (threshold-only per M4) | Task 1, Task 3 |
| §3.4 settle (local-stability plateau) | Task 2 |
| §4 pure vs I/O split | Tasks 1–2 vs Task 4 |
| §5 error degradation (base vs extension fail) | Task 4 scenarios 6–7 |
| §6 testing (synthetic + call-pattern + regression) | Tasks 2, 4, 5 |
| §7 scope: 3-token cap OUT | not implemented (correct) |
| §8 migration v5→6 | Task 5 |
| §9 constants/env | Task 4 + Task 3 |

**2. Behavior-table coverage (review H5):** scenarios 1–8 each have a test in Task 4 Step 1 (1 stable, 2 fast-cut, 3 plateau-in-base, 4 climbing-extend, 5 safety-cap, 6 base-fail, 7 extension-fail, 8 endSec). Security re-homed in Task 5 Step 2.

**3. Placeholder scan:** Task 3 is an explicitly empirical task with exact commands (no logic placeholder). Mock factories are fully specified by the M3 contract (invocation-index → size-profile → scene-stderr).

**4. Type consistency:** `SampledFrame{offset,size}`, `FrameChoice{bestIndex,bestOffset,atTrailingEdge}`, `parseSceneChanges(stderr,baseOffset)`, `chooseFrame(frames,sceneChanges,cfg?)`, `captureSlideFrame({videoId,youtubeUrl,sec,endSec,outPath})` — consistent across Tasks 1,2,4,5.

---

## Post-Plan Gate (dev-process.md)

- [x] Adversarial review of the plan → `docs/reviews/plan-dig-window-capping-review.md` (Claude fallback; Codex at limit — re-attempt before merge if access returns)
- [x] Blocking/High addressed inline (rev 2): B6 local-stability, H1 CFR note, H3 atTrailingEdge, H4 verified-off, H5 scenarios 2/3/5/8, H6 realistic mocks
- [ ] Present Medium decisions (M2 extend-cap, M4 threshold-only) to user
- [ ] Explicit human approval to proceed
