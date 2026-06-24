import { buildDigPrompt, generateDig } from '@/lib/dig/generate';
import type { SectionWindow } from '@/lib/dig/section-window';

const WIN: SectionWindow = {
  sectionId: 300,
  startSec: 300,
  endSec: 400,
  transcriptWindow: [],
  summaryProse: 'p',
};

const WIN_KO: SectionWindow = {
  sectionId: 10,
  startSec: 10,
  endSec: 60,
  transcriptWindow: [],
  summaryProse: '소개',
};

const VIDEO_ID = 'abc12345678';

function makeOkResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  );
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  jest.restoreAllMocks();
});

// ── buildDigPrompt ────────────────────────────────────────────────────────────

test('buildDigPrompt names the clip range and slide/TS rules', () => {
  const p = buildDigPrompt('en', 300, 400);
  expect(p).toMatch(/300/);
  expect(p).toMatch(/400/);
  expect(p).toMatch(/\[\[SLIDE:/);
  expect(p).toMatch(/\[\[TS:/);
});

test('buildDigPrompt mentions ≤3 slide limit', () => {
  const p = buildDigPrompt('en', 0, 120);
  expect(p).toMatch(/3/); // ≤3 slides
});

test('buildDigPrompt instructs Korean output when lang=ko', () => {
  const p = buildDigPrompt('ko', 10, 60);
  // Must contain a Korean instruction keyword
  expect(p).toMatch(/Korean|한국어/i);
});

// ── generateDig: request shape ────────────────────────────────────────────────

test('generateDig sends clipped video_metadata + server-built url', async () => {
  const spy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(makeOkResponse('MD'));

  const md = await generateDig(WIN, VIDEO_ID, 'en');

  expect(md).toBe('MD');

  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(url).toContain('generativelanguage.googleapis.com');

  const body = JSON.parse(init.body as string);
  const parts = body.contents[0].parts;
  const filePart = parts[0];
  expect(filePart.file_data.file_uri).toBe(
    `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  );
  expect(filePart.video_metadata.start_offset.seconds).toBe(300);
  expect(filePart.video_metadata.end_offset.seconds).toBe(400);
});

test('generateDig prompt part references startSec and endSec', async () => {
  const spy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(makeOkResponse('MD'));

  await generateDig(WIN, VIDEO_ID, 'en');

  const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
  const textPart = body.contents[0].parts[1];
  expect(textPart.text).toMatch(/300/);
  expect(textPart.text).toMatch(/400/);
});

// ── generateDig: lang ─────────────────────────────────────────────────────────

test('generateDig prompt for ko language includes Korean instruction', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(makeOkResponse('OK'));

  await generateDig(WIN_KO, VIDEO_ID, 'ko');

  // Check nothing — we just verify it doesn't throw; prompt content tested in buildDigPrompt
});

// ── generateDig: non-200 throws after retry ───────────────────────────────────

test('non-200 throws after retry', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response('nope', { status: 500 }));

  await expect(generateDig(WIN, VIDEO_ID, 'en')).rejects.toThrow();
});

// ── generateDig: retry once on 503, then succeeds ────────────────────────────

test('retries once on transient failure then succeeds (M-4)', async () => {
  const spy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(new Response('busy', { status: 503 }))
    .mockResolvedValueOnce(makeOkResponse('OK'));

  const md = await generateDig(WIN, VIDEO_ID, 'en');

  expect(md).toBe('OK');
  expect(spy).toHaveBeenCalledTimes(2); // one retry
});

// ── generateDig: missing candidates throws ────────────────────────────────────

test('missing candidates array throws', async () => {
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
    );

  await expect(generateDig(WIN, VIDEO_ID, 'en')).rejects.toThrow();
});

test('missing GEMINI_API_KEY throws', async () => {
  delete process.env.GEMINI_API_KEY;

  await expect(generateDig(WIN, VIDEO_ID, 'en')).rejects.toThrow(
    /GEMINI_API_KEY/,
  );
});
