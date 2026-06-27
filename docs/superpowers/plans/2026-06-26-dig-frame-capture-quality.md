# Dig Frame Capture Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the most-complete frame of an animated slide by sampling a scene-bounded window around the slide's timestamp and keeping the largest frame, instead of grabbing one frame at one instant.

**Architecture:** Replace the single-frame `ffmpeg` call in `resolveSlideTokens` with a `captureBestFrame` orchestration: an ffmpeg scene-detect pass finds the next slide transition (window end), an ffmpeg `fps` pass samples the window, and the largest JPEG is selected. Pure helpers (`parseFirstSceneChange`, `pickLargestFile`) are unit-tested in isolation. A prompt nudge points Gemini at the settled frame; a version bump re-flags existing sections.

**Tech Stack:** TypeScript, Next.js, jest (mocks `node:child_process`), ffmpeg, yt-dlp.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-26-dig-frame-capture-quality-design.md`.
- `tsc --noEmit` must stay clean (jest uses SWC — `tsc` is the real gate).
- All exec calls use `execFile` with array argv — never a shell string. Preserve `assertVideoId` and assetsRoot containment guards, and the `finally` temp-clip deletion.
- Constants are env-overridable: `SCENE_THRESHOLD`=`DIG_SCENE_THRESHOLD`(0.4), `MAX_WINDOW_SEC`=`DIG_MAX_WINDOW_SEC`(8), `SAMPLE_FPS`=`DIG_SAMPLE_FPS`(2). Override applies only when the env var parses to a finite number.
- Per-token ffmpeg failure must drop that token (logged `[dig-slide-miss]`) and never leak a raw token — `stripUnresolvedSlideTokens` still runs.

### Verified ffmpeg facts (from adversarial review — rely on these)

- `ffmpeg -ss <rel> -i clip -vf "select='gt(scene,T)',showinfo" -f null -` writes `showinfo` to **stderr**; `pts_time` is **relative to the `-ss` seek point**; the first post-seek frame is NOT auto-selected (no spurious `pts_time:0`). Real output uses integer or decimal seconds, e.g. `pts_time:1` or `pts_time:3.200000`.
- `fps=2 -t 0.1` emits **0 frames**; `fps=2 -t 0.5` emits 1. Sampling window must be ≥ ~`1/SAMPLE_FPS` (floored at 0.5s).
- **`util.promisify` of a jest-mocked `execFile` resolves to `stdout` only** (the mock loses the `promisify.custom` symbol) — so reading `{ stderr }` from `execFileAsync` returns `undefined` under test. The scene pass MUST use the explicit `runCapture` wrapper below, never `execFileAsync` destructuring `stderr`.

---

### Task 1: Pure helpers — env constants, scene-change parser, largest-file picker

**Files:**
- Modify: `lib/dig/slides.ts` (add helpers + constants near the top of the module body)
- Test: `tests/lib/dig/slides-helpers.test.ts` (new)

**Interfaces:**
- Produces:
  - `parseFirstSceneChange(ffmpegOutput: string, maxFallbackSec: number): number` — exported
  - `pickLargestFile(dir: string): string | null` — exported
  - module constants `SCENE_THRESHOLD`, `MAX_WINDOW_SEC`, `SAMPLE_FPS` (not exported)

- [ ] **Step 1: Write the failing tests** (`tests/lib/dig/slides-helpers.test.ts`)

```typescript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFirstSceneChange, pickLargestFile } from '@/lib/dig/slides';

describe('parseFirstSceneChange', () => {
  it('returns the first decimal pts_time from ffmpeg showinfo output', () => {
    const out = '[Parsed_showinfo_1 @ 0x1] n:0 pts:96000 pts_time:3.200000 pos:1\n' +
                '[Parsed_showinfo_1 @ 0x1] n:1 pts:210000 pts_time:7.000000 pos:2\n';
    expect(parseFirstSceneChange(out, 8)).toBeCloseTo(3.2);
  });
  it('parses an integer pts_time (real ffmpeg emits e.g. pts_time:1)', () => {
    expect(parseFirstSceneChange('x pts_time:1 y', 8)).toBe(1);
  });
  it('returns the fallback when no scene change is present', () => {
    expect(parseFirstSceneChange('no scene info here', 8)).toBe(8);
  });
  it('returns the fallback when pts_time is zero or non-finite', () => {
    expect(parseFirstSceneChange('pts_time:0', 8)).toBe(8);
    expect(parseFirstSceneChange('pts_time:abc', 8)).toBe(8);
  });
});

describe('pickLargestFile', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns the largest file by byte size', () => {
    fs.writeFileSync(path.join(dir, 'a.jpg'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dir, 'b.jpg'), Buffer.alloc(100));
    fs.writeFileSync(path.join(dir, 'c.jpg'), Buffer.alloc(50));
    expect(pickLargestFile(dir)).toBe(path.join(dir, 'b.jpg'));
  });
  it('returns null for an empty directory', () => {
    expect(pickLargestFile(dir)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest slides-helpers`
Expected: FAIL — `parseFirstSceneChange`/`pickLargestFile` are not exported yet.

- [ ] **Step 3: Add the constants + helpers to `lib/dig/slides.ts`** (after the imports, before `resolveSlideTokens`)

```typescript
/** Read a finite numeric env override, else the default. */
function numEnv(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

/** Scene-change sensitivity: ignore intra-slide animation, catch slide swaps. */
const SCENE_THRESHOLD = numEnv('DIG_SCENE_THRESHOLD', 0.4);
/** Fallback window length when no slide transition is detected (seconds). */
const MAX_WINDOW_SEC = numEnv('DIG_MAX_WINDOW_SEC', 8);
/** Frame sampling density within the window (frames per second). */
const SAMPLE_FPS = numEnv('DIG_SAMPLE_FPS', 2);

/**
 * Parse the first scene-change timestamp (seconds, relative to the window start)
 * from ffmpeg `showinfo` output. Returns `maxFallbackSec` when none is found or
 * the value is non-positive / non-finite.
 */
export function parseFirstSceneChange(ffmpegOutput: string, maxFallbackSec: number): number {
  const m = ffmpegOutput.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return maxFallbackSec;
  const t = Number(m[1]);
  return Number.isFinite(t) && t > 0 ? t : maxFallbackSec;
}

/** Return the path of the largest file in `dir`, or null if the dir has no files. */
export function pickLargestFile(dir: string): string | null {
  let best: string | null = null;
  let bestSize = -1;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isFile() && st.size > bestSize) {
      bestSize = st.size;
      best = p;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run the tests to verify they pass** — `npx jest slides-helpers` → PASS (8 assertions).
- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` → exit 0.
- [ ] **Step 6: Commit**

```bash
git add lib/dig/slides.ts tests/lib/dig/slides-helpers.test.ts
git commit -m "feat(dig): add scene-change parser + largest-file picker + env constants"
```

---

### Task 2: `captureBestFrame` orchestration + migrate existing tests

**Files:**
- Modify: `lib/dig/slides.ts` (add `runCapture`, `singleFrameCapture`, `captureBestFrame`; replace the single-frame ffmpeg call in `resolveSlideTokens`)
- Test: `tests/lib/dig/slides.test.ts` (add a shared mock helper; add new tests; MIGRATE 5 existing tests)

**Interfaces:**
- Consumes: `parseFirstSceneChange`, `pickLargestFile`, `SCENE_THRESHOLD`, `MAX_WINDOW_SEC`, `SAMPLE_FPS` (Task 1); `_execFile` (raw, imported at slides.ts:15) and `execFileAsync` (existing).
- Produces: `captureBestFrame(opts: { clipPath: string; relStart: number; maxWindowSec: number; outPath: string }): Promise<void>` (module-internal). Resolves after writing the chosen frame to `outPath`; throws if no frame could be produced (caller drops the token).

- [ ] **Step 1: Add a shared ffmpeg-pipeline mock helper + new tests** (in `tests/lib/dig/slides.test.ts`)

Do NOT add `import os` — `os` is already imported at the top of the file (H1). Place this helper after `getOpts()`:

```typescript
// Emulates the ffmpeg pipeline: scene-detect (stderr), fps-extract (writes frames),
// single-frame (writes the asset directly). One mock for all capture paths.
function mockFfmpegPipeline(sceneStderr = 'pts_time:3.0\n', frameSizes = [10, 500]) {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so: string, se: string) => void) => {
      if (cmd === 'yt-dlp') return cb(null, '', '');
      const a = args.join(' ');
      if (a.includes('scene')) return cb(null, '', sceneStderr);           // scene-detect → stderr
      if (a.includes('fps=')) {                                            // window sampling
        const dir = path.dirname(args[args.length - 1]);                   // <dir>/f_%03d.jpg
        frameSizes.forEach((sz, i) =>
          fs.writeFileSync(path.join(dir, `f_${String(i + 1).padStart(3, '0')}.jpg`), Buffer.alloc(sz)));
        return cb(null, '', '');
      }
      if (a.includes('-frames:v')) {                                       // single-frame fallback
        fs.writeFileSync(args[args.length - 1], Buffer.alloc(42));         // outPath
        return cb(null, '', '');
      }
      return cb(null, '', '');
    },
  );
}

test('captureBestFrame: samples the window and writes the largest frame to the asset path', async () => {
  mockFfmpegPipeline('pts_time:3.0\n', [10, 500]);
  const out = await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  expect(out).toContain('![Build](assets/abc12345678/300-352.jpg)');
  const asset = path.join(tmpAssetsRoot, 'abc12345678', '300-352.jpg');
  expect(fs.existsSync(asset)).toBe(true);
  expect(fs.statSync(asset).size).toBe(500); // the largest sampled frame
});

test('captureBestFrame: scene-detect argv uses the configured threshold + showinfo', async () => {
  mockFfmpegPipeline();
  await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  const sceneCall = mockExecFile.mock.calls.find(
    (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).join(' ').includes('scene'),
  ) as unknown[] | undefined;
  expect(sceneCall).toBeDefined();
  expect((sceneCall![1] as string[]).join(' ')).toMatch(/select='gt\(scene,0\.4\)',showinfo/);
});

test('captureBestFrame: sampling produces no frames → token dropped, no leak', async () => {
  mockFfmpegPipeline('pts_time:3.0\n', []); // fps writes ZERO frames
  const out = await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).not.toContain('![');
});

test('captureBestFrame: token at endSec → single-frame fallback (no sampling window)', async () => {
  mockFfmpegPipeline();
  // token.sec == endSec (400) → maxWindowSec = 0 → single-frame path
  const out = await resolveSlideTokens('see [[SLIDE:400|Edge]]', getOpts());
  expect(out).toContain('![Edge](assets/abc12345678/300-400.jpg)');
  // exactly one ffmpeg capture happened, via -frames:v (no scene/fps calls)
  const ffmpegArgs = mockExecFile.mock.calls
    .filter((c: unknown[]) => c[0] === 'ffmpeg')
    .map((c: unknown[]) => (c[1] as string[]).join(' '));
  expect(ffmpegArgs.some((s) => s.includes('-frames:v'))).toBe(true);
  expect(ffmpegArgs.some((s) => s.includes('scene') || s.includes('fps='))).toBe(false);
});

test('captureBestFrame: scene change before MAX bounds the window (uses scene offset)', async () => {
  mockFfmpegPipeline('pts_time:2.0\n', [10, 500]);
  await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  const fpsCall = mockExecFile.mock.calls.find(
    (c: unknown[]) => (c[1] as string[]).join(' ').includes('fps='),
  ) as unknown[];
  const argv = fpsCall[1] as string[];
  const t = Number(argv[argv.indexOf('-t') + 1]);
  expect(t).toBeCloseTo(2.0); // bounded by the scene change, not MAX_WINDOW_SEC (8)
});
```

- [ ] **Step 2: Migrate the 5 existing tests broken by the new capture model** (same file)

The new model issues TWO ffmpeg calls per token (scene + fps) and writes frames to a temp dir, so the old `cb(null,'','')` / pre-created-asset mocks no longer satisfy these. Apply exactly:

1. **`happy path rewrites token and calls yt-dlp then ffmpeg with array argv`** (~line 59): replace its `mockExecFile.mockImplementation(... cb(null,'',''))` with a call to `mockFfmpegPipeline();` at the top of the test. Keep the assertions — `![Loop]` now resolves because frames are written. The `cmds` assertion `toContain('yt-dlp')`/`toContain('ffmpeg')` still holds.
2. **`mixed: valid token resolved to image, stray unresolved token stripped`** (~line 67): replace its mock with `mockFfmpegPipeline();`. Assertions unchanged.
3. **`second ffmpeg call fails → first token kept, second dropped`** (~line 201): rewrite so the failing unit is the **second token's fps pass**, counting fps passes (not raw ffmpeg calls):

```typescript
test('second token fps pass fails → first token kept, second dropped', async () => {
  let fpsCount = 0;
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so?: string, se?: string) => void) => {
      if (cmd === 'yt-dlp') return cb(null, '', '');
      const a = args.join(' ');
      if (a.includes('scene')) return cb(null, '', 'pts_time:3.0\n');
      if (a.includes('fps=')) {
        fpsCount++;
        if (fpsCount === 1) { // first token: write a frame
          fs.writeFileSync(path.join(path.dirname(args[args.length - 1]), 'f_001.jpg'), Buffer.alloc(99));
          return cb(null, '', '');
        }
        return cb(Object.assign(new Error('exit 1'), { code: 1 })); // second token: fps fails
      }
      return cb(null, '', '');
    },
  );
  const out = await resolveSlideTokens('[[SLIDE:310|A]] [[SLIDE:350|B]]', getOpts());
  expect(out).toContain('![A](assets/abc12345678/300-310.jpg)');
  expect(out).not.toContain('![B]');
  expect(out).not.toContain('[[SLIDE:350|B]]');
});
```

4. **`L-1: imgRef containing $& is not misinterpreted`** (~line 261): delete the pre-created-asset setup (the `fs.writeFileSync(assetFile, 'fake-jpeg')` and its `fs.unlinkSync`) and replace the mock with `mockFfmpegPipeline();`. The capture now writes the asset via the pipeline. Assertions (`![price $& more]`) unchanged.
5. **`L-1: duplicate slide token — both occurrences replaced`** (~line 284): same change — drop the pre-created asset, use `mockFfmpegPipeline();`. `parseSlideTokens` dedups to one token, captured once; `result.replace` rewrites both occurrences, so `count === 2` still holds.

(The `execFile is always called with array argv` test at ~line 242 mocks `cb(null,'','')` and asserts only argv shape — it does NOT assert a resolved ref, so it still passes as-is. Leave it.)

- [ ] **Step 3: Run the slides tests to verify the new ones fail (and see which migrations need code)**

Run: `npx jest dig/slides.test`
Expected: the 5 new `captureBestFrame` tests FAIL (function not implemented); migrated tests may error until Step 4 code exists. This confirms RED.

- [ ] **Step 4: Add `runCapture`, `singleFrameCapture`, `captureBestFrame` to `lib/dig/slides.ts`** (Helpers section, below `pickLargestFile`)

```typescript
/**
 * Run a command capturing BOTH stdout and stderr. `util.promisify` of a mocked
 * `execFile` resolves to stdout only (the mock drops the promisify.custom symbol),
 * so the scene pass — which needs stderr — wraps `_execFile` explicitly.
 */
function runCapture(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    _execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

/** Capture a single frame at `relStart` directly to `outPath` (the legacy path,
 *  used when the forward window is too small to sample). */
async function singleFrameCapture(clipPath: string, relStart: number, outPath: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-ss', String(relStart), '-i', clipPath, '-frames:v', '1', '-q:v', '2', outPath,
  ]);
}

/**
 * Capture the most-complete frame of the slide at `relStart` (clip-relative
 * seconds). Detects the next slide transition (scene detection) to bound a
 * window, samples it at SAMPLE_FPS, and writes the largest frame to `outPath`.
 * Throws if no frame could be produced (caller drops the token).
 */
async function captureBestFrame(opts: {
  clipPath: string; relStart: number; maxWindowSec: number; outPath: string;
}): Promise<void> {
  const { clipPath, relStart, maxWindowSec, outPath } = opts;
  const minSample = Math.max(0.5, 1 / SAMPLE_FPS);

  // Too little forward room (e.g. token at endSec) → grab the frame at relStart.
  if (maxWindowSec < minSample) {
    await singleFrameCapture(clipPath, relStart, outPath);
    return;
  }

  // 1. Scene detection → first transition offset (relative to relStart).
  let sceneOffset = maxWindowSec;
  try {
    const { stderr } = await runCapture('ffmpeg', [
      '-ss', String(relStart), '-t', String(maxWindowSec), '-i', clipPath,
      '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-',
    ]);
    sceneOffset = parseFirstSceneChange(stderr, maxWindowSec);
  } catch {
    sceneOffset = maxWindowSec; // scene-detect failed → fall back to MAX window
  }

  // Slide ends almost immediately → relStart is already the settled frame.
  if (sceneOffset < minSample) {
    await singleFrameCapture(clipPath, relStart, outPath);
    return;
  }

  // 2. Sample [relStart, relStart+winLen] at SAMPLE_FPS; keep the largest frame.
  const winLen = Math.min(sceneOffset, maxWindowSec); // in [minSample, maxWindowSec]
  const framesDir = fs.mkdtempSync(path.join(path.resolve('.cache'), 'frames-'));
  try {
    await execFileAsync('ffmpeg', [
      '-ss', String(relStart), '-t', String(winLen), '-i', clipPath,
      '-vf', `fps=${SAMPLE_FPS}`, '-q:v', '2', path.join(framesDir, 'f_%03d.jpg'),
    ]);
    const best = pickLargestFile(framesDir);
    if (!best) throw new Error('no frames sampled');
    fs.copyFileSync(best, outPath);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Replace the single-frame call in `resolveSlideTokens`**

Replace the `await execFileAsync('ffmpeg', ['-ss', String(token.sec - startSec), '-i', tmpClip, '-frames:v', '1', '-q:v', '2', assetPath]);` call with:

```typescript
        await captureBestFrame({
          clipPath: tmpClip,
          relStart: token.sec - startSec,
          maxWindowSec: Math.min(MAX_WINDOW_SEC, endSec - token.sec),
          outPath: assetPath,
        });
```

Leave the surrounding lines unchanged: the `imgRef` rewrite on success, and the `catch` that drops the token with `[dig-slide-miss]` and `result.replace(escapedRaw2, '')`.

- [ ] **Step 6: Run the slides suite + typecheck + full suite**

Run: `npx jest dig/slides.test && npx tsc --noEmit && npx jest`
Expected: all slides tests green (5 new + 5 migrated + untouched security/strip tests); tsc exit 0; full suite green.

- [ ] **Step 7: Commit**

```bash
git add lib/dig/slides.ts tests/lib/dig/slides.test.ts
git commit -m "feat(dig): capture scene-bounded most-complete frame (sample window, pick largest)"
```

---

### Task 3: Prompt nudge (settled timestamp) + version bump

**Files:**
- Modify: `lib/dig/generate.ts:13` (version) and the `[[SLIDE:]]` rule in `buildDigPrompt`
- Test: `tests/lib/dig/generate.test.ts`

**Interfaces:**
- Produces: `DIG_GENERATOR_VERSION = 5`; prompt text instructing the settled/fully-visible timestamp.

- [ ] **Step 1: Update the failing tests** (`tests/lib/dig/generate.test.ts`)

Change the version assertion (the `it('is the integer 4', ...)` block → `5`):

```typescript
  it('is the integer 5', () => {
    expect(DIG_GENERATOR_VERSION).toBe(5);
  });
```

Add a prompt-content test in the `describe('buildDigPrompt — slide selectivity', ...)` block:

```typescript
  it('asks for the timestamp when the slide is fully built / settled', () => {
    expect(p()).toMatch(/fully built|settled|finished animating|fully visible/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail** — `npx jest dig/generate` → FAIL (version is 4; nudge absent).

- [ ] **Step 3: Bump the version (`lib/dig/generate.ts:13`)** → `export const DIG_GENERATOR_VERSION = 5;`

- [ ] **Step 4: Add the settled-timestamp nudge to the `[[SLIDE:]]` rule**

Append to the `[[SLIDE:M:SS|caption]]` trigger line in `buildDigPrompt`:

```
 When you emit one, point the M:SS at the moment the slide is FULLY BUILT and settled (after any build/animation finishes), not when it first appears, so the captured frame is the complete one.
```

- [ ] **Step 5: Run the tests to verify they pass** — `npx jest dig/generate` → PASS (version 5; nudge matches; existing prompt assertions — no-transcribe, code/config triggers, caption constraint, zero-slides — still green).

- [ ] **Step 6: Typecheck + full suite** — `npx tsc --noEmit && npx jest` → tsc exit 0; all green (staleness tests use the imported constant, so 4→5 is transparent).

- [ ] **Step 7: Commit**

```bash
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): nudge settled-frame timestamp + bump DIG_GENERATOR_VERSION 4→5"
```

---

## Self-Review

**Spec coverage:**
- A (prompt nudge): Task 3 ✓
- B scene boundary (0.4) + window cap + endSec bound: Task 2 Step 4 (`captureBestFrame`; `maxWindowSec = min(MAX_WINDOW_SEC, endSec - token.sec)`; `winLen = min(sceneOffset, maxWindowSec)`) ✓
- B sampling (SAMPLE_FPS) + largest selection: Task 2 (`captureBestFrame` + `pickLargestFile`) ✓
- `parseFirstSceneChange`, `pickLargestFile`: Task 1 ✓
- Env-overridable constants: Task 1 Step 3 (`numEnv`) ✓
- Version bump 4→5 + migration: Task 3 ✓
- Preserved failure handling / no-leak: Task 2 Step 5 (catch unchanged) + existing `stripUnresolvedSlideTokens` ✓

**Behaviors:** #1 scene-bounded (Task 2 new test "scene change before MAX bounds the window"); #2 MAX fallback (`catch`/no-match → `maxWindowSec`); #3 endSec bound + #5 tiny window (single-frame fallback test "token at endSec"); #4 largest wins (test asserts size 500 chosen); #6 sampling fails → drop (test "no frames → dropped"); #7 scene-detect fails → MAX (`try/catch`); #8 nudge (Task 3); #9 version (Task 3).

**Adversarial-review fixes folded in:** B1 (`runCapture` explicit `{stdout,stderr}`, never `execFileAsync` `{stderr}`); B2 (migrate 5 existing tests via `mockFfmpegPipeline`, rewrite the call-counting test to count fps passes); H1 (no duplicate `import os`); H2 (`token.sec == endSec` → single-frame fallback, with test); H3 (`minSample = max(0.5, 1/SAMPLE_FPS)` floor + single-frame fallback below it); M2 (parser test for integer `pts_time:1`).

**Placeholder scan:** none. **Type consistency:** `parseFirstSceneChange(string,number):number`, `pickLargestFile(string):string|null`, `runCapture(string,string[]):Promise<{stdout,stderr}>`, `singleFrameCapture(string,number,string):Promise<void>`, `captureBestFrame({clipPath,relStart,maxWindowSec,outPath}):Promise<void>`, `DIG_GENERATOR_VERSION:number` — consistent across tasks.
