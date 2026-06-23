# Adversarial Spec Review — quick-reference-fallback

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: **needs-rework** → no Blocking; all High/Medium applied. Fix is sound; rework is argument choice, try/catch scope, a test-suite blast-radius guard, and migration idempotency.

## Applied

- **H1 — wrong argument.** Spec said `extractQuickView(summary)` (body only); the two production consumers (`backfill/route.ts:60`, `regenerate/route.ts:62`) pass the **full md**. → Changed to `extractQuickView(baseContent)` (full md: frontmatter+title+meta+summary), matching them; tests assert `toHaveBeenCalledWith(baseContent)`.
- **H5a — try/catch scope pinned.** The `try` wraps ONLY the derive (`extractQuickView` + `insertQuickViewCallout`); the `await writeFile(...)` stays OUTSIDE so a throw never skips the `.md` write. Spec now shows the exact control structure: compute `mdContent` + `finalTldr/finalTakeaways` in the if/else (catch → `mdContent = baseContent`, values `undefined`), then write, then return.
- **M5b — discard-partial-on-throw is intentional and BENEFICIAL.** When generateSummary returns only `tldr` and `extractQuickView` then throws, we discard the partial `tldr` and persist `undefined`. Rationale (now explicit): clearing the index `tldr` keeps the doc **eligible for the existing backfill** (`backfill/route.ts:28` filters on `!v.tldr`); keeping a lone `tldr` would make it `!v.tldr === false` → permanently backfill-ineligible AND callout-less. Discard is the correct choice.
- **M6b — test-suite blast radius (the big one).** `makeSummaryResponse()` has NO `tldr`/`takeaways` by default, so once the fallback exists, ~30 existing ingestion tests would trigger the now-reachable `extractQuickView` mock. → Test plan: (a) add `tldr`+`takeaways` to `makeSummaryResponse()`'s default (realistic — production returns them → existing tests run the both-present path, no fallback); (b) add a defensive default `mockExtractQuickView.mockResolvedValue({...})` in `beforeEach`; (c) audit existing tests and update any asserting callout-absence or exact `.md` content (most use `toContain`, so expected churn is small; `:561` asserts the callout is PRESENT and still passes).
- **M6a — index-invariant test.** Added an ingestion-level case: when generateSummary omits tldr/takeaways, `mockUpsertVideo` receives the DERIVED tldr/takeaways (proves the index, not just the return value, is consistent).
- **M7b — migration idempotency.** Eligibility is grounded on **`.md` callout presence** (grep `> [!summary] Quick Reference`), not the index `!tldr` flag; `insertQuickViewCallout` already no-ops on an existing callout. For docs with the callout but missing index `tldr`, just `updateVideoFields` (no Gemini).
- **M7c — migration safety.** Dry-run/print first; verify both fields returned before writing; rely on git for the corpus (it's the separate data repo — back up the 7 .md or confirm restorable).
- **L2** — both branches call `insertQuickViewCallout(baseContent, …)` (same base; only the tldr/takeaways source differs) → identical placement. Stated.
- **L6c** — ensure/repair fallback path is intentionally unit-only (ensure.test.ts mocks `lib/pipeline` wholesale); noted.

## Verified-correct (reviewer + my checks)
- **L3 resolved:** `updateVideoFields` does `{...video, ...safeFields}`; `tldr: undefined` is spread but `JSON.stringify` omits undefined keys → on-disk index has no `tldr` → consistent with no-callout md, and backfill-eligible. No issue.
- Both `writeSummaryDoc` callers persist the returned values: `runIngestion` (`...(tldr!==undefined && {tldr})`), `ensureHtmlDoc` (`updateVideoFields({... tldr: r.tldr, takeaways: r.takeaways})`). ✓
- `insertQuickViewCallout` idempotency (`:240`) + insert position (first `\n\n---\n`) confirmed.
- Cost: extractQuickView fires only on the omission path (rare); worst case 2 summary calls (timestamp guard) + 1 extract. Acceptable.
- `regenerate/route.ts` does NOT call `writeSummaryDoc` → unaffected. No hidden consumer assumes tldr came from generateSummary specifically.
