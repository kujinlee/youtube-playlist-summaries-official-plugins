# Deep-Dive Transcript Fallback (timestamps for caption-gated videos)

**Date:** 2026-06-22
**Branch:** `fix/deep-dive-transcript-fallback`
**Status:** Design — author-locked (user away; authorized "fix it through dev process"); pending adversarial review gate.

## Problem (diagnosed via systematic-debugging)

Deep-dive docs generated for some videos have **no ▶ timestamps**, even though the same videos' summaries do. Observed: deep-dives regenerated **Jun 22** lack timestamps; **Jun 21** ones have them.

**Root cause (evidence-based, NOT a guess):**
- `lib/deep-dive/write-doc.ts:42` fetches the transcript with **`fetchTranscriptSegments(videoId)` — captions-only.** When captions are unavailable it returns empty / throws → the guard at `write-doc.ts:50` (`segments.length > 0`) fails → the **video-only** generation path (`generateDeepDive`) runs, which has no indexed transcript → **no `[[TS:i]]` tokens → no ▶ timestamps.**
- YouTube caption availability is **intermittent and per-video** (the same gating that failed 4 summaries and motivated PR #15). Live re-check during diagnosis: the affected videos (`v4F1gFy-hqg`, `bC9BaY18b0o`) **currently return 547 / 558 caption segments** — so it is not permanent gating and not a content problem. Their deep-dives were regenerated during a window when captions weren't served.
- `write-doc.ts`'s transcript logic is **unchanged** since the timestamp feature shipped (commits `9dfc07b`, `5c45a6d`), and the full suite (incl. deep-dive timestamp tests) is green → **not a code regression.**
- Deep-dive does **not** use the new `resolveTranscriptSegments` (captions→Gemini) fallback. PR #15 added that fallback for **summaries only** and explicitly listed gated-deep-dive timestamps as a future enhancement.

**Why the tests missed it (answers the standing question):** This is a **design/scope gap, not a logic defect**, so no test could "catch" it. Worse, two tests actively **codify the gap as intended behavior**: `tests/lib/deep-dive/write-doc.test.ts:103` (*"video-only path when transcript fetch fails: no segments passed, no ▶ tokens"*) and `:116` (*"video-only path when transcript is empty ([]): … no ▶"*) **assert that caption failure yields a timestamp-less doc**. A test asserting the wrong expectation never fails on that behavior. The suite also mocks `fetchTranscriptSegments`, so it never experiences real caption gating (an external/environmental condition). No test encoded the user requirement *"a gated video's deep-dive should still have timestamps"* — because that requirement did not exist until now. This fix creates it, and flips those two assertions.

## Decision (mirror PR #15's fallback into deep-dive)

In `lib/deep-dive/write-doc.ts`, replace the captions-only fetch with the cascade resolver:

```ts
// before
let segments: TranscriptSegment[] | null = null;
try { segments = await fetchTranscriptSegments(videoId); }
catch (e) { errors.push(`transcript fetch: ${msg(e)}`); }

// after
let segments: TranscriptSegment[] | null = null;
try {
  const resolved = await resolveTranscriptSegments(videoId, video.youtubeUrl, video.durationSeconds);
  segments = resolved.segments;
} catch (e) { errors.push(`transcript fetch: ${msg(e)}`); }
```

- `resolveTranscriptSegments(videoId, youtubeUrl, durationSeconds)` already exists (PR #15, `lib/transcript-source.ts`): captions first; on throw/empty → `transcribeViaGemini` (URL→low-res); both fail → **throws**. The existing `try/catch` turns that throw into `segments = null` → the **video-only path still runs as the final graceful fallback** (unchanged behavior when *everything* fails).
- On success the resolver returns **non-empty** segments (captions or Gemini), so `segments.length > 0` → the **combined path** (`generateDeepDiveCombined`) runs → `[[TS:i]]` tokens emitted + resolved → **▶ timestamps restored**, even for caption-gated videos.
- `video.youtubeUrl` and `video.durationSeconds` are both on the `Video` type (`types/index.ts:49,51`) and in scope in `writeDeepDiveDoc`. No signature change.

Everything else in `write-doc.ts` (the 3-tier combined→transcript-only→video-only cascade, filename derivation, frontmatter, HTML invalidation) is **unchanged**.

## Behavior & cost

| Case | Before | After |
|------|--------|-------|
| Captions return ≥1 segment | combined path, ▶ timestamps | **unchanged** (resolver returns captions; NO Gemini transcribe call) |
| Captions **empty `[]`** (structurally present, no throw) | video-only, **no ▶** | **Gemini transcribe → combined path → ▶** (the resolver treats empty `[]` as a fall-through trigger — `transcript-source.ts:18`) |
| Captions throw (gated/disabled) | video-only, **no ▶** | **Gemini transcribe → combined path → ▶** |
| Captions unavailable **AND** Gemini transcribe fails | video-only, no ▶ | video-only, no ▶ (**unchanged** graceful floor — resolver throws → `catch` → `segments=null`) |

**Cost — stated honestly (corrects the first draft):**
- **Net-new cost on a gated video = one `transcribeViaGemini` call** (`gemini-2.5-flash`, low-res, ~256k tokens ≈ cents). It is NOT a doubling of the expensive call: a gated deep-dive **already** uploaded the video to `gemini-2.5-pro` via the **video-only** path (`generateDeepDive`). The fix upgrades that same pro call from video-only → **combined** (video **+** transcript), which is strictly higher quality for a marginal token increase, and adds only the cheap flash transcribe in front.
- **Empty-but-successful captions** (`[]`) now also trigger the flash transcribe (previously they went straight to video-only). This is the intended trade (timestamps + transcript-grounded depth for a cents-level flash call), but it IS a behavioral change — owned here, not hidden.
- Captioned videos (the majority, ≥1 segment) are completely unaffected — no extra call.

**Why `generateDeepDiveCombined` (keeps the video) and not `generateDeepDiveFromTranscript` (segments-only, no video upload) for Gemini-sourced segments** — H2 from review, decided:
- `generateDeepDiveFromTranscript` (`gemini.ts:23`) *does* resolve `[[TS:i]]` → ▶ and would avoid the pro **video** upload, so it is the cheaper way to get timestamps. **But** the pro video upload is **not new** for a gated video (the video-only path already did it), and the combined path's **visual grounding is the entire value proposition of a deep-dive**. Degrading gated-video deep-dives to transcript-only to save a cost that was already being paid would trade away depth for no marginal saving versus the status quo. So: **keep the existing cascade order (combined first)**. `generateDeepDiveFromTranscript` remains the existing 2nd-tier fallback when combined throws.
- (Future optimization, out of scope: route Gemini-sourced segments to `generateDeepDiveFromTranscript` when the operator opts into a cheaper/no-video deep-dive. Not now.)

**`durationSeconds === 0`** (schema allows `nonnegative()`): `transcribeViaGemini` already guards its coverage warning with `durationSeconds > 0` (`gemini.ts:544`), so a 0-duration video won't crash — it simply skips the low-coverage warning. No special handling needed; noted so it is not a surprise.

## Scope decisions (flagged for user review tomorrow)

- **No version bump / no blanket mass regeneration.** A deep-dive **major** bump would re-run the Gemini cascade for **every** deep-dive (expensive, and re-processes captioned ones needlessly); a **minor** bump only re-renders HTML from the existing `.md` (won't restore missing tokens). Neither cleanly targets "only the timestamp-less docs."
- **But the existing broken docs must not be silently abandoned** (review M3). Resolution, without a blanket regen and without over-building:
  1. **Verification repairs the visible docs (in this branch):** after the fix lands, regenerate the identified timestamp-less deep-dives whose captions are confirmed available (`v4F1gFy-hqg` *software-fundamentals*, and `bC9BaY18b0o` if time permits) and assert ▶ timestamps now appear end-to-end. This proves the fix **and** repairs the specific docs the user saw — so the reported symptom is gone, not deferred.
  2. **Corpus-wide repair = explicit offer, not silent default.** A small operator-invoked script that scans the index for ▶-less deep-dives with now-available captions and regenerates only those is straightforward to add, but it is **not built in this branch** (it would re-run Gemini across an unknown set of videos — a cost decision that is the user's to make). It is surfaced as a tracked open question for tomorrow, not defaulted to "no." If the user wants it, it is a fast follow-up.

## Out of scope

- Summary path (already has the fallback — PR #15).
- HTML render / `render-deep-dive.ts` (timestamps render correctly when present — this is purely about *producing* them).
- Blanket forced mass regeneration / version bump (see Scope decisions; a targeted opt-in repair script IS in scope).
- Routing Gemini-sourced segments to the no-video `generateDeepDiveFromTranscript` (future cost optimization).

## Other callers (grep-confirmed)

`fetchTranscriptSegments` is imported by only `lib/transcript-source.ts` (the resolver) and `lib/deep-dive/write-doc.ts`. The summary path already routes through the resolver (`pipeline.ts:44`). **`write-doc.ts` is the last remaining direct caller** — so this fix closes the gap completely; no other surface has it.

## Testing (TDD — boundary mocks per project policy)

**Mock boundary (corrects the first draft — B1):** mock `../../../lib/youtube` and `../../../lib/gemini` and run the **REAL** `resolveTranscriptSegments` — exactly as `tests/lib/pipeline.test.ts` does (`jest.mock('../../lib/youtube')` + `jest.mock('../../lib/gemini')`, never the resolver) and as the dev-process "Mocking Boundaries" table mandates (mock at `lib/youtube.ts` and `lib/gemini.ts`). **Do NOT `jest.mock('../../../lib/transcript-source')`** — mocking the resolver would leave the captions→Gemini cascade (the whole point of this fix) untested. Add a `jest.mocked(gemini.transcribeViaGemini)` handle.

**`tests/lib/deep-dive/write-doc.test.ts` changes — every test whose mock setup currently forces video-only via a caption rejection/empty MUST be updated (H3 — there are FOUR, the first draft listed two):**

| Test | Today | After |
|------|-------|-------|
| `:70` combined path | asserts `mockFetchTranscriptSegments` called with id | keep; captions return `SEGMENTS` (beforeEach) → resolver returns them → combined path unchanged. (Assertion on `fetchTranscriptSegments` still holds — the real resolver calls it; optionally also assert `transcribeViaGemini` NOT called, proving no extra cost on captioned videos.) |
| `:103` "fetch fails → video-only, no ▶" | captions throw → video-only | **FLIP:** captions throw **+ `transcribeViaGemini` returns segments** → **combined path, ▶ present**. Rename to "captions gated → Gemini fallback → combined with ▶". |
| `:116` "empty `[]` → video-only, no ▶" | captions `[]` → video-only | **FLIP:** captions `[]` **+ `transcribeViaGemini` returns segments** → **combined path, ▶ present**. |
| `:168` "step event on video-only path" | captions throw → video-only | captions throw **+ `transcribeViaGemini` throws** → resolver throws → `segments=null` → video-only step event (preserve intent by failing BOTH sources). |
| `:180` "no transcript AND video-only fails → throws" | captions throw → video-only→fail | captions throw **+ `transcribeViaGemini` throws** + `generateDeepDive` throws → throws with messages. |

**New test (the floor, explicitly):** captions throw **and** `transcribeViaGemini` throws → `segments=null` → **video-only path, no ▶** — the *only* remaining no-▶ case. (Distinct from `:168`/`:180` which assert the step event / error aggregation.)

**Unchanged (M2 — corrected reason):** `:92` (combined-throw → transcript-only), `:132` (combined+transcript throw → video-only), `:194` (all paths fail) mock the **generators**; they reach the cascade because captions succeed via `beforeEach` (`mockFetchTranscriptSegments.mockResolvedValue(SEGMENTS)`, :62) — so the real resolver returns those captions and `transcribeViaGemini` is never called. They keep passing *because captions succeed*, not because "fetch mocking is irrelevant."

**Verification (Phase 4):** regenerate `v4F1gFy-hqg`'s deep-dive against the running app (captions confirmed available) and assert the written `.md` now contains ▶ — end-to-end proof + repairs the doc.

Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Appendix — diagnosis artifacts

- Live caption check (during diagnosis): `v4F1gFy-hqg`=547 segs, `bC9BaY18b0o`=558 segs, control `L2JKgj7WzU4`=636 segs — all available now; the zero-timestamp deep-dives are `ts=0` despite this → generated during a gating window.
- Sync run after PR #15 merge: 4/4 new videos summarized, **0 errors** (the summary fallback works end-to-end).
