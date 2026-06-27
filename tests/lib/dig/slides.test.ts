/**
 * Tests for lib/dig/slides.ts — resolveSlideTokens
 *
 * Mocks node:child_process at the module boundary.
 * All exec calls go through execFile only — never exec/shell strings.
 */

jest.mock('node:child_process');

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolveSlideTokens } from '@/lib/dig/slides';

// Helper: make execFile a typed mock.
const mockExecFile = execFile as unknown as jest.Mock;

let tmpAssetsRoot: string;

// Create a unique temp dir per test run; remove it after all tests complete.
beforeAll(() => {
  tmpAssetsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-test-'));
});

afterAll(() => {
  fs.rmSync(tmpAssetsRoot, { recursive: true, force: true });
});

// Rebuild VALID_OPTS using the temp dir so it is always fresh.
const getOpts = () => ({
  videoId: 'abc12345678',
  startSec: 300,
  endSec: 400,
  assetsRoot: tmpAssetsRoot,
  sectionId: 300,
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Behavior 1: No tokens → no exec, unchanged ────────────────────────────

test('no tokens → no exec called, markdown returned unchanged', async () => {
  const out = await resolveSlideTokens('plain text', getOpts());
  expect(out).toBe('plain text');
  expect(mockExecFile).not.toHaveBeenCalled();
});

test('empty string → no exec called, empty string returned', async () => {
  const out = await resolveSlideTokens('', getOpts());
  expect(out).toBe('');
  expect(mockExecFile).not.toHaveBeenCalled();
});

// ─── Shared ffmpeg-pipeline mock ───────────────────────────────────────────

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

// ─── captureBestFrame tests ─────────────────────────────────────────────────

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

test('captureBestFrame: single-frame fallback passes -y so a re-dig overwrites an existing asset (no interactive prompt hang)', async () => {
  mockFfmpegPipeline();
  // token.sec == endSec (400) → single-frame path
  await resolveSlideTokens('see [[SLIDE:400|Edge]]', getOpts());
  const frameArgs = mockExecFile.mock.calls
    .filter((c: unknown[]) => c[0] === 'ffmpeg')
    .map((c: unknown[]) => c[1] as string[])
    .find((a) => a.includes('-frames:v'));
  expect(frameArgs).toBeDefined();
  // Without -y, ffmpeg blocks on "Overwrite? [y/N]" when outPath already exists.
  expect(frameArgs).toContain('-y');
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

// ─── Defense-in-depth: never leak a raw [[SLIDE:...]] token ────────────────

test('out-of-range SLIDE token is stripped, never leaked as raw text', async () => {
  // 999 is outside [300,400] → parser drops it → must be stripped, not leaked.
  const out = await resolveSlideTokens('before [[SLIDE:999|x]] after', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).toContain('before');
  expect(out).toContain('after');
  expect(mockExecFile).not.toHaveBeenCalled();
});

test('mixed: valid token resolved to image, stray unresolved token stripped', async () => {
  mockFfmpegPipeline();
  const out = await resolveSlideTokens('a [[SLIDE:352|Good]] b [[SLIDE:999|Bad]] c', getOpts());
  expect(out).toContain('![Good](assets/abc12345678/300-352.jpg)');
  expect(out).not.toContain('[[SLIDE:');
});

test('unresolved token whose caption contains "]" is still stripped (I-1)', async () => {
  // Out-of-range, and the caption has a literal ] — the strip must still remove it.
  const out = await resolveSlideTokens('x [[SLIDE:999|array[0] index]] y', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).toContain('x');
  expect(out).toContain('y');
});

test('yt-dlp ENOENT with mixed in-range + out-of-range tokens → neither leaks (m-2)', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) =>
    cb(Object.assign(new Error('not found'), { code: 'ENOENT' })),
  );
  const out = await resolveSlideTokens('a [[SLIDE:352|InRange]] b [[SLIDE:999|OutOfRange]] c', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).toContain('a');
  expect(out).toContain('c');
});

// ─── Behavior 2: Happy path → yt-dlp + ffmpeg with argv arrays ─────────────

test('happy path rewrites token and calls yt-dlp then ffmpeg with array argv', async () => {
  mockFfmpegPipeline();

  const out = await resolveSlideTokens('see [[SLIDE:352|Loop]]', getOpts());

  expect(out).toContain('![Loop](assets/abc12345678/300-352.jpg)');

  const cmds: string[] = mockExecFile.mock.calls.map((c: unknown[]) => c[0] as string);
  expect(cmds).toContain('yt-dlp');
  expect(cmds).toContain('ffmpeg');

  // argv is always an array — never a shell string
  mockExecFile.mock.calls.forEach((call: unknown[]) => {
    expect(Array.isArray(call[1])).toBe(true);
  });
});

test('happy path yt-dlp argv contains --download-sections with correct range', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

  await resolveSlideTokens('[[SLIDE:352|x]]', getOpts());

  const ytDlpCall = mockExecFile.mock.calls.find((c: unknown[]) => c[0] === 'yt-dlp') as unknown[] | undefined;
  expect(ytDlpCall).toBeDefined();
  const args = ytDlpCall![1] as string[];
  const sectionIdx = args.indexOf('--download-sections');
  expect(sectionIdx).not.toBe(-1);
  // Range should cover startSec–endSec
  expect(args[sectionIdx + 1]).toContain('300');
  expect(args[sectionIdx + 1]).toContain('400');
});

test('happy path ffmpeg -ss is relative offset (sec - startSec)', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

  // sec=352, startSec=300 → offset=52
  await resolveSlideTokens('[[SLIDE:352|x]]', getOpts());

  const ffmpegCall = mockExecFile.mock.calls.find((c: unknown[]) => c[0] === 'ffmpeg') as unknown[] | undefined;
  expect(ffmpegCall).toBeDefined();
  const args = ffmpegCall![1] as string[];
  const ssIdx = args.indexOf('-ss');
  expect(ssIdx).not.toBe(-1);
  expect(args[ssIdx + 1]).toBe('52');
});

test('happy path youtubeUrl is server-built from videoId', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

  await resolveSlideTokens('[[SLIDE:352|x]]', getOpts());

  const ytDlpCall = mockExecFile.mock.calls.find((c: unknown[]) => c[0] === 'yt-dlp') as unknown[] | undefined;
  const args = ytDlpCall![1] as string[];
  expect(args).toContain('https://www.youtube.com/watch?v=abc12345678');
});

// ─── Behavior 3: Missing binary (ENOENT) → strip tokens, no throw ──────────

test('ENOENT on yt-dlp → strips all tokens, returns text-only, no throw', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) =>
    cb(Object.assign(new Error('enoent'), { code: 'ENOENT' })),
  );

  const out = await resolveSlideTokens('see [[SLIDE:352|Loop]]', getOpts());
  expect(out).toBe('see ');
  // Must not throw — test itself verifies no rejection
});

test('ENOENT on ffmpeg → strips that token, returns text-only, no throw', async () => {
  let callCount = 0;
  mockExecFile.mockImplementation((cmd: string, _args: string[], cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    callCount++;
    if (cmd === 'yt-dlp') return cb(null, '', '');
    // ffmpeg → ENOENT
    return cb(Object.assign(new Error('enoent'), { code: 'ENOENT' }));
  });

  const out = await resolveSlideTokens('see [[SLIDE:352|Loop]]', getOpts());
  expect(out).toBe('see ');
});

// ─── Behavior 4: Download gated (yt-dlp exits non-zero) → strip all tokens ──

test('yt-dlp non-zero exit → all tokens stripped, text-only returned', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) =>
    cb(Object.assign(new Error('exit 1'), { code: 1 })),
  );

  const out = await resolveSlideTokens('intro [[SLIDE:310|A]] body [[SLIDE:350|B]]', getOpts());
  expect(out).toBe('intro  body ');
  // No image markdown
  expect(out).not.toContain('![');
});

// ─── Behavior 5: One frame fails → drop that token, keep others ─────────────

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

// ─── Behavior 6: Crafted videoId rejected before exec ───────────────────────

test('videoId with / rejected before exec', async () => {
  await expect(
    resolveSlideTokens('[[SLIDE:352|x]]', { ...getOpts(), videoId: '../etc' }),
  ).rejects.toThrow();
  expect(mockExecFile).not.toHaveBeenCalled();
});

test('videoId with .. rejected before exec', async () => {
  await expect(
    resolveSlideTokens('[[SLIDE:352|x]]', { ...getOpts(), videoId: '../../secret' }),
  ).rejects.toThrow();
  expect(mockExecFile).not.toHaveBeenCalled();
});

test('empty videoId rejected before exec', async () => {
  await expect(
    resolveSlideTokens('[[SLIDE:352|x]]', { ...getOpts(), videoId: '' }),
  ).rejects.toThrow();
  expect(mockExecFile).not.toHaveBeenCalled();
});

// ─── Behavior 7: argv arrays, never exec/shell strings ──────────────────────

test('execFile is always called with array argv — never a string command', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

  await resolveSlideTokens('[[SLIDE:310|X]] [[SLIDE:350|Y]]', getOpts());

  expect(mockExecFile).toHaveBeenCalled();
  mockExecFile.mock.calls.forEach((call: unknown[]) => {
    // First arg is the binary name (string), second is argv array
    expect(typeof call[0]).toBe('string');
    expect(Array.isArray(call[1])).toBe(true);
    // The binary name must not contain shell metacharacters (e.g. semicolons, pipes)
    expect(call[0] as string).not.toMatch(/[;&|`$]/);
  });
});

// ─── L-1: $ in imgRef not misinterpreted; duplicate tokens both replaced ────

test('L-1: imgRef containing $& is not misinterpreted (literal $ preserved)', async () => {
  mockFfmpegPipeline();

  // The caption contains $& which would be misinterpreted by String.replace(string, string)
  // as the matched string. The fix uses a RegExp + function replacement to avoid this.
  const out = await resolveSlideTokens('see [[SLIDE:352|price $& more]]', getOpts());

  // The alt text in the output should contain the literal $& not the matched token
  expect(out).toContain('![price $& more]');
  expect(out).not.toContain('[[SLIDE:352|price $& more]]');
});

test('L-1: duplicate slide token — both occurrences replaced', async () => {
  mockFfmpegPipeline();

  const markdown = 'First [[SLIDE:352|Loop]] and again [[SLIDE:352|Loop]]';
  const out = await resolveSlideTokens(markdown, getOpts());

  // Both occurrences should be replaced with image refs
  const count = (out.match(/!\[Loop\]/g) ?? []).length;
  expect(count).toBe(2);
  expect(out).not.toContain('[[SLIDE:352|Loop]]');
});
