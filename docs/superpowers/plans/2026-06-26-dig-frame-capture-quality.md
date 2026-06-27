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
  it('returns the first pts_time from ffmpeg showinfo output', () => {
    const out = '[Parsed_showinfo_1 @ 0x1] n:0 pts:96000 pts_time:3.2 pos:1\n' +
                '[Parsed_showinfo_1 @ 0x1] n:1 pts:210000 pts_time:7.0 pos:2\n';
    expect(parseFirstSceneChange(out, 8)).toBeCloseTo(3.2);
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

- [ ] **Step 3: Add the constants + helpers to `lib/dig/slides.ts`**

Add after the imports (top of module body, before `resolveSlideTokens`):

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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest slides-helpers`
Expected: PASS (7 assertions).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/dig/slides.ts tests/lib/dig/slides-helpers.test.ts
git commit -m "feat(dig): add scene-change parser + largest-file picker + env constants"
```

---

### Task 2: `captureBestFrame` orchestration + wire into `resolveSlideTokens`

**Files:**
- Modify: `lib/dig/slides.ts` (add `captureBestFrame`; replace the single-frame ffmpeg call in `resolveSlideTokens`)
- Test: `tests/lib/dig/slides.test.ts` (extend)

**Interfaces:**
- Consumes: `parseFirstSceneChange`, `pickLargestFile`, `SCENE_THRESHOLD`, `MAX_WINDOW_SEC`, `SAMPLE_FPS` (Task 1); `execFileAsync` (existing module-level promisified `execFile`).
- Produces: `captureBestFrame(opts: { clipPath: string; relStart: number; maxWindowSec: number; outPath: string }): Promise<void>` (module-internal). Resolves after writing the chosen frame to `outPath`; throws if no frame could be produced (caller drops the token).

- [ ] **Step 1: Write the failing tests** (append to `tests/lib/dig/slides.test.ts`)

These reuse the file's existing `mockExecFile` and `getOpts()` (startSec 300, endSec 400, videoId `abc12345678`, sectionId 300). The mock branches on the ffmpeg filter arg: a `select=...scene` call returns scene-detect output via stderr; an `fps=` call writes two frames of different sizes into the output directory (so `pickLargestFile` has files to choose from).

```typescript
// ── captureBestFrame: scene-bounded sampling picks the largest frame ─────────
import os from 'node:os';

// Mock that emulates ffmpeg: scene-detect → stderr with a transition at 3.0s;
// fps extract → writes f_001.jpg (small) and f_002.jpg (large) to the out dir.
function mockFfmpegPipeline(sceneStderr: string) {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so: string, se: string) => void) => {
      if (cmd === 'yt-dlp') return cb(null, '', '');
      const filter = args.join(' ');
      if (filter.includes('scene')) return cb(null, '', sceneStderr);
      if (filter.includes('fps=')) {
        // last arg is the output pattern: <dir>/f_%03d.jpg
        const outPattern = args[args.length - 1];
        const dir = path.dirname(outPattern);
        fs.writeFileSync(path.join(dir, 'f_001.jpg'), Buffer.alloc(10));
        fs.writeFileSync(path.join(dir, 'f_002.jpg'), Buffer.alloc(500)); // largest
        return cb(null, '', '');
      }
      return cb(null, '', '');
    },
  );
}

test('captureBestFrame: samples window and writes the largest frame to the asset path', async () => {
  mockFfmpegPipeline('pts_time:3.0\n');
  const out = await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  // token resolved to an image ref
  expect(out).toContain('![Build](assets/abc12345678/300-352.jpg)');
  // the asset file exists and is the LARGER sampled frame (500 bytes)
  const asset = path.join(tmpAssetsRoot, 'abc12345678', '300-352.jpg');
  expect(fs.existsSync(asset)).toBe(true);
  expect(fs.statSync(asset).size).toBe(500);
});

test('captureBestFrame: scene-detect arg uses the configured threshold and showinfo', async () => {
  mockFfmpegPipeline('pts_time:3.0\n');
  await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  const sceneCall = mockExecFile.mock.calls.find(
    (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).join(' ').includes('scene'),
  );
  expect(sceneCall).toBeDefined();
  const argv = (sceneCall as unknown[])[1] as string[];
  expect(argv.join(' ')).toMatch(/select='gt\(scene,0\.4\)',showinfo/);
});

test('captureBestFrame: no frames produced → token dropped, no leak', async () => {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so: string, se: string) => void) => {
      if (cmd === 'yt-dlp') return cb(null, '', '');
      if (args.join(' ').includes('scene')) return cb(null, '', 'pts_time:3.0\n');
      // fps pass writes NO files
      return cb(null, '', '');
    },
  );
  const out = await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).not.toContain('!['); // nothing resolved
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest dig/slides.test -t captureBestFrame`
Expected: FAIL — `captureBestFrame` not implemented; current single-frame path writes nothing matching these assertions.

- [ ] **Step 3: Add `captureBestFrame` to `lib/dig/slides.ts`**

Add in the Helpers section (below `pickLargestFile`):

```typescript
/**
 * Capture the most-complete frame of the slide at `relStart` (clip-relative
 * seconds). Detects the next slide transition via scene detection to bound a
 * window, samples that window, and writes the largest frame to `outPath`.
 *
 * Throws if no frame could be produced (caller drops the token).
 */
async function captureBestFrame(opts: {
  clipPath: string;
  relStart: number;
  maxWindowSec: number;
  outPath: string;
}): Promise<void> {
  const { clipPath, relStart, maxWindowSec, outPath } = opts;

  // 1. Scene detection → first transition offset (relative to relStart).
  let sceneOffset = maxWindowSec;
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-ss', String(relStart),
      '-t', String(maxWindowSec),
      '-i', clipPath,
      '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-f', 'null', '-',
    ]);
    sceneOffset = parseFirstSceneChange(stderr ?? '', maxWindowSec);
  } catch {
    // Scene detection failed → fall back to the max window (behavior #7).
    sceneOffset = maxWindowSec;
  }

  const winLen = Math.min(sceneOffset, maxWindowSec);

  // 2. Sample the window at SAMPLE_FPS into a temp dir; pick the largest frame.
  const framesDir = fs.mkdtempSync(path.join(path.resolve('.cache'), 'frames-'));
  try {
    await execFileAsync('ffmpeg', [
      '-ss', String(relStart),
      '-t', String(Math.max(winLen, 1 / SAMPLE_FPS)),
      '-i', clipPath,
      '-vf', `fps=${SAMPLE_FPS}`,
      '-q:v', '2',
      path.join(framesDir, 'f_%03d.jpg'),
    ]);
    const best = pickLargestFile(framesDir);
    if (!best) throw new Error('no frames sampled');
    fs.copyFileSync(best, outPath);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Replace the single-frame call in `resolveSlideTokens`**

Find the per-token capture (the `await execFileAsync('ffmpeg', ['-ss', String(token.sec - startSec), '-i', tmpClip, '-frames:v', '1', '-q:v', '2', assetPath])` call) and replace it with:

```typescript
        await captureBestFrame({
          clipPath: tmpClip,
          relStart: token.sec - startSec,
          maxWindowSec: Math.min(MAX_WINDOW_SEC, endSec - token.sec),
          outPath: assetPath,
        });
```

Leave the surrounding lines unchanged: the `imgRef` rewrite on success, and the `catch` that drops the token with `[dig-slide-miss]` and `result.replace(escapedRaw2, '')`.

- [ ] **Step 5: Run the new tests + the full slides suite**

Run: `npx jest dig/slides.test`
Expected: PASS — new captureBestFrame tests green; existing happy-path/failure/security tests still green (the happy-path test asserting a resolved `![](...)` ref still holds; the argv-array security test still holds because all calls remain `execFile` with arrays).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exit 0; all suites pass.

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

Change the version assertion:

```typescript
  it('is the integer 5', () => {
    expect(DIG_GENERATOR_VERSION).toBe(5);
  });
```

Add a prompt-content test in the `describe('buildDigPrompt — slide selectivity', ...)` block:

```typescript
  it('asks for the timestamp when the slide is fully built / settled', () => {
    expect(p()).toMatch(/fully (built|visible)|settled|finished animating/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest dig/generate`
Expected: FAIL — version is 4; the settled-timestamp instruction is absent.

- [ ] **Step 3: Bump the version (`lib/dig/generate.ts:13`)**

```typescript
export const DIG_GENERATOR_VERSION = 5;
```

- [ ] **Step 4: Add the settled-timestamp nudge to the `[[SLIDE:]]` rule**

In `buildDigPrompt`, append this sentence to the `[[SLIDE:M:SS|caption]]` instruction line (the one listing triggers), so the timestamp points at the settled frame:

```
 When you do emit one, point the M:SS at the moment the slide is FULLY BUILT and settled (after any build/animation finishes) — not when it first appears — so the captured frame is the complete one.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest dig/generate`
Expected: PASS — version is 5; settled-timestamp assertion matches; existing prompt assertions (no-transcribe, code/config triggers, caption constraint, zero-slides) still green.

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc exit 0; all suites pass (staleness tests use the imported constant, so 4→5 is transparent).

- [ ] **Step 7: Commit**

```bash
git add lib/dig/generate.ts tests/lib/dig/generate.test.ts
git commit -m "feat(dig): nudge settled-frame timestamp + bump DIG_GENERATOR_VERSION 4→5"
```

---

## Self-Review

**Spec coverage:**
- A (prompt nudge): Task 3 ✓
- B scene boundary (threshold 0.4) + window cap + endSec: Task 2 Step 3 (`captureBestFrame`) ✓
- B sampling (2 fps) + largest selection: Task 2 (`captureBestFrame` + `pickLargestFile`) ✓
- `parseFirstSceneChange`, `pickLargestFile`: Task 1 ✓
- Env-overridable constants: Task 1 Step 3 (`numEnv`) ✓
- Version bump 4→5 + migration: Task 3 ✓
- Preserved failure handling / no-leak: Task 2 Step 4 (catch unchanged) + existing `stripUnresolvedSlideTokens` ✓
- Behaviors 1–3 (window bounds): exercised via `parseFirstSceneChange` (Task 1) + `winLen = min(...)` and `Math.min(MAX_WINDOW_SEC, endSec - token.sec)` (Task 2). Behavior 5 (tiny window): `Math.max(winLen, 1/SAMPLE_FPS)` floor. Behavior 6 (sampling fails → drop): Task 2 Step 1 third test. Behavior 7 (scene-detect fails → MAX): `catch` in `captureBestFrame`.

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `parseFirstSceneChange(string, number): number`, `pickLargestFile(string): string|null`, `captureBestFrame({clipPath,relStart,maxWindowSec,outPath}): Promise<void>`, `DIG_GENERATOR_VERSION: number` used consistently across tasks.
