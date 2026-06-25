# Adversarial Review — Dig-Deeper v2 (In-Place Section Expansion) — Spec

**Reviewer:** Claude (adversarial subagent, fresh context, full file access)
**Date:** 2026-06-24
**Spec:** `docs/superpowers/specs/2026-06-24-dig-deeper-in-place-expansion-design.md`
**Codex status:** Codex adversarial review dispatched in parallel; this Claude review ran as
the primary gate per the project's Codex-fallback rule (Codex at usage limit throughout PR #23).
Re-attempt Codex before merge if access returns.

---

## Verdict (as received)

**Not ready to plan against until 2 BLOCKING issues are resolved.** The core premise
("summary drives structure, no reconcile, no drift") is unsound because the gist is keyed
positionally (`model.sections[i]`) while dug content is keyed by `startSec`, and the two are
never reconciled. A timestamp-shifting re-summarize silently orphans dug content.

Required before planning: (1) explicit section-keying contract + orphan handling, (2) map
every `ReRenderResult` status to a GET outcome reusing `rerender.ts`, (3) concrete nav.ts
dual-source mitigation, (4) verify "no migration" against the 7 real companion files. Close
the HIGH items (version-bump enforceability, `?dig` re-trigger) in the same pass.

---

## Findings (verbatim, prioritized)

### [BLOCKING 1] Gist keyed by array index, dug content by sectionId; never reconciled
`model.sections[i]` is positional (no id, no title — `types.ts:43-49`, `render.ts:75`); dug
overlay matched by `sectionId = startSec`. Aligns only when parsed/model/companion all
describe the same section, with no invariant guaranteeing it. Sections without a `▶` line
have `timeRange === null` (`parse.ts:23,39`) → **no `startSec`**; §3/§4 assume every section
has one. What `data-start`/`data-dug` does a timestamp-less "Conclusion" get? Unspecified.
**Fix:** state the keying contract; render un-dug gist by index, attach dug overlay only when
a companion `sectionId === startSec`; define `startSec === null` behavior (gist-only, no dig
affordance — matches today's summary). Add an Enumerated-Behaviors row for "no timeRange."

### [BLOCKING 2] Re-summarize that shifts timestamps silently orphans dug content
`sectionId = startSec`. Re-summarize can shift a section's `startSec` (transcript-token
resolver); the frozen companion `sectionId` then matches no summary section → dug elaboration
(expensive Gemini + slides) **silently vanishes**, no error/placeholder/log. `scrollToHashSection`
(`nav.ts:231`) could mis-scroll a `?dig=` deep-link to an adjacent section. The summary
re-render path already guards this via `sameTitles(... envelope.sourceSections)`
(`rerender.ts:56`, returns `skipped-drift`); the dig merge has no equivalent.
**Fix:** detect companion `sectionId`s with no matching summary section; render them visibly
(orphan notice / re-dig), never drop. Add §8 row + unit test. Consider title-based matching
(reuse `sameTitles`) as the more robust key.

### [HIGH 3] Spec reinvents `reRenderSummaryHtml`; collapses its 6-way status union
`rerender.ts` already implements stale re-render with atomic temp+rename (`:64-67`) and
returns `rerendered | skipped-not-eligible | skipped-no-model | skipped-no-md |
skipped-unparseable | skipped-drift`. §6/§8 collapse all failures to two outcomes. What is
served when stale **and** `skipped-drift` (→ would serve stale, #1 bug persists undetected) or
`skipped-no-model` (cached HTML is servable as-is; "unavailable" is too harsh)?
**Fix:** map every `ReRenderResult` to an explicit GET outcome; if a cached HTML exists, serve
stale on any skip/throw rather than 500/"unavailable"; only "regenerate" when no servable
artifact exists. Reuse `reRenderSummaryHtml`.

### [HIGH 4] Concurrent GET cache-rewrite: read-side not specified
Temp+rename is atomic (readers see a whole file; double re-render idempotent, last-writer-wins).
But the spec never states this, and the route must serve the **re-rendered HTML string**, not
re-read disk post-write (avoids interleaving). `reRenderSummaryHtml` currently returns a path,
not the html — needs to also return the rendered string, or route reads once accepting
last-writer-wins.
**Fix:** spec the serve path to use the returned HTML buffer; add the atomicity note.

### [HIGH 5] "Bump magazine-skim vN" discipline is unenforceable/untested
Human-memory checklist fails silently → permanent stale-but-current caches, re-introducing #1
with no test. No automated link between "output changed" and "version changed."
**Fix:** single exported version constant referenced by both renderer (`render.ts:104` literal)
and route; guard/snapshot test asserting the generator version is present and equals the
constant, and that the route comparator treats `v1` as stale vs current.

### [HIGH 6] nav.ts dual-maintenance expansion is the biggest structural risk
TS module (jsdom-testable) + hand-duplicated inline `NAV_SCRIPT` (`:245-345`, DRIFT WARNING,
untested). This spec substantially expands both (summary loses POST/SSE+`target=_blank`; dig
side gains a new state machine: inject `.dug`, toggle, expand-all, `?dig=`). Large new logic
written twice, larger half untested.
**Fix (must choose concretely, §9):** (a) build the inline script from one TS source; or
(b) make E2E the contract for the inline path + a structural parity check. Without one, the
new logic is effectively untested.

### [HIGH 7] `?dig=<startSec>` auto-trigger: back-button/already-dug/failure-loop underspecified
Already-dug + `?dig` (stale bookmark/back-nav) → re-POST or scroll? Back/reload re-fires
generation after the job-lock `GRACE_MS=15_000` expires. Failure + reload → loop?
**Fix:** dug + `?dig` ⇒ scroll only, no POST; `history.replaceState` to strip `?dig` after
firing; auto-trigger fires at most once per load; on failure surface ⚠, no auto-retry. Add §8
rows.

### [MEDIUM 8] expand-all: cancel / navigate-away / concurrency not in error matrix
No abort path once sequential generation starts. Same-tab nav means clicking away mid-batch
is now easy. Cost time-estimate (30s/section) unvalidated; could mislead on slow yt-dlp/ffmpeg.
**Fix:** §8/§12 rows for mid-batch cancel (stop after current; persist partial) and
navigate-away; serialize and skip already-dug + in-progress; mark time estimate "rough."

### [MEDIUM 9] missing-asset: contradiction + escaping distinction
Current renderer returns `''` (drops img) at `render-dig-deeper.ts:99,106`; §4 now wants a
`.missing-slide` placeholder. Containment-failure (`:99`, traversal) must **still drop
silently** (no attacker-controlled alt text); only benign missing-file (`:103`) gets the
placeholder with `esc(alt)` (already escaped at `:108`).
**Fix:** §4 specify both branches; unit test for each.

### [MEDIUM 10] derived path containment not stated
`<base>.md`, `models/<base>.json`, `assets/` derived by stripping `-dig-deeper.md`. If `<base>`
contains a separator/`..` the reads escape `outputFolder`. Asset path has a containment check;
the new derivations have none.
**Fix:** `path.resolve` + assert-within-`outputFolder` for all derived paths (reuse
`route.ts:51` pattern); take `<base>` from the index field, not a URL.

### [MEDIUM 11] "No migration" unverified against the 7 real companions
Holds only if each companion's `startSec` still matches its summary's current `startSec`.
The §6 self-heal re-renders summaries; a future re-summarize could orphan a companion section.
**Fix:** verify (script/test) all 7 companions' `sectionId`s match current summary `startSec`s
before locking the plan; add an E2E fixture using a real companion shape.

### [LOW 12] Removing `target="_blank"` drops two-tab compare — confirm intended
Same-tab fixes the unwanted-new-tab finding (#5). Per-section toggle replaces in-tab compare.
Confirm no reliance on opening dig in a new tab. (Single-user tool — low risk.)

### [LOW 13] §8 error paths without assigned test layer
Orphaned dug section, `skipped-drift`-during-GET, `?dig` already-dug/reload, expand-all
partial-failure, expand-all cancel — none have test rows. Per dev-process, an §8 behavior with
no test layer means Enumerate is incomplete.

### [LOW 14] expand-all estimate depends on sound keying (BLOCKING 1/2)
Orphaned dug section counts as "remaining" → re-generated/re-charged. Resolve keying first.

---

## Disposition (how the spec will be revised)

All BLOCKING + HIGH addressed inline (spec v2 revision); actionable MEDIUM/LOW folded in.
"No migration" claim verified by script against the 7 companions before re-self-review.
Codex pass to be merged if it returns; otherwise re-attempt before merge.
