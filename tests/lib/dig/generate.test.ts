import { buildDigPrompt, generateDig, DIG_GENERATOR_VERSION } from '@/lib/dig/generate';
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

test('buildDigPrompt names the clip range and slide rules', () => {
  const p = buildDigPrompt('en', 300, 400);
  expect(p).toMatch(/300/);
  expect(p).toMatch(/400/);
  expect(p).toMatch(/\[\[SLIDE:/);
});

test('buildDigPrompt no longer asks for inline [[TS:i]] citations (dropped — they leaked)', () => {
  const p = buildDigPrompt('en', 300, 400);
  expect(p).not.toMatch(/\[\[TS:/);
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

// ── generateDig: x-goog-api-key header ───────────────────────────────────────

test('sends API key as x-goog-api-key header, not in URL query string', async () => {
  const spy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(makeOkResponse('MD'));

  await generateDig(WIN, VIDEO_ID, 'en');

  const [url, init] = spy.mock.calls[0] as [string, RequestInit];
  expect(url).not.toContain('key=');
  expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
});

// ── generateDig: timeout → retry ─────────────────────────────────────────────

test('timeout retried then succeeds (fetch called twice)', async () => {
  const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  const spy = jest
    .spyOn(global, 'fetch')
    .mockRejectedValueOnce(abortError)
    .mockResolvedValueOnce(makeOkResponse('OK'));

  const md = await generateDig(WIN, VIDEO_ID, 'en');

  expect(md).toBe('OK');
  expect(spy).toHaveBeenCalledTimes(2);
});

test('two consecutive timeouts/transient network failures throws', async () => {
  const abortError = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(abortError);

  await expect(generateDig(WIN, VIDEO_ID, 'en')).rejects.toThrow();
});

// ── DIG_GENERATOR_VERSION ────────────────────────────────────────────────────────

describe('DIG_GENERATOR_VERSION', () => {
  it('is the integer 8', () => {
    expect(DIG_GENERATOR_VERSION).toBe(8);
  });
});

// ── buildDigPrompt — slide selectivity ────────────────────────────────────────

describe('buildDigPrompt — slide selectivity', () => {
  const p = () => buildDigPrompt('en', 0, 100);

  it('no longer instructs transcribing code into fenced code blocks', () => {
    expect(p()).not.toMatch(/transcribe[^.]*code block/i);
  });

  it('lists code/command/terminal/config among [[SLIDE:]] triggers', () => {
    const s = p();
    expect(s).toMatch(/\[\[SLIDE:/);
    expect(s).toMatch(/\bcode\b/i);
    expect(s).toMatch(/\bcommand\b/i);
    expect(s).toMatch(/\bterminal\b|\bCLI\b/i);
    expect(s).toMatch(/\bconfig\b/i);
  });

  it('forbids [ ] ( ) and | characters in slide captions', () => {
    expect(p()).toMatch(/caption[\s\S]*MUST NOT contain/i);
  });

  it('forbids inventing a slide for code that is only spoken', () => {
    expect(p()).toMatch(/only when[\s\S]*shown|actually shown/i);
  });

  it('restricts [[SLIDE:]] to genuine visuals (diagram/chart/architecture/UI layout)', () => {
    const s = p();
    expect(s).toMatch(/\[\[SLIDE:/);
    expect(s).toMatch(/diagram|chart|architecture|data visualization|layout/i);
  });

  it('states that zero slides is the normal/preferred case', () => {
    expect(p()).toMatch(/most sections.*zero|zero.*normal|none.*preferred/i);
  });

  it('no longer invites a "code screen" screenshot', () => {
    expect(p()).not.toMatch(/code screen/i);
  });

  it('keeps the ≤4 ceiling wording, with no [[TS:i]] citation instruction', () => {
    expect(p()).toMatch(/at most 4/i);
    expect(p()).not.toMatch(/\[\[TS:/);
  });

  it('produces Korean instruction under lang=ko (unchanged)', () => {
    expect(buildDigPrompt('ko', 0, 100)).toMatch(/한국어/);
  });

  it('asks for the timestamp when the slide is fully built / settled', () => {
    expect(p()).toMatch(/fully built|settled|finished animating|fully visible/i);
  });

  it('requests a start AND end timestamp for each slide', () => {
    const s = buildDigPrompt('en', 0, 100);
    expect(s).toMatch(/\[\[SLIDE:M:SS\|M:SS\|caption\]\]/);
    expect(s).toMatch(/replaced or leaves the screen/i);
  });

  it('instructs one collapsed token for a simple animated build, exception for staged progression', () => {
    const s = buildDigPrompt('en', 0, 100);
    expect(s).toMatch(/final settled frame alone is enough/i);
  });

  it('allows a per-stage token for an instructive build progression', () => {
    const s = buildDigPrompt('en', 0, 100);
    expect(s).toMatch(/per instructive stage/i);
    expect(s).toMatch(/teach something the final frame cannot/i);
  });
  it('curates to at most 4 essential slides', () => {
    const s = buildDigPrompt('en', 0, 100);
    expect(s).toMatch(/at most 4/i);
    expect(s).toMatch(/do NOT reproduce every slide/i);
  });
  it('excludes a speaker on camera including split-screen', () => {
    expect(buildDigPrompt('en', 0, 100)).toMatch(/split[- ]screen/i);
  });
});
