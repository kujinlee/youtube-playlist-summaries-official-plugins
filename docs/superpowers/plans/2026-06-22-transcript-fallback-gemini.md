# Gemini Transcript Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When YouTube serves no caption track, obtain a timestamped transcript by sending the YouTube URL to Gemini at low media resolution, so gated videos still get summarized.

**Architecture:** A new cascade unit `resolveTranscriptSegments` tries captions first (`fetchTranscriptSegments`), and on throw/empty falls back to a new `transcribeViaGemini` call that asks Gemini for a full timestamped transcript and maps it into the existing `TranscriptSegment[]`. `writeSummaryDoc` consumes the resolver instead of captions directly. Everything downstream (`generateSummary`, `[[TS:i]]` → ▶ resolution, `.md` format) is unchanged.

**Tech Stack:** TypeScript, `@google/generative-ai` 0.24.1, Zod, Jest (ts-jest/SWC).

## Global Constraints

- **SDK:** `@google/generative-ai` 0.24.1. `mediaResolution` is NOT in the SDK's `GenerationConfig` type but IS honored at runtime — it MUST ride **inside** `generationConfig` (the SDK spreads `generationConfig` into the request body; a top-level field is dropped), cast with `as GenerationConfig` and a `// eslint`/explanatory comment. A single `as` cast compiles (TS runs no excess-property check on `as`).
- **Model:** `TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-2.5-flash'`.
- **Media resolution:** always `'MEDIA_RESOLUTION_LOW'` (downsamples video frames only; audio unaffected; ~700k→~256k tokens on a ~45-min video).
- **Logging:** `console.warn` only (no dev-logger — it has no warn API). Retry line `[gemini-retry] transcribe <videoId>: …`; coverage line `[transcribe-coverage] low coverage <pct>% for <videoId>`.
- **`TranscriptSegment` shape:** `{ text: string; offset: number /*sec*/; duration: number /*sec*/ }`. Resolved offsets must be **strictly increasing** — map step MUST sort by `startSec` and dedupe equal `startSec` (keep first), else `resolveTranscriptTokens` (`lib/transcript-timestamps.ts:79-89`) drops ALL ▶ links in that doc.
- **Cost discipline:** Gemini is called ONLY when captions are unavailable. The captioned-video path makes no extra call.
- **Gate:** `npx tsc --noEmit` clean AND full `npm test` green before each commit. Dual review per task (Claude + adversarial).
- **Out of scope:** deep-dive changes, yt-dlp/Whisper, marking the `.md` as Gemini-sourced (resolver returns `source` for logging only).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/gemini.ts` | Add `transcribeViaGemini` + internal segment mapping + coverage warn | Modify |
| `lib/transcript-source.ts` | `resolveTranscriptSegments` cascade (captions → Gemini) | Create |
| `lib/pipeline.ts` | `writeSummaryDoc` consumes resolver instead of `fetchTranscriptSegments` | Modify |
| `tests/lib/gemini.test.ts` | Tests for `transcribeViaGemini` (named `getGenerativeModel` mock) | Modify |
| `tests/lib/transcript-source.test.ts` | Cascade tests | Create |
| `tests/lib/pipeline.test.ts` | Gated-path integration test | Modify |

---

## Task 1: `transcribeViaGemini` in `lib/gemini.ts`

**Files:**
- Modify: `lib/gemini.ts` (imports line 1-2; add new exports after `generateDeepDiveCombined`, ~line 403)
- Test: `tests/lib/gemini.test.ts` (mock setup lines 15-24; add a new `describe('transcribeViaGemini')` block)

**Interfaces:**
- Consumes: `getApiKey()`, `REQUEST_TIMEOUT_MS`, `GoogleGenerativeAI`, `SchemaType`, `ResponseSchema`, `z`, `TranscriptSegment` (all already in `lib/gemini.ts`).
- Produces: `export async function transcribeViaGemini(youtubeUrl: string, videoId: string, durationSeconds: number, retries?: number, baseDelayMs?: number): Promise<TranscriptSegment[]>` — Task 2 calls this.

- [ ] **Step 1: Refactor the test mock to a named `getGenerativeModel` (no behavior change)**

In `tests/lib/gemini.test.ts`, add a module-level named mock and use it in `beforeEach` so a test can later inspect the model-creation config. Replace the inline mock (lines ~15-24):

```ts
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent });
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});
```

Run: `npx jest tests/lib/gemini.test.ts`
Expected: PASS (all existing tests still green — `jest.clearAllMocks()` clears `.mock.calls` but not the `mockReturnValue` implementation we re-set each `beforeEach`).

- [ ] **Step 2: Write the failing test — config + fileData wiring**

Add at the end of `tests/lib/gemini.test.ts`. First add the import for the new function to the existing top import:

```ts
import { generateDeepDive, generateSummary, extractQuickView, fixSummary, transcribeViaGemini } from '../../lib/gemini';
```

Then the describe block:

```ts
describe('transcribeViaGemini', () => {
  const URL = 'https://www.youtube.com/watch?v=vidGated';

  function mockTranscriptResponse(segments: Array<{ startSec: number; text: string }>) {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ segments }) },
    });
  }

  it('sends the YouTube URL as fileData and requests low media resolution', async () => {
    mockTranscriptResponse([{ startSec: 0, text: 'hello world' }]);

    await transcribeViaGemini(URL, 'vidGated', 600);

    const config = mockGetGenerativeModel.mock.calls[0][0] as {
      model: string;
      generationConfig: { responseMimeType: string; mediaResolution: string };
    };
    expect(config.generationConfig.responseMimeType).toBe('application/json');
    expect(config.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_LOW');

    const request = mockGenerateContent.mock.calls[0][0] as {
      contents: Array<{ parts: Array<{ fileData?: { fileUri: string; mimeType: string }; text?: string }> }>;
    };
    expect(request.contents[0].parts[0].fileData).toEqual({ fileUri: URL, mimeType: 'video/mp4' });
    expect(request.contents[0].parts[1].text).toMatch(/entire video/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/lib/gemini.test.ts -t transcribeViaGemini`
Expected: FAIL — `transcribeViaGemini is not a function` (not yet exported).

- [ ] **Step 4: Implement `transcribeViaGemini` + mapping + coverage**

In `lib/gemini.ts`, extend the type import on line 2:

```ts
import type { GenerativeModel, ResponseSchema, GenerationConfig } from '@google/generative-ai';
```

Add a model constant near line 12:

```ts
const TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-2.5-flash';
```

Add the schema, Zod validator, prompt, mapping helper, and function after `generateDeepDiveCombined` (~line 403):

```ts
// Controlled-generation schema: structurally constrains Gemini's transcript JSON. The OpenAPI subset
// can't enforce non-empty text or finite startSec, so the Zod schema + post-parse cleanup below are the
// real guarantor (see mapGeminiTranscriptSegments).
const TRANSCRIBE_RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    segments: {
      type: SchemaType.ARRAY,
      minItems: 1,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          startSec: { type: SchemaType.INTEGER },
          text: { type: SchemaType.STRING },
        },
        required: ['startSec', 'text'],
      },
    },
  },
  required: ['segments'],
};

const GeminiTranscriptSchema = z.object({
  segments: z.array(z.object({ startSec: z.number(), text: z.string() })),
});

const TRANSCRIBE_PROMPT =
  'Transcribe this entire video from start to finish. Return JSON {"segments":[…]} where each segment ' +
  'is ~1–3 sentences of spoken words with "startSec" = the integer second it begins. Segments MUST be ' +
  'in increasing time order and MUST cover the whole video, continuing all the way to the end — do not ' +
  'stop early or summarize. Use only words actually spoken.';

/**
 * Clean + map Gemini's raw {startSec,text} rows into TranscriptSegment[]:
 * drop empty-text / non-finite-startSec rows, sort by startSec, DEDUPE equal startSec (keep first —
 * resolveTranscriptTokens requires strictly increasing offsets), then offset=startSec and
 * duration=gap-to-next (last segment uses a nominal 5s).
 */
function mapGeminiTranscriptSegments(raw: Array<{ startSec: number; text: string }>): TranscriptSegment[] {
  const cleaned = raw
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0 && Number.isFinite(s.startSec))
    .sort((a, b) => a.startSec - b.startSec);
  const deduped: Array<{ startSec: number; text: string }> = [];
  for (const s of cleaned) {
    if (deduped.length === 0 || s.startSec !== deduped[deduped.length - 1].startSec) deduped.push(s);
  }
  return deduped.map((s, i) => ({
    text: s.text,
    offset: s.startSec,
    duration: i < deduped.length - 1 ? Math.max(0, deduped[i + 1].startSec - s.startSec) : 5,
  }));
}

/**
 * Fallback transcript source: ask Gemini to transcribe the video from its URL at LOW media resolution,
 * returning a timestamped transcript mapped to TranscriptSegment[]. Used only when YouTube serves no
 * captions. Retries on malformed JSON / schema / transient errors; throws after retries exhaust.
 */
export async function transcribeViaGemini(
  youtubeUrl: string,
  videoId: string,
  durationSeconds: number,
  retries = 2,
  baseDelayMs = 400,
): Promise<TranscriptSegment[]> {
  const client = new GoogleGenerativeAI(getApiKey());
  const model = client.getGenerativeModel({
    model: TRANSCRIBE_MODEL,
    // mediaResolution is honored by the API but absent from the 0.24.1 SDK type. It MUST stay inside
    // generationConfig (the SDK spreads generationConfig into the request body; a top-level field is
    // dropped). LOW downsamples video frames only — audio is unaffected — cutting ~700k→~256k tokens.
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: TRANSCRIBE_RESPONSE_SCHEMA,
      mediaResolution: 'MEDIA_RESOLUTION_LOW',
    } as GenerationConfig,
  });
  const request = {
    contents: [{
      role: 'user',
      parts: [
        { fileData: { fileUri: youtubeUrl, mimeType: 'video/mp4' } },
        { text: TRANSCRIBE_PROMPT },
      ],
    }],
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await model.generateContent(request, { timeout: REQUEST_TIMEOUT_MS });
      const parsed = GeminiTranscriptSchema.parse(JSON.parse(result.response.text()));
      const segments = mapGeminiTranscriptSegments(parsed.segments);
      if (segments.length === 0) throw new Error('Gemini returned zero usable transcript segments');
      const lastOffset = segments[segments.length - 1].offset;
      if (durationSeconds > 0 && lastOffset / durationSeconds < 0.6) {
        const pct = Math.round((lastOffset / durationSeconds) * 100);
        console.warn(`[transcribe-coverage] low coverage ${pct}% for ${videoId}`);
      }
      return segments;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`[gemini-retry] transcribe ${videoId}: attempt ${attempt + 1} failed (${err instanceof Error ? err.message : String(err)}); retrying…`);
        if (baseDelayMs > 0) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      }
    }
  }
  const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Gemini transcription failed for ${videoId}: ${cause}`, { cause: lastErr });
}
```

- [ ] **Step 5: Run the config test to verify it passes**

Run: `npx jest tests/lib/gemini.test.ts -t transcribeViaGemini`
Expected: PASS.

- [ ] **Step 6: Write the failing mapping test (sort, dedupe, duration, drop-empty)**

Add inside `describe('transcribeViaGemini')`:

```ts
it('maps to TranscriptSegment[] — sorted, deduped, gap durations, drops empties', async () => {
  mockTranscriptResponse([
    { startSec: 10, text: 'second' },
    { startSec: 0, text: 'first' },
    { startSec: 10, text: 'dup-dropped' },   // equal startSec → dropped (keep first after sort)
    { startSec: 20, text: '   ' },            // empty after trim → dropped
    { startSec: 30, text: 'last' },
  ]);

  const segs = await transcribeViaGemini(URL, 'vidGated', 600);

  expect(segs).toEqual([
    { text: 'first', offset: 0, duration: 10 },
    { text: 'second', offset: 10, duration: 20 },
    { text: 'last', offset: 30, duration: 5 },
  ]);
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx jest tests/lib/gemini.test.ts -t transcribeViaGemini`
Expected: PASS (implementation from Step 4 already covers it).

- [ ] **Step 8: Write the failing coverage + error tests**

Add inside `describe('transcribeViaGemini')`:

```ts
it('warns on low coverage but still returns the partial transcript', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockTranscriptResponse([{ startSec: 0, text: 'a' }, { startSec: 30, text: 'b' }]); // lastOffset 30 / 600 = 5%

  const segs = await transcribeViaGemini(URL, 'vidGated', 600);

  expect(segs).toHaveLength(2);
  expect(warn).toHaveBeenCalledWith('[transcribe-coverage] low coverage 5% for vidGated');
  warn.mockRestore();
});

it('throws after retries when Gemini yields zero usable segments', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ segments: [] }) } });

  await expect(transcribeViaGemini(URL, 'vidGated', 600, 1, 0)).rejects.toThrow(/Gemini transcription failed for vidGated/);
});

it('throws after retries on invalid JSON', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockGenerateContent.mockResolvedValue({ response: { text: () => 'not json' } });

  await expect(transcribeViaGemini(URL, 'vidGated', 600, 1, 0)).rejects.toThrow(/Gemini transcription failed for vidGated/);
});

it('does not warn or divide by zero when durationSeconds is 0', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockTranscriptResponse([{ startSec: 0, text: 'a' }, { startSec: 30, text: 'b' }]);

  const segs = await transcribeViaGemini(URL, 'vidGated', 0);

  expect(segs).toHaveLength(2);
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[transcribe-coverage]'));
  warn.mockRestore();
});

it('drops an empty-text row even when it shares a startSec with a non-empty row', async () => {
  mockTranscriptResponse([
    { startSec: 40, text: '   ' },   // empty; would sort first among the equal-startSec pair
    { startSec: 40, text: 'kept' },
  ]);

  const segs = await transcribeViaGemini(URL, 'vidGated', 100);

  // filter (drop-empty) precedes sort+dedupe, so the empty row is gone before dedupe runs.
  expect(segs).toEqual([{ text: 'kept', offset: 40, duration: 5 }]);
});
```

- [ ] **Step 9: Run to verify all transcribe tests pass**

Run: `npx jest tests/lib/gemini.test.ts -t transcribeViaGemini`
Expected: PASS (7 tests).

- [ ] **Step 10: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests green.

- [ ] **Step 11: Commit**

```bash
git add lib/gemini.ts tests/lib/gemini.test.ts
git commit -m "feat(transcript): add transcribeViaGemini URL→low-res transcript fallback"
```

---

## Task 2: `resolveTranscriptSegments` cascade in `lib/transcript-source.ts`

**Files:**
- Create: `lib/transcript-source.ts`
- Test: `tests/lib/transcript-source.test.ts`

**Interfaces:**
- Consumes: `fetchTranscriptSegments(videoId): Promise<TranscriptSegment[]>` from `./youtube`; `transcribeViaGemini(youtubeUrl, videoId, durationSeconds): Promise<TranscriptSegment[]>` from `./gemini` (Task 1).
- Produces: `export async function resolveTranscriptSegments(videoId: string, youtubeUrl: string, durationSeconds: number): Promise<{ segments: TranscriptSegment[]; source: 'captions' | 'gemini' }>` — Task 3 calls this.

- [ ] **Step 1: Write the failing cascade tests**

Create `tests/lib/transcript-source.test.ts`:

```ts
jest.mock('../../lib/youtube');
jest.mock('../../lib/gemini');

import { resolveTranscriptSegments } from '../../lib/transcript-source';
import * as youtube from '../../lib/youtube';
import * as gemini from '../../lib/gemini';
import type { TranscriptSegment } from '../../lib/transcript-timestamps';

const mockFetchCaptions = jest.mocked(youtube.fetchTranscriptSegments);
const mockTranscribe = jest.mocked(gemini.transcribeViaGemini);

const CAPTIONS: TranscriptSegment[] = [{ text: 'caption', offset: 0, duration: 5 }];
const GEMINI: TranscriptSegment[] = [{ text: 'gemini', offset: 0, duration: 5 }];
const URL = 'https://www.youtube.com/watch?v=vid1';

beforeEach(() => jest.clearAllMocks());

it('returns captions and never calls Gemini when captions succeed', async () => {
  mockFetchCaptions.mockResolvedValueOnce(CAPTIONS);

  const result = await resolveTranscriptSegments('vid1', URL, 600);

  expect(result).toEqual({ segments: CAPTIONS, source: 'captions' });
  expect(mockTranscribe).not.toHaveBeenCalled();
});

it('falls back to Gemini when captions throw', async () => {
  mockFetchCaptions.mockRejectedValueOnce(new Error('Transcript is disabled on this video'));
  mockTranscribe.mockResolvedValueOnce(GEMINI);

  const result = await resolveTranscriptSegments('vid1', URL, 600);

  expect(result).toEqual({ segments: GEMINI, source: 'gemini' });
  expect(mockTranscribe).toHaveBeenCalledWith(URL, 'vid1', 600);
});

it('falls back to Gemini when captions return an empty array', async () => {
  mockFetchCaptions.mockResolvedValueOnce([]);
  mockTranscribe.mockResolvedValueOnce(GEMINI);

  const result = await resolveTranscriptSegments('vid1', URL, 600);

  expect(result).toEqual({ segments: GEMINI, source: 'gemini' });
});

it('throws with videoId + captured caption cause when both sources fail', async () => {
  mockFetchCaptions.mockRejectedValueOnce(new Error('Transcript is disabled on this video'));
  mockTranscribe.mockRejectedValueOnce(new Error('Gemini fetch blocked'));

  await expect(resolveTranscriptSegments('vid1', URL, 600)).rejects.toThrow(
    /transcript unavailable via captions and video for vid1/,
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/transcript-source.test.ts`
Expected: FAIL — cannot find module `../../lib/transcript-source`.

- [ ] **Step 3: Implement the cascade**

Create `lib/transcript-source.ts`:

```ts
import { fetchTranscriptSegments } from './youtube';
import { transcribeViaGemini } from './gemini';
import type { TranscriptSegment } from './transcript-timestamps';

/**
 * Resolve a video's transcript: try YouTube captions first; if they throw or come back empty, fall
 * back to transcribing the video via Gemini (URL → low-res). Throws only when BOTH fail, including the
 * captured caption error as the cause so the gated-caption case stays diagnosable.
 */
export async function resolveTranscriptSegments(
  videoId: string,
  youtubeUrl: string,
  durationSeconds: number,
): Promise<{ segments: TranscriptSegment[]; source: 'captions' | 'gemini' }> {
  let captionErr: unknown;
  try {
    const segments = await fetchTranscriptSegments(videoId);
    if (segments.length) return { segments, source: 'captions' };
  } catch (e) {
    captionErr = e;
  }

  try {
    const segments = await transcribeViaGemini(youtubeUrl, videoId, durationSeconds);
    if (segments.length) return { segments, source: 'gemini' };
    throw new Error('Gemini returned no segments');
  } catch (geminiErr) {
    const captionMsg = captionErr instanceof Error ? captionErr.message : String(captionErr ?? 'captions empty');
    const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
    throw new Error(
      `transcript unavailable via captions and video for ${videoId}: captions: ${captionMsg}; video: ${geminiMsg}`,
      { cause: captionErr ?? geminiErr },
    );
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/lib/transcript-source.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/transcript-source.ts tests/lib/transcript-source.test.ts
git commit -m "feat(transcript): add resolveTranscriptSegments captions→Gemini cascade"
```

---

## Task 3: Integrate the resolver into `writeSummaryDoc`

**Files:**
- Modify: `lib/pipeline.ts` (import line 3; `writeSummaryDoc` body line 43)
- Test: `tests/lib/pipeline.test.ts` (mock declarations ~line 22; add a gated-path test)

**Interfaces:**
- Consumes: `resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds)` from `./transcript-source` (Task 2). `youtubeUrl` and `durationSeconds` are already destructured from `input` in `writeSummaryDoc` (`pipeline.ts:42`).
- Produces: no signature change to `writeSummaryDoc`.

- [ ] **Step 1: Write the failing gated-path integration test**

In `tests/lib/pipeline.test.ts`, add a mocked handle for `transcribeViaGemini` next to the existing gemini mocks (~line 22). `gemini` is already `jest.mock`'d, so this just types the auto-mock:

```ts
const mockTranscribeViaGemini = jest.mocked(gemini.transcribeViaGemini);
```

Add this test **inside the existing `describe('writeSummaryDoc')` block** (`tests/lib/pipeline.test.ts:1027`) — that block already provides the `outputFolder` fixture (`beforeEach` creates it, `afterEach` removes it AND calls `jest.clearAllMocks()`, which clears the `…Once` queue so nothing leaks). `transcript-source` is intentionally NOT mocked — the real resolver delegates to the already-mocked `youtube` and `gemini`:

```ts
it('falls back to Gemini transcription when captions are unavailable', async () => {
  mockFetchTranscriptSegments.mockRejectedValueOnce(new Error('Transcript is disabled on this video'));
  mockTranscribeViaGemini.mockResolvedValueOnce([{ text: 'gemini transcript', offset: 0, duration: 5 }]);
  mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ summary: 'From Gemini fallback' }));

  await writeSummaryDoc({
    videoId: 'vidGated11',
    title: 'Gated Video',
    youtubeUrl: 'https://youtube.com/watch?v=vidGated',
    durationSeconds: 300,
    outputFolder,            // from the describe('writeSummaryDoc') beforeEach fixture
    baseName: 'gated-video',
  });

  expect(mockTranscribeViaGemini).toHaveBeenCalledWith('https://youtube.com/watch?v=vidGated', 'vidGated11', 300);
  expect(mockGenerateSummary).toHaveBeenCalled();
  const md = fsReal.readFileSync(`${outputFolder}/gated-video.md`, 'utf-8');
  expect(md).toContain('From Gemini fallback');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/pipeline.test.ts -t "falls back to Gemini"`
Expected: FAIL — `writeSummaryDoc` still calls `fetchTranscriptSegments` directly, which is mocked to reject, so the call throws instead of producing a doc.

- [ ] **Step 3: Swap `writeSummaryDoc` to the resolver**

In `lib/pipeline.ts`, change the import on line 3 — drop `fetchTranscriptSegments` (no longer used directly) and keep the rest:

```ts
import { fetchPlaylistVideos, detectLanguage } from './youtube';
```

Add the resolver import after it:

```ts
import { resolveTranscriptSegments } from './transcript-source';
```

Replace line 43 inside `writeSummaryDoc`:

```ts
  const { segments } = await resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds);
```

(The following line — `const transcript = segments.map((s) => s.text).join(' ');` — and everything else is unchanged.)

- [ ] **Step 4: Run the gated-path test to verify it passes**

Run: `npx jest tests/lib/pipeline.test.ts -t "falls back to Gemini"`
Expected: PASS.

- [ ] **Step 5: Fix the coincidental regression test, then run the whole pipeline suite**

One existing test — `describe('runIngestion')` → `it('continues to next video when one video fails')` (`tests/lib/pipeline.test.ts:113`) — mocks `fetchTranscriptSegments.mockRejectedValueOnce` for vid1. After this task, `writeSummaryDoc` calls the **real** resolver, which catches that rejection and falls through to the auto-mocked `transcribeViaGemini` (returns `undefined` by default → `if (segments.length)` on `undefined` → TypeError → re-thrown). The test would still pass, but **by accident** — a future change to the gemini mock could silently break it. Make the cascade failure explicit by adding one line to that test, right after the `mockFetchTranscriptSegments` setup (lines 115-117):

```ts
    mockFetchTranscriptSegments
      .mockRejectedValueOnce(new Error('No transcript available'))
      .mockResolvedValueOnce([{ text: 'transcript', offset: 0, duration: 5 }]);
    mockTranscribeViaGemini.mockRejectedValue(new Error('Gemini unavailable')); // vid1: both sources fail → error; vid2 uses captions so Gemini is never reached
```

(vid2's captions resolve via the second `…Once`, so the resolver returns before calling Gemini — the persistent reject is inert for vid2.)

Run: `npx jest tests/lib/pipeline.test.ts`
Expected: PASS — the failing-video test now explicitly exercises the cascade; all other ingestion tests still green (the real resolver delegates to `mockFetchTranscriptSegments` for the captions path, never reaching Gemini).

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests green.

- [ ] **Step 7: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "feat(transcript): writeSummaryDoc uses caption→Gemini resolver"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- `transcribeViaGemini` (URL→low-res, controlled generation, mediaResolution, Zod+retry, map, coverage warn) → Task 1 ✓
- `resolveTranscriptSegments` cascade (captions→Gemini→throw-with-cause; empty-array fall-through) → Task 2 ✓
- `writeSummaryDoc` integration (resolver + unchanged downstream) → Task 3 ✓
- B1 (don't reuse `generateJson`; call `generateContent` directly) → Task 1 Step 4 ✓
- H2 (`durationSeconds` plumbed) → Tasks 1-3 signatures ✓
- H3 (`console.warn`, no dev-logger) → Global Constraints + Task 1 ✓
- H4 (mediaResolution inside generationConfig; hoisted named `getGenerativeModel` mock) → Task 1 Steps 1-2 ✓
- M5 (Zod + drop-empty/non-finite) → Task 1 `mapGeminiTranscriptSegments` ✓
- M6 (capture caption error in combined message) → Task 2 ✓
- M7 (dedupe equal `startSec`) → Task 1 `mapGeminiTranscriptSegments` + test Step 6 ✓
- M8 (token bound) → covered by spec analysis; coarse segments shrink downstream input, no new task needed ✓

**Placeholder scan:** none — all steps carry exact code/commands.

**Type consistency:** `transcribeViaGemini(youtubeUrl, videoId, durationSeconds)` and `resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds)` argument orders are used identically in their definitions, callers, and tests. `TranscriptSegment` shape consistent throughout.

## Adversarial review resolutions (applied 2026-06-22)

Review: `docs/reviews/plan-transcript-fallback-gemini-review.md` (Claude stood in for usage-limited Codex). Verdict was `needs-rework` with no Blocking/compile defects. Applied:
- **High-1:** Task 3 Step 5 now makes the failing-video regression test set `mockTranscribeViaGemini.mockRejectedValue(...)` so the cascade fails explicitly (no coincidental pass via auto-mock `undefined`→TypeError).
- **Medium-1:** Task 3 gated-path test moved inside `describe('writeSummaryDoc')`, using its `outputFolder` fixture + `afterEach` cleanup (no leakage of `…Once` mocks).
- **Medium-2:** Task 1 Step 8 adds a `durationSeconds: 0` test (no warn, no div-by-zero).
- **Low-1:** Task 1 Step 8 adds an equal-`startSec`/first-empty dedupe test.
- **Low-3:** spec error-table row corrected (dedupe, not 0-duration).
- **Medium-3 / Low-2 / Low-4:** confirmed correct/intentional — no change.
