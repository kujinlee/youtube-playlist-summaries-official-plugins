# Adversarial Review: Dig-Deeper In-Place Expansion Design Spec

**Claude fallback (Codex at usage limit, resets Jul 18 2026)**
**Spec reviewed:** `docs/superpowers/specs/2026-06-24-dig-deeper-in-place-expansion-design.md`
**Date:** 2026-06-24
**Reviewer:** Claude Sonnet 4.6 (adversarial review fallback per project policy)

---

## NOTE

Codex CLI hit usage limit (resets Jul 18 2026). This is a Claude adversarial review per project fallback policy (`docs/plugins.md` §Code Review). Review conducted with full file access to all referenced source files.

---

## Findings

### BLOCKING

---

**B-1**
**Area:** 1 — Merge Model (sectionId drift / stale companion entries)
**Title:** Spec §3 does not define what happens when a companion sectionId no longer exists in the parsed summary

**Description:**
The spec states the summary drives structure ("the summary drives structure. Regenerating or retitling the summary automatically propagates to the dig doc on next render — no reconcile, no drift, no duplication"). The companion stores dug sections keyed by `sectionId = startSec` (the `▶` link's `&t=` value). If the user re-summarizes a video (e.g. video is re-timestamped, section is split/merged, or the user forces regeneration), section `startSec` values shift. The companion may then contain entries for `sectionId=312` where the summary now has no section with `startSec=312`.

Current `renderDigDeeperHtml` in `render-dig-deeper.ts` consumes only the companion; it has no awareness of the summary at all. It does not perform a merge — it renders whatever sentinel blocks are present. The spec's §3 claims render-time merge but the existing renderer is not yet a merge renderer. When the new renderer is built per §9, the spec does not describe what to do with orphan companion entries:
- Silently drop them? The user loses previously-dug content without warning.
- Show a warning banner? The spec is silent.
- Show them anyway at the end? That would violate "summary drives structure."

**No failure mode or reconciliation strategy is specified.** Two implementors will produce incompatible results. This is a blocking spec gap because it affects the core data model invariant.

**Suggested resolution:**
Add a subsection to §3 or §8: "Orphan companion entries (companion `sectionId` not found in the parsed summary) are silently dropped at render time, and a <!-- dig-orphan: N --> HTML comment is emitted for debuggability. No user-visible warning — the user can re-dig the section after re-summarization." Lock the decision before implementation begins.

---

**B-2**
**Area:** 3 — Version-gated re-render (GET writes to disk)
**Title:** The summary re-render path (§6) has no write guard against concurrent GETs on the same stale doc, creating a race window for partial-write exposure

**Description:**
§6 specifies: stale summary → re-render → rewrite cache file → serve. The spec acknowledges "a type=summary GET may write to disk" but accepts it as a tradeoff. The existing `app/api/html/[id]/route.ts` does not implement this — it reads the existing cached file unconditionally. When the new version-check logic is added, the following race occurs with two concurrent requests for the same stale slug:

1. Request A reads cache → detects stale → begins re-render.
2. Request B reads cache → detects stale → begins re-render (a second render).
3. Both write to `htmls/<slug>.html` (non-atomic — the route currently uses `fs.readFileSync`; the new write will use `fs.writeFileSync` or `fs.promises.writeFile`).
4. Whichever write lands last wins; both are correct HTML but the intermediate state (mid-write) is a corrupt file served to the losing request.

The existing `companion-doc.ts` solved this with `writeChains` (per-path mutex via Promise chain) and atomic write (temp file + `rename`). The spec does not mention applying equivalent protection to the summary cache rewrite.

Additionally, if the model file is missing during re-render (§8 says "graceful page: Summary unavailable"), the spec does not say whether the stale cache is served instead or the error page is returned. These are two different UX choices.

**Suggested resolution:**
(a) Specify that the summary cache rewrite must use an atomic write (temp + rename), matching `companion-doc.ts`'s pattern.
(b) Add a per-slug in-memory mutex (Promise chain or a `Set<string>` of in-progress re-renders) so concurrent requests for the same stale slug collapse to one render + one write.
(c) Specify: if re-render fails (model missing), serve the stale cache with a response header `X-Cache: stale-fallback` rather than returning an error — the stale cache is better than a 500 for a single-user local tool.

---

**B-3**
**Area:** 4 — `?dig=<startSec>` auto-trigger
**Title:** Auto-trigger on load has no specified behavior when the section is already dug — the spec says "auto-trigger generation" but generation on an already-dug section wastes cost

**Description:**
§5 states: "`?dig=<startSec>` on load: auto-trigger that one section's generation and scroll to it." §8 states: "Double-trigger same section (`?dig=` + manual click) — existing job-lock prevents double-spend." But neither covers the case where `?dig=N` arrives and the section is already fully dug (companion entry exists).

The existing job-lock in `app/api/videos/[id]/dig/[sectionId]/route.ts` only prevents concurrent in-flight jobs — it does not prevent a POST to an already-dug section (no guard against `force=false` re-dig if job is not active). If the client POSTs to a completed section without `force:true`, the server starts a new generation job (wastes ~$0.05 + 30s). The spec says auto-trigger "auto-triggers generation" — if the nav.ts client posts unconditionally on `?dig=N`, it will re-dig completed sections on every page visit via that URL.

The URL Contracts table (§11) shows the `un-dug` control produces `?dig=<startSec>` URLs. But if the user navigates back from the dig doc and then forward again, or shares the URL, the link can arrive at an already-dug section and trigger redundant generation.

**Suggested resolution:**
Specify: the `?dig=<startSec>` handler in nav.ts must first check dig-state (GET dig-state API, which already exists) before POSTing. If the section is already dug, scroll to it and expand it in place with no generation. Only POST if the section is not yet dug. Add this check to §5 and to the §10 test cases.

---

### HIGH

---

**H-1**
**Area:** 2 — MagazineModel dependency
**Title:** §3 and §8 do not specify what happens when `models/<base>.json` has a different section count than the parsed summary

**Description:**
§3 lists the MagazineModel as a required render input (for per-section `lead` + `bullets`). §8 specifies: "Summary `.md` or model missing → graceful page." But it does not address the case where the model is present but stale — specifically when `model.sections.length !== parsed.sections.length`.

In `render.ts` (existing), the merge is index-based: `const m = model.sections[i]; if (!m) return '';` — mismatched sections silently drop sections from the output. The same risk exists in the new merge renderer. A summary with 8 sections and a model with 6 sections will silently omit the last 2 sections from the dig doc, giving the user no indication that content is missing.

The spec says "single source of truth — the summary drives structure" but the model is still required for the gist. If model and summary disagree on section count, the spec's invariant is violated silently.

**Suggested resolution:**
Add to §8 or §3: "If `model.sections.length < parsed.sections.length`, emit the over-run sections without a gist (omit `.gist` block; leave section skeleton only), and log a warning. Do not drop sections silently. Add a TODO comment in the rendered HTML for debuggability." This keeps the summary-drives-structure guarantee while gracefully degrading rather than silently omitting.

---

**H-2**
**Area:** 5 — Expand-all
**Title:** Expand-all partial-failure UX and abort semantics are underspecified — §5 and §8 are insufficient for implementation

**Description:**
§5: "already-dug sections skipped." §8: "Continue remaining; report failed sections at end; never abort the batch." Neither specifies:

1. **Where** the failure report appears. An inline banner? A toast? A list below the progress indicator? Two implementors produce incompatible UIs.
2. **How** the user can stop expand-all mid-flight. The spec says sequential generation with a progress indicator (`section k of N…`) but no cancel button or Escape-to-abort. If N=8 and each takes 30s, the user has no way to stop a 4-minute process. §12 (Overlay/Dismissal Contracts) mentions "Cancel / backdrop / Escape → Dismiss; no generation" for the confirm dialog only, not for the in-progress phase.
3. **Concurrency**: "sequential generation" implies serialized, but this is stated in §5 without a normative "MUST be sequential" or a max-concurrency number. An implementor could reasonably parallelize.
4. **Cost estimate accuracy**: §13 locks in a fixed heuristic (`remainingCount × $0.05` and `remainingCount × ~30s`). The estimate is shown before confirmation but the actual cost depends on section length. The spec accepts this but does not define whether the estimate is labelled as approximate in the UI (e.g. "~$X" is shown, which the spec lists — but the wording of the dialog text itself is not given, so two implementors produce different dialogs).

**Suggested resolution:**
Add to §12 a new row: "Expand-all progress indicator | Cancel button click or Escape | Abort after current section completes; report N completed + M failed to date." Specify in §5 that the progress indicator includes a Cancel button. Lock the failure report mechanism (e.g. "inline list below the progress bar, auto-dismissed after 5s or on user click"). Confirm "sequential (max-concurrency=1)" as normative.

---

**H-3**
**Area:** 6 — Same-tab nav
**Title:** Back-button behavior during an in-progress dig is unspecified — SSE connection lifecycle on navigation is not addressed

**Description:**
The spec redesigns all navigation to same-tab. The dig doc runs a POST→SSE state machine for in-progress sections. When the user navigates away (e.g. clicks `↑ summary`) while a section is generating:

- The SSE `EventSource` opened by nav.ts remains open in the background (or is closed by the browser on navigation, depending on whether it's the same document lifecycle). For same-tab navigation via `location.href`, the browser unloads the current document, which closes the EventSource — but the server-side job continues running (GRACE_MS = 15s cleanup). The dig generation completes server-side, writes to the companion doc, but the client never receives the `done` event.
- When the user navigates back (browser back button), the page may be served from bfcache. If bfcache is active, the EventSource listener is frozen; if not, the page reloads and re-fetches dig-state, which now shows the section as dug (correct outcome).
- The spec does not specify: should the dig doc show "generation in progress" to a user who arrives mid-flight (e.g. from a `?dig=N` URL while a job is already running)?

**Suggested resolution:**
Add to §5 or a new §5.5 "Navigation lifecycle": "On same-tab navigation away from the dig doc, the in-flight SSE is closed by browser unload; the server-side job continues. On return, the dig-state fetch reflects the completed status. No client-side resume of the SSE is required — the re-fetch on load is sufficient." Specify bfcache behavior: "Add a `pageshow` listener to re-fetch dig-state when `event.persisted === true`."

---

**H-4**
**Area:** 8 — Testing gaps
**Title:** Several key behaviors enumerated in the spec have no test layer assigned

**Description:**
§10 enumerates unit, component, and E2E test cases, but the following enumerated behaviors have no assigned test layer:

1. **Orphan sectionId handling** (companion entry with no matching summary section) — no unit test case listed. (Also a B-1 gap since the behavior is unspecified, but even if specified, no test is assigned.)
2. **Version-string extraction** from the cached HTML — listed as "version-gated re-render: current → cached served unchanged; stale/missing → re-render + rewrite" in unit tests, but the regex/parser for extracting `<meta name="generator" content="magazine-skim vN">` is not mentioned as a discrete testable unit. The extraction logic is load-bearing and brittle.
3. **`?dig=<startSec>` with already-dug section** — §8 calls this a "double-trigger" addressed by job-lock, but the case of `?dig=N` for a completed section (not in-flight) has no test case in §10.
4. **Expand-all cancel** — no test layer assigned (also a gap in §12, H-2 above).
5. **`pageshow` bfcache re-fetch** (H-3 above, if added to spec) — no E2E test case.
6. **MagazineModel section-count mismatch** (H-1 above) — no unit test case listed.

**Suggested resolution:**
Add explicit test rows in §10 for each gap. The testing section currently groups behaviors rather than listing them one-to-one with the §8 error table and §5 interaction table — a more explicit mapping would make gaps visible during implementation.

---

### MEDIUM

---

**M-1**
**Area:** 3 — Version-gated re-render
**Title:** The spec bumps `magazine-skim v1` → `v2` but the existing code in `render.ts` already emits `magazine-skim v1` — the version-bump discipline requirement is described but not enforced

**Description:**
§6: "bump the `magazine-skim vN` string whenever the summary HTML output changes (an implementation checklist item)." This is a human-process discipline, not a code enforcement. The existing `render.ts` emits `content="magazine-skim v1"` (verified in source). If a future renderer change is made without bumping the version, all stale caches will never self-heal. The spec accepts this as a discipline item but provides no tooling suggestion (e.g. a lint rule, a test that reads the cached HTML and compares against the renderer's `GENERATOR_VERSION` constant).

**Suggested resolution:**
Add to §9 or §10: export a `GENERATOR_VERSION = 'magazine-skim v2'` constant from `render.ts`, referenced in the `<meta>` tag and in the version-check logic in the route. Add a unit test that asserts the constant value matches the `<meta>` tag in the rendered output — so any future version bump propagates to both.

---

**M-2**
**Area:** 4 — `?dig=<startSec>` auto-trigger
**Title:** Scroll-anchoring behavior is ambiguous when `startSec` changes between summary and dig renders

**Description:**
§11 URL Contracts: the `dig deeper ▶` link appends `#t=<startSec>` and the dig doc scrolls to the section with `data-start="<startSec>"`. If the summary is re-summarized and the section's `startSec` changes (e.g. from 312 to 318 due to timestamp re-resolution), the URL fragment `#t=312` will not find a section anchor in the new dig doc (which now has `data-start="318"`). `scrollToHashSection` in nav.ts uses `Math.max(...starts.filter(s => s <= sec))` which falls back to the closest preceding section — potentially scrolling to the wrong section silently.

This is a lower-risk case (requires re-summarization of an already-dug doc) but it is an observable UX failure with no specified fallback.

**Suggested resolution:**
Low-risk acceptance is reasonable. Add a note in §5 or §11: "If `#t=<sec>` does not exactly match a `data-start` value, `scrollToHashSection` uses the closest preceding section — acceptable fallback for the single-user local tool use case."

---

**M-3**
**Area:** 7 — Security
**Title:** The dig doc route does not derive `<base>` from a validated server-side source — it reads `video.digDeeperMd` from the index, which is written by the generation pipeline using a caller-derived basename

**Description:**
In `app/api/html/[id]/route.ts`, `type=dig-deeper` reads `video.digDeeperMd` from the index and resolves it as `path.resolve(outputFolder, video.digDeeperMd)`. The `digDeeperMd` field is written in `runDigPipeline` (Step 13) as `${summaryBasename}-dig-deeper.md` where `summaryBasename = path.basename(summaryMdName, '.md')` and `summaryMdName = video.summaryMd ?? ${videoId}.md`.

`assertVideoId` is called, but `video.summaryMd` is stored in the index and could theoretically be a path with `../` components if the index itself is tampered with (local tool, so risk is low). The existing `guard()` function in the route checks the path stays within `htmlDir`, but for the `dig-deeper` type the guard is not called — `mdAbsPath` is constructed directly without a guard call.

**Suggested resolution:**
This is a low-severity finding for a single-user local tool, but for consistency: apply the same guard pattern used for `type=summary` to `type=dig-deeper`. Assert that `mdAbsPath` starts with `outputFolder + path.sep`. The spec (§4) mentions the existing path-containment check is retained — clarify that it applies to all three `type` values, not just the `assets/` inlining in `render-dig-deeper.ts`.

---

**M-4**
**Area:** 9 — Contradictions
**Title:** §3 says companion format is "unchanged" but §9 notes `render-dig-deeper.ts` is "reworked" to produce a new merge output — the existing renderer produces old-format output (no gist blocks, no toggle state)

**Description:**
§3: "The companion `<base>-dig-deeper.md` remains a delta store of only dug sections — its sentinel-delimited format is unchanged." §9: `render-dig-deeper.ts (reworked) — Merge summary + model + companion → full-structure HTML; per-section gist/dug blocks."

The companion `.md` format is indeed unchanged (only dug sections, sentinel blocks). But the _rendered HTML_ output changes substantially (from "render companion sections only" to "render ALL summary sections with gist/dug blocks"). The existing `renderDigDeeperHtml` function in `render-dig-deeper.ts` does not accept `parsedSummary` or `MagazineModel` as inputs — it only takes `mdContent` (companion) and `mdPath`. The function signature must change.

The `app/api/html/[id]/route.ts` `dig-deeper` path currently calls `renderDigDeeperHtml(mdContent, mdAbsPath)`. After the rework, it will need to also pass the parsed summary and model — requiring the route to additionally read `<base>.md` and `models/<base>.json`. The spec §9 assigns this to `render-dig-deeper.ts` but does not update the route's responsibility list or its `Depends on` column.

**Suggested resolution:**
Add to §9, `app/api/html/[id]/route.ts` row: "For `type=dig-deeper`: additionally reads `<base>.md` (parsedSummary) and `models/<base>.json` (MagazineModel), passing all three inputs to the reworked renderer." Update the `Depends on` column accordingly. This ensures the implementor updating the route knows what additional reads are required.

---

**M-5**
**Area:** 3 — Version-gated re-render
**Title:** The `type=dig-deeper` route currently calls `renderDigDeeperHtml` on every GET (no cache) — spec §6 only addresses the summary cache; the dig-deeper render path is undiscussed

**Description:**
The current `app/api/html/[id]/route.ts` for `type=dig-deeper`: reads the companion `.md` and calls `renderDigDeeperHtml` on every request — no caching, no HTML file served. After the §3 rework, the renderer will need to additionally read the summary `.md` and model `.json` on every GET. For large summaries with many sections, this becomes a meaningful per-request cost.

The spec's §6 (stale summary HTML, version-gated lazy re-render) applies only to `type=summary`. There is no caching strategy specified for `type=dig-deeper`. The dig doc HTML is written to disk by the generation pipeline (Step 12 in `runDigPipeline`) but the route does not serve the cached HTML file — it re-renders on every GET.

**Suggested resolution:**
Decide and specify in §6 or §9: does the `type=dig-deeper` route serve the cached HTML file (written by the pipeline) or re-render on every GET? If re-render: acknowledge the performance tradeoff. If cached: specify the invalidation trigger (new dig write → invalidate). Given the spec's goal of in-place expansion via client-side SSE injection (no full page reload needed after first render), re-render on every GET may be the simplest correct approach — but it needs to be explicitly stated.

---

### LOW

---

**L-1**
**Area:** 6 — Same-tab nav
**Title:** `nav.ts` `applyDugState` still sets `target="_blank"` on "view detail ↓" — contradicts spec §5's "no tab proliferation" goal

**Description:**
Spec §5: "Every navigation is same-tab. The `target='_blank'` added in `2a3bfc7` is removed from the dig control path." The existing `nav.ts` `applyDugState` function sets `el.setAttribute('target', '_blank')` on the "view detail ↓" link (verified in source, line ~31). The spec correctly identifies this as the bug to fix, but the inline `NAV_SCRIPT` string at the bottom of `nav.ts` also sets `target='_blank'` in its `applyDug` function. Both the TypeScript implementation and the duplicated inline script must be updated. The spec's §9 lists `render.ts` as the file to update for "per-section control → same-tab nav link" but does not mention `nav.ts` inline script.

The spec also notes in §5.1 (summary doc controls) that the control becomes a static `<a href=...>` link (not a POST→SSE). If the summary-side control is now a plain link with no `target`, the existing `initDigControls` POST→SSE state machine in `nav.ts` becomes partially obsolete for the `dug` state — the "view detail ↓" click path via the state machine is replaced by a static href. The spec should clarify whether `initDigControls` is removed from the summary page or retained for the `idle → loading → done` path only.

**Suggested resolution:**
Add to §9 `lib/html-doc/nav.ts (reworked)` row: "Remove `target='_blank'` from both `applyDugState` (TS) and the inline `applyDug` in `NAV_SCRIPT` (JS string). Confirm `initDigControls` is retained for summary-side idle→loading→done path; the dug state click becomes href navigation via the statically-rendered link."

---

**L-2**
**Area:** 9 — Contradictions
**Title:** The `↑ summary` top-bar URL in §11 includes an optional `#t=<startSec?>` fragment that is undefined — it is unclear which startSec this refers to

**Description:**
§11 URL Contracts table: `Dig doc top bar | ↑ summary | /api/html/<videoId>?outputFolder=<of>&type=summary#t=<startSec?>` — the `?` after `startSec` is ambiguous. It could mean:
(a) The fragment is optional (no fragment if no startSec is known).
(b) The startSec is the first section of the dig doc.
(c) The startSec is the currently-visible section in the dig doc (requires scroll-tracking).

The top bar is a static element (rendered once, not updated on scroll). Option (c) is not feasible without scroll tracking. The spec does not clarify.

**Suggested resolution:**
Clarify §11: "The `↑ summary` top-bar link omits the `#t=` fragment (links to top of summary doc, not to a specific section). The `?` in the URL Contracts table means the fragment is omitted." If per-section back-links are desired, they are provided by the per-section `↑ summary` link (already in `digControl('summary', sectionId)`), not the top bar.

---

**L-3**
**Area:** 5 — Expand-all
**Title:** The cost estimate heuristic ($0.05 per section) is listed in §13 but not surfaced in the E2E test for the confirm dialog — no test asserts the estimate string content

**Description:**
§10 E2E: "`expand all` → confirm → progress → all sections expanded." This test case as written does not assert the confirm dialog shows the correct count or estimate. The spec §13 locks the heuristic but no test validates it is displayed. If the `remainingCount` calculation is wrong (e.g. counts already-dug sections), the user sees an incorrect estimate with no failing test.

**Suggested resolution:**
Add to §10 E2E test case: "Assert confirm dialog text includes the remaining (un-dug) section count and the `~$X` / `~Y min` estimate computed from the heuristic. Test fixture must have a known count of un-dug sections."

---

## Overall Assessment

The spec is structurally sound and the core interaction model (render-time merge, same-tab nav, version-gated re-render) is well-motivated. However, it is **not fully implementable as written** — three blocking gaps must be resolved before tasking begins:

1. **B-1** (orphan sectionId reconciliation) and **B-3** (`?dig=N` on already-dug section) are data-model decisions that will produce incompatible implementations if left unspecified.
2. **B-2** (concurrent GET race on cache rewrite) is an architectural decision about write safety that should match the existing `companion-doc.ts` pattern.

The two HIGH findings (**H-1** MagazineModel section-count mismatch, **H-2** expand-all abort/failure UX) each require 2–3 new sentences in the spec to resolve. The **M-4** finding (route dependency update for the reworked renderer) is particularly important for the implementor to notice — the `dig-deeper` route will need additional file reads not currently reflected in §9's dependency table. Resolving all BLOCKING and HIGH findings, plus M-4, before implementation begins is recommended.
