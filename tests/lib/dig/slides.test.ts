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
import { resolveSlideTokens, pickLargestFrom } from '@/lib/dig/slides';

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

// ─── Shared ffmpeg-pipeline mock ───────────────────────────────────────────

// Emulates the per-token yt-dlp + ffmpeg pipeline. The scene-detect pass is
// gone; pass '' for the unused sceneStderr arg to preserve call-site clarity.
function mockFfmpegPipeline(sceneStderr = '', frameSizes = [10, 500]) {
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so: string, se: string) => void) => {
      if (cmd === 'yt-dlp') return cb(null, '', '');
      const a = args.join(' ');
      if (a.includes('fps=')) {                                            // window sampling
        const dir = path.dirname(args[args.length - 1]);                   // <dir>/f_%03d.jpg
        frameSizes.forEach((sz, i) =>
          fs.writeFileSync(path.join(dir, `f_${String(i + 1).padStart(3, '0')}.jpg`), Buffer.alloc(sz)));
        return cb(null, '', '');
      }
      return cb(null, '', sceneStderr);
    },
  );
}

// Helper to get the args of the first yt-dlp call.
const ytArgs = () => (mockExecFile.mock.calls.find((c: unknown[]) => c[0] === 'yt-dlp')![1] as string[]);

// ─── Behavior 1: No tokens → no exec, unchanged ────────────────────────────

test('no tokens → no exec called, markdown returned unchanged', async () => {
  const { markdown: out } = await resolveSlideTokens('plain text', getOpts());
  expect(out).toBe('plain text');
  expect(mockExecFile).not.toHaveBeenCalled();
});

test('empty string → no exec called, empty string returned', async () => {
  const { markdown: out } = await resolveSlideTokens('', getOpts());
  expect(out).toBe('');
  expect(mockExecFile).not.toHaveBeenCalled();
});

// ─── Bounded capture window tests (new per-token model) ────────────────────

test('endSec present → window [start, min(end, start+MAX_CAPTURE_SEC)], one call, largest written', async () => {
  mockFfmpegPipeline('', [10, 500, 50]);                       // fps writes 3 frames; 500 is largest
  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:333|341|S]]', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(out).toContain('![S](assets/abc12345678/300-333-341.jpg)');
  expect(mockExecFile.mock.calls.filter((c: unknown[]) => c[0] === 'yt-dlp').length).toBe(1);
  expect(ytArgs().join(' ')).toContain('*333-341');           // min(341, 333+10)=341 — distinct from the other paths
  expect(fs.statSync(path.join(tmpAssetsRoot, 'abc12345678', '300-333-341.jpg')).size).toBe(500);
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
  const { markdown: out } = await resolveSlideTokens('a [[SLIDE:333|339|S]] b', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(out).not.toContain('[[SLIDE:'); expect(out).not.toContain('![');
});

test('security: server-built URL + argv arrays only', async () => {
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('see [[SLIDE:333|339|S]]', { ...getOpts(), startSec: 300, endSec: 400 });
  expect(ytArgs()).toContain('https://www.youtube.com/watch?v=abc12345678');
  mockExecFile.mock.calls.forEach((c: unknown[]) => expect(Array.isArray(c[1])).toBe(true));
});

// ─── Behavior: Happy path → basic token resolution ──────────────────────────

test('happy path rewrites token and calls yt-dlp then ffmpeg with array argv', async () => {
  mockFfmpegPipeline();

  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:352|Loop]]', getOpts());

  expect(out).toContain('![Loop](assets/abc12345678/300-352-356.jpg)');

  const cmds: string[] = mockExecFile.mock.calls.map((c: unknown[]) => c[0] as string);
  expect(cmds).toContain('yt-dlp');
  expect(cmds).toContain('ffmpeg');

  // argv is always an array — never a shell string
  mockExecFile.mock.calls.forEach((call: unknown[]) => {
    expect(Array.isArray(call[1])).toBe(true);
  });
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

test('samples the window and writes the largest frame to the asset path', async () => {
  mockFfmpegPipeline('', [10, 500]);
  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  expect(out).toContain('![Build](assets/abc12345678/300-352-356.jpg)');
  const asset = path.join(tmpAssetsRoot, 'abc12345678', '300-352-356.jpg');
  expect(fs.existsSync(asset)).toBe(true);
  expect(fs.statSync(asset).size).toBe(500); // the largest sampled frame
});

test('sampling produces no frames → token dropped, no leak', async () => {
  mockFfmpegPipeline('', []); // fps writes ZERO frames
  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:352|Build]]', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).not.toContain('![');
});

// ─── Defense-in-depth: never leak a raw [[SLIDE:...]] token ────────────────

test('out-of-range SLIDE token is stripped, never leaked as raw text', async () => {
  // 999 is outside [300,400] → parser drops it → must be stripped, not leaked.
  const { markdown: out } = await resolveSlideTokens('before [[SLIDE:999|x]] after', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).toContain('before');
  expect(out).toContain('after');
  expect(mockExecFile).not.toHaveBeenCalled();
});

test('mixed: valid token resolved to image, stray unresolved token stripped', async () => {
  mockFfmpegPipeline();
  const { markdown: out } = await resolveSlideTokens('a [[SLIDE:352|Good]] b [[SLIDE:999|Bad]] c', getOpts());
  expect(out).toContain('![Good](assets/abc12345678/300-352-356.jpg)');
  expect(out).not.toContain('[[SLIDE:');
});

test('unresolved token whose caption contains "]" is still stripped (I-1)', async () => {
  // Out-of-range, and the caption has a literal ] — the strip must still remove it.
  const { markdown: out } = await resolveSlideTokens('x [[SLIDE:999|array[0] index]] y', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).toContain('x');
  expect(out).toContain('y');
});

test('yt-dlp ENOENT with mixed in-range + out-of-range tokens → neither leaks (m-2)', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) =>
    cb(Object.assign(new Error('not found'), { code: 'ENOENT' })),
  );
  const { markdown: out } = await resolveSlideTokens('a [[SLIDE:352|InRange]] b [[SLIDE:999|OutOfRange]] c', getOpts());
  expect(out).not.toContain('[[SLIDE:');
  expect(out).toContain('a');
  expect(out).toContain('c');
});

// ─── Behavior: Missing binary (ENOENT) → strip tokens, no throw ────────────

test('ENOENT on yt-dlp → strips all tokens, returns text-only, no throw', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) =>
    cb(Object.assign(new Error('enoent'), { code: 'ENOENT' })),
  );

  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:352|Loop]]', getOpts());
  expect(out).toBe('see ');
  // Must not throw — test itself verifies no rejection
});

test('ENOENT on ffmpeg → strips that token, returns text-only, no throw', async () => {
  mockExecFile.mockImplementation((cmd: string, _args: string[], cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    if (cmd === 'yt-dlp') return cb(null, '', '');
    // ffmpeg → ENOENT
    return cb(Object.assign(new Error('enoent'), { code: 'ENOENT' }));
  });

  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:352|Loop]]', getOpts());
  expect(out).toBe('see ');
});

// ─── Behavior: Download gated (yt-dlp exits non-zero) → strip all tokens ───

test('yt-dlp non-zero exit → all tokens stripped, text-only returned', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error) => void) =>
    cb(Object.assign(new Error('exit 1'), { code: 1 })),
  );

  const { markdown: out } = await resolveSlideTokens('intro [[SLIDE:310|A]] body [[SLIDE:350|B]]', getOpts());
  expect(out).toBe('intro  body ');
  // No image markdown
  expect(out).not.toContain('![');
});

// ─── Behavior: One frame fails → drop that token, keep others ──────────────

test('second token fps pass fails → first token kept, second dropped', async () => {
  let fpsCount = 0;
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so?: string, se?: string) => void) => {
      if (cmd === 'yt-dlp') return cb(null, '', '');
      const a = args.join(' ');
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
  const { markdown: out } = await resolveSlideTokens('[[SLIDE:310|A]] [[SLIDE:350|B]]', getOpts());
  expect(out).toContain('![A](assets/abc12345678/300-310-314.jpg)');
  expect(out).not.toContain('![B]');
  expect(out).not.toContain('[[SLIDE:350|B]]');
});

// ─── Behavior: yt-dlp per-token failure isolation ───────────────────────────

test('yt-dlp fails for first token but not second → first stripped, second resolves to image', async () => {
  let ytDlpCount = 0;
  mockExecFile.mockImplementation(
    (cmd: string, args: string[], cb: (e: Error | null, so?: string, se?: string) => void) => {
      if (cmd === 'yt-dlp') {
        ytDlpCount++;
        if (ytDlpCount === 1) {
          // First token (310s) download fails
          return cb(new Error('HTTP 403'));
        }
        // Second token (360s) download succeeds
        return cb(null, '', '');
      }
      // ffmpeg fps sampling — write a frame for the surviving token
      const a = args.join(' ');
      if (a.includes('fps=')) {
        const dir = path.dirname(args[args.length - 1]);
        fs.writeFileSync(path.join(dir, 'f_001.jpg'), Buffer.alloc(200));
        return cb(null, '', '');
      }
      return cb(null, '', '');
    },
  );

  const { markdown: out } = await resolveSlideTokens(
    'a [[SLIDE:310|315|A]] b [[SLIDE:360|365|B]] c',
    { ...getOpts(), startSec: 300, endSec: 400 },
  );

  // First token fails → no image, no raw token leaked
  expect(out).not.toContain('![A]');
  expect(out).not.toContain('[[SLIDE:310');

  // Second token succeeds → resolves to image
  expect(out).toContain('![B](assets/abc12345678/300-360-365.jpg)');
});

// ─── Behavior: Crafted videoId rejected before exec ─────────────────────────

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

// ─── Behavior: argv arrays, never exec/shell strings ────────────────────────

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
  const { markdown: out } = await resolveSlideTokens('see [[SLIDE:352|price $& more]]', getOpts());

  // The alt text in the output should contain the literal $& not the matched token
  expect(out).toContain('![price $& more]');
  expect(out).not.toContain('[[SLIDE:352|price $& more]]');
});

test('L-1: duplicate slide token — both occurrences replaced', async () => {
  mockFfmpegPipeline();

  const markdown = 'First [[SLIDE:352|Loop]] and again [[SLIDE:352|Loop]]';
  const { markdown: out } = await resolveSlideTokens(markdown, getOpts());

  // Both occurrences should be replaced with image refs
  const count = (out.match(/!\[Loop\]/g) ?? []).length;
  expect(count).toBe(2);
  expect(out).not.toContain('[[SLIDE:352|Loop]]');
});

// ─── New tests: trailing-edge selection, pickLargestFrom, new filename, slides metadata ──

test('trailing-edge: selects the largest frame from the trailing TRAIL_SEC, ignoring a larger LEADING frame (the bug)', async () => {
  // window [171,177] (6s) @ fps=2 → 12 frames f_001..f_012. TRAIL_SEC=4 → tailStart=173 → minOrdinal=5.
  // f_001 is the biggest frame overall (the lingering previous slide); the trailing max is f_007.
  const sizes = [9999,1,1,1, 1,1,500,1, 1,1,1,1];
  mockFfmpegPipeline('', sizes);                     // mock writes f_00N for sizes[N-1]
  // getOpts() sectionId=300; token.sec=171; endComponent=177 → filename 300-171-177.jpg
  const { slides } = await resolveSlideTokens('see [[SLIDE:171|177|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  const asset = path.join(tmpAssetsRoot, 'abc12345678', '300-171-177.jpg');
  expect(fs.statSync(asset).size).toBe(500);         // trailing largest chosen, NOT the leading 9999
  expect(slides[0].pickedSec).toBeCloseTo(174);      // 171 + (7-1)/2
});

test('pickLargestFrom skips frames below minOrdinal', () => {
  const d = fs.mkdtempSync(path.join(require('os').tmpdir(), 'po-'));
  fs.writeFileSync(path.join(d, 'f_001.jpg'), Buffer.alloc(999));
  fs.writeFileSync(path.join(d, 'f_005.jpg'), Buffer.alloc(50));
  expect(pickLargestFrom(d, 3)).toBe(path.join(d, 'f_005.jpg')); // f_001 excluded
  fs.rmSync(d, { recursive: true, force: true });
});

test('filename uses sectionId-start-end', async () => {
  mockFfmpegPipeline('', [100]);
  // getOpts() sectionId=300; token.sec=171; token.endSec=181 → filename 300-171-181.jpg
  const { markdown } = await resolveSlideTokens('x [[SLIDE:171|181|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  expect(markdown).toContain('assets/abc12345678/300-171-181.jpg');
});

test('null end → filename uses start + DEFAULT_FWD', async () => {
  mockFfmpegPipeline('', [100]);
  // getOpts() sectionId=300; token.sec=171; endComponent=171+4=175 → filename 300-171-175.jpg
  const { markdown } = await resolveSlideTokens('x [[SLIDE:171|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  expect(markdown).toContain('assets/abc12345678/300-171-175.jpg'); // 171 + DEFAULT_FWD(4)
});

test('returns slides metadata incl. pickedSec', async () => {
  mockFfmpegPipeline('', [10, 100]); // 2 frames; pickedSec computed from chosen ordinal
  const { slides } = await resolveSlideTokens('x [[SLIDE:171|181|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  expect(slides).toHaveLength(1);
  expect(slides[0]).toMatchObject({ startSec: 171, endSec: 181 });
  expect(typeof slides[0].pickedSec).toBe('number');
});
