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
| Captions available | combined path, ▶ timestamps | **unchanged** (resolver returns captions; no Gemini transcribe call) |
| Captions gated/empty | video-only, **no ▶** | **Gemini transcribe → combined path → ▶ timestamps** |
| Captions gated **and** Gemini transcribe fails | video-only, no ▶ | video-only, no ▶ (**unchanged** graceful floor) |

**Cost:** only on **gated** deep-dives, one extra `transcribeViaGemini` call (`gemini-2.5-flash`, ~256k tokens ≈ cents) before the existing `generateDeepDiveCombined` (`gemini-2.5-pro`) call. Captioned videos (the majority) are unaffected — no extra call. Same cost discipline as PR #15.

## Scope decisions (flagged for user review tomorrow)

- **No version bump / no mass regeneration.** A deep-dive **major** bump would re-run the Gemini cascade for **every** deep-dive (expensive, and re-processes captioned ones needlessly); a **minor** bump only re-renders HTML from the existing `.md` (won't restore missing tokens). Neither cleanly targets "only the gated docs." So: the fix applies to **new generations and on-demand regenerations**. Existing timestamp-less deep-dives are restored by regenerating those specific videos (the user can trigger per-video). **Open question for the user:** do you want a one-off script to find + regenerate just the timestamp-less deep-dives whose captions are now available? (Default: no — leave on-demand.)

## Out of scope

- Summary path (already has the fallback — PR #15).
- HTML render / `render-deep-dive.ts` (timestamps render correctly when present — this is purely about *producing* them).
- Forced mass regeneration / version bump (see Scope decisions).

## Testing (TDD — boundary mocks per project policy)

`tests/lib/deep-dive/write-doc.test.ts` — mock `resolveTranscriptSegments` (from `../transcript-source`) instead of `fetchTranscriptSegments`:
- **Captions available** (resolver returns segments): combined path, ▶ body written, `resolveTranscriptSegments` called with `(videoId, youtubeUrl, durationSeconds)`. (Adapts the existing combined-path test.)
- **Flip `:103`/`:116`:** when captions are gated, the resolver (real cascade) yields **Gemini** segments → **combined path runs, ▶ present** — NOT video-only. Assert `generateDeepDiveCombined` called with the resolver's segments.
- **Both sources fail** (resolver throws): `segments = null` → **video-only path**, no ▶ — the graceful floor is preserved. (This is the *only* remaining no-▶ case.)
- Existing combined-throw → transcript-only → video-only tiering tests: unchanged (they mock the generators, not the fetch).
- Full `npm test` + `npx tsc --noEmit` green before each commit. Dual review per task.

## Appendix — diagnosis artifacts

- Live caption check (during diagnosis): `v4F1gFy-hqg`=547 segs, `bC9BaY18b0o`=558 segs, control `L2JKgj7WzU4`=636 segs — all available now; the zero-timestamp deep-dives are `ts=0` despite this → generated during a gating window.
- Sync run after PR #15 merge: 4/4 new videos summarized, **0 errors** (the summary fallback works end-to-end).
