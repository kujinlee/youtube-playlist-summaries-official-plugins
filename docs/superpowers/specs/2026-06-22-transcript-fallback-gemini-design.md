# Gemini Transcript Fallback for Summaries (when YouTube captions are unavailable)

**Date:** 2026-06-22
**Branch:** `feat/transcript-fallback-gemini`
**Status:** Design — locked (user authorized autonomous progression through the adversarial-review gates)

## Problem

The summary pipeline hard-requires a YouTube caption track: `writeSummaryDoc` calls
`fetchTranscriptSegments(videoId)`, and if YouTube doesn't serve a transcript it throws and the video is
never summarized. A real sync of the `agentic-ai-claude-code` playlist failed **4 of 5** new videos with
`"Transcript is disabled on this video"`.

**Root cause (diagnosed + measured):** for those videos YouTube's Data API *lists* an `en/asr` caption
track, but the unauthenticated player/page serves **zero caption tracks**, so no caption library (the
current `youtube-transcript`, nor `youtube-transcript-plus`, nor `youtubei.js` — all tested) can fetch the
text. It is **per-video and not metadata-driven** (same dates/lengths/languages/caption-types succeed on
other videos), i.e. YouTube-side gating or an uploader transcript toggle. **A caption-library swap does
not fix it.** The deep-dive pipeline already survives this because it falls back to sending the video URL
to Gemini; the summary pipeline has no such fallback.

## Decision (locked, evidence-based)

Add a **transcript-source fallback**: when captions are unavailable, obtain the transcript by sending the
**YouTube URL to Gemini at low media resolution** and asking for a complete **timestamped transcript**,
mapped into the existing `TranscriptSegment[]`. Everything downstream (`generateSummary`, `[[TS:i]]` →
▶ timestamp resolution, the `.md` format) is **unchanged**.

**Why URL→Gemini (Option A) over yt-dlp-audio (Option B)** — measured in spikes (see Appendix):
- No new dependency (reuses the deep-dive's existing `fileData: { fileUri: youtubeUrl }` pattern); no
  yt-dlp, no ffmpeg, no download, portable anywhere Gemini runs.
- Recovers the gated videos (Gemini fetches server-side — proven on the blocked Anthropic video).
- Audio quality holds at low resolution (10/12 verbatim word matches vs real captions — `mediaResolution`
  downsamples *frames*, not audio).
- Timestamp drift **~1.6 s median, 4.2 s max** (cleaner than Option B's audio path, which showed a ~20 s
  outlier). Negligible for section-level ▶ navigation (the app already quantizes to caption segments).
- Cost ~256–294k Flash tokens (~$0.09) per ~45-min gated video — a few cents more than audio-only, only
  on the minority of gated videos. Not worth a system dependency.

## Architecture

**New unit — `lib/transcript-source.ts`** (the cascade; keeps `youtube.ts`=captions and `gemini.ts`=LLM
boundaries clean):
```ts
export async function resolveTranscriptSegments(
  videoId: string, youtubeUrl: string, durationSeconds: number,
): Promise<{ segments: TranscriptSegment[]; source: 'captions' | 'gemini' }>;
```
1. `let captionErr: unknown; try { const segments = await fetchTranscriptSegments(videoId); if (segments.length) return {segments, source:'captions'} } catch (e) { captionErr = e }`
   (capture the error — needed for the combined message in step 3; an empty array falls through with
   `captionErr` left undefined — M6).
2. captions threw **or** returned empty → `segments = await transcribeViaGemini(youtubeUrl, videoId, durationSeconds)`;
   if non-empty return `{segments, source:'gemini'}`.
3. Gemini path fails or yields zero segments → throw a clear error including the videoId and the captured
   `captionErr` cause (`transcript unavailable via captions and video for <videoId>: <captionErr / gemini cause>`).
   The summary fails as it does today (rare — private/age-gated/too-long for Gemini's fetch).

**New unit — `transcribeViaGemini(youtubeUrl, videoId, durationSeconds)` in `lib/gemini.ts`** (a Gemini call):
- `model = client.getGenerativeModel({ model: TRANSCRIBE_MODEL, generationConfig })`,
  `TRANSCRIBE_MODEL = process.env.GEMINI_TRANSCRIBE_MODEL ?? 'gemini-2.5-flash'`.
- `generationConfig` uses **controlled generation** (`responseMimeType:'application/json'` +
  `responseSchema`) AND **low media resolution**. The 0.24.1 SDK doesn't type `mediaResolution`, so pass it
  through inside `generationConfig` with a cast — **it must ride on `generationConfig`** (the SDK spreads it
  into the request body; a top-level field would be dropped): `{ responseMimeType:'application/json',
  responseSchema: SEG_SCHEMA, mediaResolution: 'MEDIA_RESOLUTION_LOW' } as GenerationConfig` (spike: token
  count 700k→256k confirms the API honors it). Document the cast with a comment.
- `responseSchema`: a `SchemaType.OBJECT` `{ segments: ARRAY<OBJECT{ startSec: INTEGER, text: STRING }> }`
  with `required`, expressed exactly like `MAGAZINE_RESPONSE_SCHEMA` (`gemini.ts:82-111`). The OpenAPI
  subset can't enforce text-min-1 / finite startSec — a **Zod schema + post-parse cleanup is the real
  guarantor** (M5), not `responseSchema`.
- **Do NOT reuse `generateJson`** — it is string-only (`gemini.ts:118-129`) and cannot carry the `fileData`
  part (B1). Instead call `model.generateContent([{ fileData:{ fileUri:youtubeUrl, mimeType:'video/mp4' } },
  { text: PROMPT }])` directly, mirroring `generateDeepDiveCombined` (`gemini.ts:383-397`), wrapped in a
  **local** `JSON.parse` + Zod-validate + retry loop (1–2 retries, `console.warn` on retry like the
  `[gemini-retry]` line at `gemini.ts:134`).
- **PROMPT** (full coverage is essential — the spike showed "give N moments" front-loads): *"Transcribe
  this entire video from start to finish. Return JSON `{segments:[…]}` where each segment is ~1–3 sentences
  of spoken words with `startSec` = the integer second it begins. Segments MUST be in increasing time order
  and MUST cover the whole video, continuing all the way to the end — do not stop early or summarize. Use
  only words actually spoken."*
- **Map to `TranscriptSegment[]`**: drop rows with empty text or non-finite `startSec`; **sort by
  `startSec` and DEDUPE equal `startSec` (keep first)** — `resolveTranscriptTokens` requires strictly
  increasing resolved offsets (`transcript-timestamps.ts:79-89`); duplicate starts would drop ALL ▶ links
  in that doc (M7). Then `offset = startSec`; `duration = max(0, nextStartSec - startSec)` (last: nominal
  `5`). Shape matches `fetchTranscriptSegments` exactly → `buildIndexedTranscript` / `[[TS:i]]` unchanged.
- **Coverage safeguard** lives HERE (it now has `durationSeconds`): after mapping, if
  `lastOffset / durationSeconds < 0.6`, `console.warn('[transcribe-coverage] low coverage <pct>% for
  <videoId>')` and still return (partial > failed). Do not hard-fail (H2/H3).

**Integration — `lib/pipeline.ts` `writeSummaryDoc`:** replace
`const segments = await fetchTranscriptSegments(videoId);` with
`const { segments } = await resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds);`
(`youtubeUrl` and `durationSeconds` are both in `SummaryDocInput`, `pipeline.ts:16` — confirmed).
`detectLanguage(segments.map(s=>s.text).join(' '))` is unchanged and works on Gemini-derived text.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `lib/youtube.ts` `fetchTranscriptSegments` | YouTube caption fetch (unchanged) | youtube-transcript |
| `lib/gemini.ts` `transcribeViaGemini` | URL→Gemini low-res timestamped transcript → segments | @google/generative-ai |
| `lib/transcript-source.ts` `resolveTranscriptSegments` | cascade: captions → Gemini | the two above |
| `lib/pipeline.ts` `writeSummaryDoc` | consume the resolver instead of captions directly | resolver |

## Coverage safeguard

Implemented inside `transcribeViaGemini` (which now receives `durationSeconds`): coverage =
`lastSegment.offset ÷ durationSeconds`. If `< 0.6`, `console.warn('[transcribe-coverage] low coverage
<pct>% for <videoId>')` and still return the (partial) segments — partial beats a failed summary, and the
warning surfaces it. Do not hard-fail. (Uses `console.warn`, the gemini.ts convention — `dev-logger.ts`
has no warn API.)

## Token budget (longest videos)

Coarse segments make `buildIndexedTranscript` *smaller* than caption output, so the downstream
`generateSummary` call is well within `gemini-2.5-flash`'s context for normal talk lengths. Bound check: a
2-hour talk ≈ ~18k words ≈ ~24k tokens of indexed transcript — comfortably under Flash's input limit. The
transcription call itself is the larger one (~256–294k tokens for ~45 min at low-res, billed only on gated
videos). No chunking needed for the playlist's video lengths (≤ ~1 h observed).

## Error handling / edge cases

| Case | Behavior |
|------|----------|
| Captions available | Return them; **never** call Gemini (no extra cost) |
| Captions throw ("disabled") or empty | Fall through to `transcribeViaGemini` |
| Gemini returns 0 segments / invalid JSON after retries | resolver throws clear error → summary fails (as today) |
| Gemini fetch fails (private/age-gated/too long) | same → clear error |
| Gemini under-covers a long video | return partial + dev-logger warning (coverage safeguard) |
| Segments out of order / dup `startSec` | sorted on map; equal starts → **deduped (keep first)** so resolved offsets stay strictly increasing |
| Language detection | runs on joined Gemini text — unchanged |
| `.md` output | identical format; gated-video summaries carry ▶ timestamps (~1.6 s accuracy). No format change |

## Cost / performance

The Gemini transcription runs **only on gated videos** (captions-first). ~256–294k Flash input tokens per
~45-min video (≈ cents). Slower than a caption fetch, but bounded to the minority that need it. The 257
captioned videos are unaffected (no extra call, no extra cost).

## Testing (TDD — boundary mocks per project policy)

- **`tests/lib/transcript-source.test.ts`** (resolver cascade): captions succeed → returns them,
  `transcribeViaGemini` NOT called, `source:'captions'`; captions throw → `transcribeViaGemini` called,
  returns its segments, `source:'gemini'`; captions empty `[]` → Gemini path; both fail → throws with the
  combined message. Mock `fetchTranscriptSegments` and `transcribeViaGemini`.
- **`tests/lib/gemini.test.ts`** (`transcribeViaGemini`): given a mocked model response
  `{segments:[{startSec,text}…]}` → correct `TranscriptSegment[]` (offset=startSec, duration=gap, sorted,
  equal-startSec deduped); empty/invalid → throws after retries; low-coverage input → returns + `console.warn`
  (spy on `console.warn`). **Test-mock note (H4):** the existing suite mocks `getGenerativeModel` with an
  inline `jest.fn()` that discards its args; to assert the cost-critical config, **hoist
  `getGenerativeModel` to a named `jest.fn()`** so the test can read
  `getGenerativeModelMock.mock.calls[0][0].generationConfig.mediaResolution === 'MEDIA_RESOLUTION_LOW'`.
  The youtube `fileData` part is assertable via `mockGenerateContent.mock.calls[0][0]` (as the existing
  deep-dive test does, `tests/lib/gemini.test.ts:407-413`).
- **`tests/lib/pipeline.test.ts`** (integration): `writeSummaryDoc` with captions mocked to throw → the
  Gemini-resolver segments drive a successful summary (`generateSummary` still called with segments;
  `.md` written). Confirms the gated path produces a doc.
- Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Out of scope

- **Deep-dive** changes — it already has a video-URL fallback (it survives gated videos). Reusing
  `resolveTranscriptSegments` to give gated deep-dives ▶ timestamps is a future enhancement.
- **Option B (yt-dlp audio)** — rejected (system dependency for a few-cents saving).
- **Whisper / exact timestamps** — rejected; estimated (~1.6 s) accepted.
- **Retrying captions on a later sync** for a video first summarized via Gemini — not now.
- **Marking the `.md`** as Gemini-sourced — not now (the resolver returns `source` for logging only).

## Appendix — spike evidence (measured 2026-06-22)

- Three caption libraries (`youtube-transcript`, `youtube-transcript-plus`, `youtubei.js`) all FAIL on the
  same 4 gated videos; the player response returns 0 caption tracks (Data API lists `en/asr`).
- yt-dlp CAN fetch the gated videos' audio (proving audio is available) — but adds a system dependency.
- **Option A (URL low-res → Gemini), ground-truth video (41 min, has captions):** 10/12 quotes verbatim;
  drift median 1.6 s, mean 1.5 s, max 4.2 s; `promptTokens` 255,589 (vs ~700k full-res). `mediaResolution:
  LOW` honored by SDK 0.24.1 via passthrough.
- **Option A recovery, gated video (47 min, blocked captions):** coherent transcript returned
  (*"…Chief Product Officer of Anthropic… that feeling of joy"*); `promptTokens` 293,583.
- Coverage caveat: a "give N moments" prompt front-loads anchors; an explicit "cover to the very end"
  instruction produced anchors through 37:37 of the 41-min file → the production prompt must demand full
  coverage (handled above).
