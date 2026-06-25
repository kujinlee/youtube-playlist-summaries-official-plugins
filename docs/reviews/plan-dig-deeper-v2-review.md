# Adversarial Review — Dig-Deeper v2 Implementation Plan

**Reviewer:** Claude (adversarial subagent, fresh context, full file access)
**Date:** 2026-06-24
**Plan:** `docs/superpowers/plans/2026-06-24-dig-deeper-in-place-expansion.md`
**Codex:** at usage limit (until Jul 18) — Claude review per fallback policy.

## Verdict: NOT ready to execute (as written). Must-fix below; plan revised to r2.

### BLOCKING
- **B1 — second `renderDigDeeperHtml` caller unhandled.** `app/api/videos/[id]/dig/[sectionId]/route.ts:177` renders the companion to HTML and writes `<base>-dig-deeper.html` (`:180`) + stamps `digDeeperHtml` in the index (`:183-186`). Under the merge model (fresh render on every GET, §9 M-5) this cache is **dead**. The T6 signature change breaks this caller (tsc fail) and `dig-post.test.ts:309` mis-passes via mock. **Missing task.**
- **B2 — T9 before T10 breaks digging on both surfaces.** T9 removes summary-side POST; T10 adds dig-doc generation. Between commits, clicking `dig deeper ▶` navigates to the dig doc with `?dig=N` and nothing generates. Reorder: dig-doc generation must land **before** the summary-side flip.

### HIGH
- **H1 — `render.ts` unassigned + 3 controls vs 2 overloads.** Summary nav link, dig-doc in-place trigger, and `↑ summary` back-link are three distinct controls; `digControl` has two overloads. T9 lists only `nav.ts`, but `render.ts:83` emits the summary control markup. Assign `render.ts`; specify each control's emitter.
- **H2 — `outerHTML` swap kills listeners.** T10's swap of a section node discards its event listeners → the `show summary/show dug` toggle is dead until reload. Use **event delegation** on the `.dg` container so swaps survive; document companion-write-before-`done` ordering as the correctness premise.
- **H3 — removing `target="_blank"` breaks shipped 2a3bfc7 tests.** `nav.test.ts:411-444` (Issue-#3 new-tab) + ~10 POST/SSE/force-redig describe blocks assert the old summary machine. The summary task must **enumerate these as deleted**, not patch.
- **H4 — T1 bump breaks `render.test.ts:33` (`v1`); E2E fixtures use old 2-arg signature.** T1 must update `render.test.ts:33`. T13 (E2E) is a **rewrite**, not an extend — the harness serves a static companion HTML string incompatible with merge-from-inputs.

### MEDIUM
- **M1 — `parseDugSections` must read frontmatter (startSec, generatedAt) AND body (title, bodyMarkdown).** Make a pure `parseDugSections(content)` inner that `readCompanionDoc`+`readDugSectionIds` delegate to (today `readCompanionDoc` is async+fs).
- **M2 — T3 match on `DugSection.sectionId`** (stable stored key) consistently; name the field in behaviors.
- **M3 — T8 needs a generic `assertWithin(outputFolder, path)`**, not the `htmls/`-specific `guard()`/`HTML_REL_RE` (summary `.md` + `models/*.json` aren't under `htmls/`).
- **M4 — expand-all × full-doc re-GET per section is quadratic** in base64 payload; note it or do a single final re-GET.
- **M5 — summary-side `pageshow` unassigned** (spec §5 requires it on both pages).

### LOW
- L1 rerender union consumers (`reRenderAll`) safe (read `.status` only); confirm no full-object snapshot tests. L2 T2 tests must use real serializer output. L3 `digVersion` no-bump consistent. L4 verify baseline `npm test` count before T1.

## Disposition
Plan revised to r2: additive new renderer `renderDigDeeperDoc` (no simultaneous signature break); reordered tasks (dig-doc generation before summary flip; POST-route cleanup as its own task; old `renderDigDeeperHtml` removed only after GET migrates); `render.ts` assigned; event delegation mandated; obsolete-test deletions enumerated per task; generic `assertWithin`; `parseDugSections` reads frontmatter+body; summary-side `pageshow` added; baseline-count check added.
