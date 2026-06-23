# Quick Reference Callout — Fallback So It's Never Silently Skipped

**Date:** 2026-06-23
**Branch:** `fix/quick-reference-fallback`
**Status:** Design — pending adversarial review gate.

## Problem

The `> [!summary] Quick Reference` callout is inserted by `writeSummaryDoc` (`lib/pipeline.ts:68`) **only when both `tldr` and `takeaways` are present**:
```ts
const mdContent = (tldr && takeaways) ? insertQuickViewCallout(...) : baseContent;
```
`tldr`/`takeaways` come from `generateSummary`, where they are **optional** in the response schema — the model sometimes omits one or both. When it does, the callout is silently skipped. **7 of 269** summaries currently lack it (e.g. `hermes` has tldr but no takeaways; `ponytail` has neither).

This also caused a regression: my PR #17 timestamp repair **re-summarized** `n32qq7Kwzh0` (hermes), and that re-generation returned no `takeaways` → its Quick Reference callout was dropped. Any re-summarize/sync is exposed to this.

A backfill mechanism already exists (`app/api/quick-view/backfill/route.ts` → `extractQuickView` + `insertQuickViewCallout`), but it is an after-the-fact, user-triggered cure; newly-generated docs still ship without the callout until backfilled.

## Decision

Add a **fallback in `writeSummaryDoc`**: when `generateSummary` does not return both `tldr` and `takeaways`, derive them from the generated summary via the existing `extractQuickView`, then insert the callout. This guarantees the callout is present on every newly-generated/re-summarized doc, using the same primitive the backfill route uses.

**Behavior:**
- `generateSummary` returns **both** `tldr` && `takeaways` → unchanged (insert callout with those; no extra call).
- `generateSummary` returns **not both** (neither, or only one) → call `extractQuickView(baseContent)` to derive a consistent `{tldr, takeaways}` pair, insert the callout, and **return the derived values** (so the caller persists them in the index). The partial value from `generateSummary` is discarded in favor of the consistent derived pair.
- `extractQuickView` **throws** (Gemini failure after its own retries) → graceful: write the summary **without** the callout and return `tldr`/`takeaways` as `undefined`. A missing callout must never fail the whole summary.

**Argument:** pass **`baseContent`** (the full md: frontmatter + title + meta + summary), matching the two existing consumers `extractQuickView(mdContent)` (`backfill/route.ts:60`) and `extractQuickView(fixed)` (`regenerate/route.ts:62`) — same input contract as the backfill we mirror.

**Discard-on-throw is intentional and beneficial:** when generateSummary gave only `tldr` and `extractQuickView` then throws, persisting `undefined` (clearing `tldr`) keeps the doc **eligible for the existing backfill** (`backfill/route.ts:28` filters on `!v.tldr`). Keeping a lone `tldr` would make it backfill-ineligible AND callout-less forever.

**Control structure (pin this — the file write must NOT be skippable):**
```ts
let outTldr = tldr, outTakeaways = takeaways;
let mdContent: string;
if (tldr && takeaways) {
  mdContent = insertQuickViewCallout(baseContent, tldr, takeaways, tags ?? []);
} else {
  try {
    const qv = await extractQuickView(baseContent);
    outTldr = qv.tldr; outTakeaways = qv.takeaways;
    mdContent = insertQuickViewCallout(baseContent, qv.tldr, qv.takeaways, tags ?? []);
  } catch {
    mdContent = baseContent;            // no callout
    outTldr = undefined; outTakeaways = undefined; // discard partial → backfill-eligible
  }
}
await fs.promises.writeFile(path.join(outputFolder, `${baseName}.md`), mdContent, 'utf-8'); // OUTSIDE the catch
return { language, ratings, overallScore, videoType, audience, tags, tldr: outTldr, takeaways: outTakeaways, mdContent, summaryMd: `${baseName}.md` };
```
Both branches call `insertQuickViewCallout(baseContent, …)` (same base — identical placement; only the tldr/takeaways source differs).

`extractQuickView` is a second Gemini call, but it fires **only** when `generateSummary` omitted the fields (rare) — a targeted, cheaper fallback than re-rolling the entire summary JSON. (Worst case: 2 summary calls from the PR#17 timestamp guard + 1 extract.)

## Why here (not a generateSummary retry)

The timestamp guard (PR #17) retries `generateSummary` on missing ▶. Retrying for missing tldr/takeaways would re-roll the whole summary (ratings, sections, …) when the summary itself is fine — wasteful. `extractQuickView` targets exactly the missing fields from the already-good summary text, and is the same function the backfill route trusts.

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/pipeline.ts` `writeSummaryDoc` | fallback to `extractQuickView` when generateSummary omits tldr/takeaways; persist derived values | Modify |

`extractQuickView`, `insertQuickViewCallout` unchanged. No signature change to `writeSummaryDoc` (its result already carries `tldr`/`takeaways`). All `writeSummaryDoc` callers (runIngestion, ensure/repair via `ensureHtmlDoc`) automatically benefit.

## Migration

After merge, backfill the affected summaries with a throwaway script (env sourced), grounded on **`.md` content**, idempotent:
- Eligibility = summaries whose `.md` does **not** contain `> [!summary] Quick Reference` (grep the file, NOT the index `!tldr` flag — they can differ).
- For each: read `.md` → `extractQuickView(mdContent)` → `insertQuickViewCallout` (no-ops if already present) → write `.md` → `updateVideoFields({tldr, takeaways})`. No re-summarize.
- **Dry-run/print first** (list eligible ids + which lack the callout); verify both fields returned before writing; the data repo is git-tracked separately, so confirm restorable / back up the touched `.md`.
- Then verify every previously-eligible `.md` now contains the callout.

## Testing (TDD — mock `lib/gemini`)

`tests/lib/pipeline.test.ts` already mocks `lib/gemini` wholesale; add `mockExtractQuickView = jest.mocked(gemini.extractQuickView)`.

**Blast-radius guard (do this FIRST):** `makeSummaryResponse()` currently omits tldr/takeaways, so once the fallback exists ~30 existing ingestion tests would reach `extractQuickView`. → (a) add `tldr: 'This video …'` + `takeaways: ['a','b']` to `makeSummaryResponse()`'s default (realistic — production returns them → existing tests stay on the both-present path, no fallback); (b) add a defensive `mockExtractQuickView.mockResolvedValue({ tldr: 'QV tldr', takeaways: ['qa','qb'] })` in `beforeEach`; (c) run the full suite and update any existing test that asserted callout-absence or exact `.md` content (most use `toContain`; `:561` asserts the callout PRESENT and still passes).

Test `writeSummaryDoc` directly (it is exported):
1. **Both present → no fallback:** generateSummary returns tldr+takeaways → assert `mockExtractQuickView` NOT called; `.md` has the callout with those; result carries them.
2. **Neither present → fallback inserts:** generateSummary returns no tldr/takeaways; `extractQuickView` resolves `{tldr:'X', takeaways:['a','b']}` → assert `mockExtractQuickView` called once **with `baseContent`** (the full md — assert it contains the frontmatter/title); `.md` has the callout with X/a/b; result `.tldr==='X'`.
3. **Only one present (hermes) → fallback derives both:** generateSummary returns tldr only → fallback fires; callout present with derived values; partial tldr discarded.
4. **extractQuickView throws → graceful:** generateSummary omits both, `extractQuickView` rejects → `.md` written WITHOUT the callout, `writeSummaryDoc` RESOLVES (no throw), result tldr/takeaways `undefined`.
5. **Index invariant (ingestion-level, M6a):** via `runIngestion` with generateSummary omitting tldr/takeaways and extractQuickView resolving → assert `mockUpsertVideo` receives the DERIVED tldr/takeaways (proves the index — not just the return — is consistent).
6. **Regression:** existing callout-present/frontmatter/tags tests stay green.

Full `npm test` + `npx tsc --noEmit` green before commit. Dual review per task.

## Out of scope

- Changing `generateSummary`'s schema/prompt (tldr/takeaways stay optional there; the fallback handles omission).
- The backfill route/UI (unchanged; still available for older docs).
- The other ~? older summaries missing the callout beyond the audited 7 from older doc versions (they re-gen lazily and now get the fallback; a corpus-wide backfill is the user's optional call, not in this fix).
