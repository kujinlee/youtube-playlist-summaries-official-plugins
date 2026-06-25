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

// ─── Behavior 2: Happy path → yt-dlp + ffmpeg with argv arrays ─────────────

test('happy path rewrites token and calls yt-dlp then ffmpeg with array argv', async () => {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

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

test('second ffmpeg call fails → first token kept, second dropped', async () => {
  let ffmpegCallCount = 0;
  mockExecFile.mockImplementation((cmd: string, _args: string[], cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    if (cmd === 'yt-dlp') return cb(null, '', '');
    ffmpegCallCount++;
    if (ffmpegCallCount === 1) return cb(null, '', ''); // first frame OK
    return cb(Object.assign(new Error('exit 1'), { code: 1 })); // second frame fails
  });

  const out = await resolveSlideTokens('[[SLIDE:310|A]] [[SLIDE:350|B]]', getOpts());
  expect(out).toContain('![A](assets/abc12345678/300-310.jpg)');
  expect(out).not.toContain('![B]');
  // Second token is stripped to empty string
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
  // Create a fake asset file so the path containment check passes and ffmpeg "succeeds"
  const assetDir = path.join(tmpAssetsRoot, 'abc12345678');
  fs.mkdirSync(assetDir, { recursive: true });
  const assetFile = path.join(assetDir, '300-352.jpg');
  fs.writeFileSync(assetFile, 'fake-jpeg');

  // Mock execFile: yt-dlp succeeds, ffmpeg succeeds
  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

  // The caption contains $& which would be misinterpreted by String.replace(string, string)
  // as the matched string. The fix uses a RegExp + function replacement to avoid this.
  const out = await resolveSlideTokens('see [[SLIDE:352|price $& more]]', getOpts());

  // The alt text in the output should contain the literal $& not the matched token
  expect(out).toContain('![price $& more]');
  expect(out).not.toContain('[[SLIDE:352|price $& more]]');

  fs.unlinkSync(assetFile);
});

test('L-1: duplicate slide token — both occurrences replaced', async () => {
  const assetDir = path.join(tmpAssetsRoot, 'abc12345678');
  fs.mkdirSync(assetDir, { recursive: true });
  const assetFile = path.join(assetDir, '300-352.jpg');
  fs.writeFileSync(assetFile, 'fake-jpeg');

  mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: null, stdout: string, stderr: string) => void) =>
    cb(null, '', ''),
  );

  const markdown = 'First [[SLIDE:352|Loop]] and again [[SLIDE:352|Loop]]';
  const out = await resolveSlideTokens(markdown, getOpts());

  // Both occurrences should be replaced with image refs
  const count = (out.match(/!\[Loop\]/g) ?? []).length;
  expect(count).toBe(2);
  expect(out).not.toContain('[[SLIDE:352|Loop]]');

  fs.unlinkSync(assetFile);
});
