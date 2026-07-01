# Codex Adversarial Review — Deep-Dive Retirement

**Branch:** `feat/remove-deep-dive` (PR #51) reviewed against `master`
**Date:** 2026-06-30
**Verdict:** MEDIUM AND BELOW — no Blocking/High. `tsc --noEmit` clean.

## MEDIUM

### M1 — Legacy `deepDive*` keys live on in `playlist-index.json`
- `types/index.ts:55`, `lib/index-store.ts:47`, `app/api/videos/route.ts:113`
- `readIndex()` does raw `JSON.parse(...) as PlaylistIndex`; existing entries with `deepDiveMd/deepDiveHtml/deepDiveVersion` persist and are re-served by the API.
- Fix: normalization pass on read/write that strips the three legacy keys.

### M2 — Archive cleanup has no path for legacy `-deep-dive.md/.html` files
- `lib/archive.ts:20`, `lib/archive.ts:68`, removed `tests/lib/archive.test.ts @@ -63`
- Archive now only iterates `[video.summaryMd]`; stale `*-deep-dive.*` files on disk have no cleanup route.
- Fix: one-time migration, or guarded raw-index access in archive cleanup.

### M3 — No retirement regression test for `?type=deep-dive`
- `app/api/html/[id]/route.ts:45`, `tests/api/html-serve.test.ts:46`, deleted `tests/api/html-serve-deep-dive.test.ts`
- Serve route now rejects anything except `summary`/`dig-deeper`, but the deleted deep-dive suite wasn't replaced with a minimal `?type=deep-dive → 400` assertion.
- Fix: add one test case confirming the retired response.

## LOW / Cleanup
- `docs/design-spec.md:62,107`, `docs/implementation-plan.md:110`, `docs/ADR.md:189` — still describe `deepDiveMd`, the removed API route, `lib/deep-dive.ts`. Mark historical or update.
- `app/page.tsx:291`, `lib/archive.ts:60` — stale comments referencing deep-dive paths.

## Confirmed clean boundaries
- `lib/html-doc/nav.ts` correctly left functionally unchanged — `render-dig-deeper.ts:246` calls `digControl('summary', …)`; dig-deeper nav intact.
- `GEMINI_DEEPDIVE_MODEL` correctly kept — `lib/dig/generate.ts:15,176` uses it for dig-deeper.
- `npx tsc --noEmit` passed clean.
