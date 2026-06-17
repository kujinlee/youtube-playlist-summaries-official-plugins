# Adversarial Plan Review — Persist Magazine Model (3a)

**Date:** 2026-06-17
**Plan:** `docs/superpowers/plans/2026-06-17-persist-magazine-model.md`
**Spec:** `docs/superpowers/specs/2026-06-17-persist-magazine-model-design.md`
**Reviewer:** Claude fresh subagent (general-purpose, no authorship context)

> **⚠️ Codex gap:** Codex (`codex:rescue`) is the mandated plan-gate reviewer but is usage-limited
> until **2026-07-03**. Per `docs/plugins.md` fallback, this Claude adversarial review substitutes;
> a **manual Codex pass before merge** is owed.

---

## BLOCKING

### B1 — Write/read schema asymmetry: `generate` persists a model `readModelEnvelope` rejects
`writeModelEnvelope` does not validate; `readModelEnvelope` validates against `MagazineModelSchema`
(bullets **3–7**). Every test mocks the transform with **1 bullet** per section (existing
`generate.test.ts` fixtures + the plan's Task 2 fixture). So `generate` writes a 1-bullet model
file whose write-test passes, but that same file fails `safeParse` on read → `null` →
`skipped-no-model`. The write and read paths disagree on validity, and no test exercises a
generate→read round-trip, so the contract is never verified.
**Fix:** (a) `writeModelEnvelope` calls `ModelEnvelopeSchema.parse(envelope)` before writing (fail
loud on invalid); (b) fix all fixtures to ≥3 bullets — Task 2 new test, **and the two existing
`generate.test.ts` fixtures** (which will start throwing once `generate` validates — see M1).

---

## HIGH

### H1 — Drift guard is necessary but not sufficient (silent mis-render)
The guard `parsed.sections.length !== model.sections.length` only catches count changes.
`render.ts` zips `model.sections[i]` with `parsed.sections[i]` by **index**. If a `.md` edit
reorders or replaces sections while keeping the count, the guard passes and each section's
cached lead/bullets are pasted under the **wrong** heading — plausible but corrupt output, the
worst failure mode for a "trustworthy offline re-render."
**Fix:** persist the section identities the model was built against and verify them. Add
`sourceSections: string[]` (section titles) to the envelope; guard = deep-equal of
`parsed.sections.map(s => s.title)` vs `envelope.sourceSections` (subsumes the count check).
Note: only section *titles*/numerals and the model lead/bullets are rendered (section *prose* is
not), so this fully protects alignment while still letting non-title `.md` edits flow through.

### H3 — Stale orphan model can yield an index-unreferenced HTML
Model is written before HTML/index; on index-update failure the HTML is cleaned up but the model
persists with `summaryHtml` still `null`. A later `rerender` would then write an
`htmls/<base>.html` the index never references (serve route 404s on null `summaryHtml`).
**Fix:** gate `reRenderSummaryHtml` on `video.summaryHtml` being set — it only *re-renders an
existing* doc. A model with no current HTML → `skipped-no-model`. (With H1's title guard the
*content* is already safe; this fixes the reachability inconsistency.)

---

## MEDIUM

### M1 — No task to update the two existing `generate.test.ts` fixtures
Once `writeModelEnvelope` validates (B1), the existing 1-bullet transform fixtures throw inside
`runHtmlDoc`. The plan only *appends* tests. **Fix:** add a Task 2 step updating
`generate.test.ts:77-82` and `:110-115` to ≥3 bullets.

### M4 — `reRenderSummaryHtml` throws on a present-but-unparseable `.md` (undocumented outcome)
`parseSummaryMarkdown` throws on zero sections (confirmed `parse.ts`). `reRenderSummaryHtml` does
not wrap it, so a present-but-malformed `.md` throws — a 5th outcome not in `ReRenderResult` and
not in spec §6. Only `reRenderAll` catches it (as `error`).
**Fix:** wrap the parse, add `skipped-unparseable` to the result union, document in §6, and adjust
the batch test (the `'# Just a title'` case becomes a defined skip, not an unexpected error).

---

## LOW

- **L1 — generate.ts `base` move (CLEAN):** the later `const base` exists at generate.ts:46 exactly
  as the plan describes; moving it earlier compiles, narrowing survives the `await`. No issue.
- **L2 — path-safety (accepted):** `base` from `summaryMd` is interpolated into a path with no
  `basename` guard; a malicious index could escape `models/`. Pre-existing for `htmls/`; index is
  locally trusted. Accepted-low; noted in spec.
- **L3 — malformed model is indistinguishable from absent:** both → `skipped-no-model`, and
  `readModelEnvelope` doesn't log on `safeParse` failure though spec §5 says "logged."
  **Fix:** `console.warn` on `safeParse` failure (keep the single status; no new status — YAGNI).
- **L4 — `generatedAt` non-deterministic (accepted):** the *render* is deterministic, the envelope
  is not; the test only asserts `typeof string`. Don't ever assert an exact `generatedAt`.
- **M3/axis-5 (CLEAN):** `parseSummaryMarkdown` throws on zero sections — the batch test relies on
  this correctly.

---

## Must-fix before implementation
**B1** (write-validate + ≥3-bullet fixtures), **H1** (`sourceSections` title guard), **H3**
(`summaryHtml` gate), **M1** (existing-fixture step), **M4** (`skipped-unparseable`). L3 is a cheap
log add. L2/L4 accepted with a note.
