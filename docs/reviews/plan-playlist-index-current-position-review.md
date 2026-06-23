# Adversarial Plan Review — playlist-index-current-position

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: **needs-rework** → 1 Blocking + 1 Low applied. The production flip, comment fix, and the collision/stale/stable/empty/archived-in-playlist tests are all verified correct; existing tests `:369`/`:389`/`:612` survive the flip. Baseline `npx jest pipeline` = 75 passing.

## Applied
- **B1 — returned-from-removal test asserted state the mocked store can't produce.** `lib/index-store` is fully mocked; `mockReadIndex` returns the same seeded array on every call, and the reconcile loop's un-archive goes through `upsertVideo` (no-op mock). The re-stamp pass re-reads the *stale* seeded array, so the final `writeIndex` still shows `archived:true`. (In production `readIndex` is a real disk round-trip so it works; the mocked test cannot observe it at the `writeIndex` boundary.) → Fixed per option A: the test now asserts the un-archive via `mockUpsertVideo` call args (mirroring the existing `:332` test) and `playlistIndex` via `lastWrittenVideos()`.
- **L1 — RED/GREEN narration imprecise.** For the returned case, the `playlistIndex` assertion is what flips RED→GREEN; the upsert-arg assertion passes both before and after the flip (reconcile un-archive is independent of the flip). → Step 2/Step 4 narration tightened.

## Verified-correct (reviewer)
Flip is sound (in-playlist always in `positionMap`; removed fall through to `?? v.playlistIndex`); no TS errors (all fields optional in types/index.ts); existing `:369`/`:389`/`:612` pass; collision→1,2 / stale→5 / stable-fields / empty-playlist / archived-but-in-playlist→6 all produce the asserted values; `writeIndex` is always called (unconditional at `:280` and `:393`) so `lastWrittenVideos()` is always safe. The archived-but-in-playlist test passes because its asserted archive state equals the seeded state (no reconcile write needed), so the stale-read issue doesn't bite there.
