# Adversarial Plan Review — Deep-Dive Version-Aware Regeneration (Bundle B)

**Reviewer:** Claude (adversarial subagent, full repo access) — **fallback for Codex**.
**Date:** 2026-06-20.
**Plan:** `docs/superpowers/plans/2026-06-20-deep-dive-version-aware-regeneration.md`
**Spec:** `docs/superpowers/specs/2026-06-20-deep-dive-version-aware-regeneration-design.md`

> **⚠️ Codex gap:** the Codex adversarial pass could NOT run — the ChatGPT/Codex usage limit was
> hit (reset ~2026-07-18) and the run hung with no output. Per the `docs/plugins.md` rule (Codex
> unavailable for any reason → Claude adversarial fallback, never block), this Claude review
> satisfies the Post-Plan Gate to proceed. **Re-attempt the Codex-specific pass before merge** if
> access returns.

## Blocking

- **B1 — Three existing `runDeepDive` test suites are orphaned by deleting `lib/deep-dive.ts`.**
  `tests/lib/deep-dive.test.ts` (cascade truth-table, ~25 calls), `tests/lib/deep-dive-html-stale.test.ts`,
  and `tests/api/deep-dive.test.ts` all import/mock `lib/deep-dive`. Task 5 deletes the module and its
  grep excludes `tests/`. → full suite red. **Fix:** Task 5 must port/delete all three and grep `tests/` too.
- **B2 — `tests/api/deep-dive.test.ts` mocks `lib/deep-dive`**, which the rewritten route no longer calls;
  its stream-route + 400-validation tests are left homeless (the new `deep-dive-post.test.ts` only covers
  double-submit/jobId). **Fix:** fold the existing route+stream tests into the rewrite, re-mocking `lib/deep-dive/ensure`.

## High

- **H1 — `writeDeepDiveDoc` base name must be `(summaryMd ?? videoId)`, not `deepDiveMd`.** `lib/deep-dive.ts:80`
  derives base from `summaryMd ?? videoId` (deepDiveMd is null on first generate). **Fix:** state explicitly:
  `base = (video.summaryMd ?? video.id).replace(/\.md$/,'')`, returns `${base}-deep-dive.md`.
- **H2 — Single `busy` boolean vs spec's "each item disables only while its own job runs."** The codebase
  threads ONE `busy` per row (page.tsx `busyVideoId` → VideoList → VideoRow → VideoMenu). Reusing it cross-disables
  the summary and deep-dive menu items. **Decision needed:** accept cross-disable (correct the spec line) OR add a
  second per-job busy signal through the component chain (unplanned plumbing). → **user decision.**
- **H3 — `writeDeepDiveDoc` must emit NO `done` (and only one `start`).** `runDeepDive` ends with `done` and
  starts with `start`; if copied verbatim, `ensureDeepDiveHtml` sees a premature `done` (lock releases early, stamp
  races refetch) and a double `start`. **Fix:** `writeDeepDiveDoc` emits only `step` events; `ensureDeepDiveHtml`
  owns `start` and the terminal `done` (after the stamp).
- **H4 — `runDeepDiveHtml` shape change breaks an existing test.** `tests/lib/html-doc/generate-deep-dive.test.ts:48`
  asserts on the returned HTML string; after returning `{ html, htmlPath }` it breaks. **Fix:** Task 3 updates that
  test to destructure `{ html }`.

## Medium (present for decision)

- **M1 — Add a `withTimestamps:true` assertion to `gemini-deepdive-prompt.test.ts`** so the timestamp instruction
  is regression-covered (the optional param defaults false, so existing 2-arg tests won't catch a regression).
- **M3 — No Korean (ko) unit test for the deep-dive generators** (language is plumbed; the English "indexed list"
  scaffolding sentence is precedented by `generateSummary`). Add one ko assertion or scope it out.
- **M4 — Serve-route lazy fallback re-renders on every view** for never-regenerated deep-dives (writes the html
  file but never stamps `deepDiveHtml`). Matches today's behavior; spec §7 calls it graceful degradation. Conscious-choice ack.
- **M5 — Verify the "md unreadable" test asserts no version stamp** (corrupt md → `runDeepDiveHtml` throws → no stamp; correct per §8).

## Low (fix inline, no decision)

- **L1 — Naming drift:** plan creates `lib/version.ts`; spec §11 says `shared-version.ts`. Plan is internally
  consistent (tests import `../../lib/version`). Align the spec to `lib/version.ts`.
- **L2/L3/L4 — Verified, no defect:** VideoMenu busy markup mirrors summary; auto-close target is 4000ms
  (DeepDiveStatusBar:53 → match HtmlDocStatusBar:43); `generateDeepDive` (video-only, 2-arg) unchanged so
  `tests/lib/gemini.test.ts` stays green.

## Verdict

Not safe to implement as written — **B1, B2, H1, H3, H4** will red-fail the suite or race the stamp. With those
fixed (inline) and **H2 decided** (cross-disable vs per-item busy), the architecture is sound and faithfully
mirrors the proven summary pipeline.
