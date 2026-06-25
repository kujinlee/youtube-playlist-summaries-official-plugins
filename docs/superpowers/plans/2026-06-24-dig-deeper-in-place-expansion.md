# Dig-Deeper v2 — In-Place Section Expansion — Implementation Plan (r2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Each task follows the project Per-Task Checklist (docs/dev-process.md): enumerate behaviors → failing tests (RED) → implement (GREEN) → full suite → Claude review → adversarial review → address → commit. Steps use `- [ ]`.

**Goal:** Make the dig-deeper doc a full mirror of the summary (all sections; gist by default; expandable in place per section), with same-tab navigation, robust section-keying, and a version-gated self-heal for stale summary HTML.

**Architecture:** Approach 1 — companion `.md` stays a thin delta-store (format unchanged); the dig doc is assembled at render time by a pure **merge** (`dig-merge.ts`) of parsed summary + model envelope + parsed companion, then rendered. All generation moves into the dig doc (summary side becomes nav-only). Stale summary HTML self-heals via `reRenderSummaryHtml` gated on a single `GENERATOR_VERSION`. The new dig renderer is introduced **additively** (`renderDigDeeperDoc`) so no signature break happens in one commit; the old `renderDigDeeperHtml` is removed only after both its callers migrate.

**Tech Stack:** Next.js (app router), TypeScript, markdown-it, Zod, jest+ts-jest (SWC — no typecheck; `tsc --noEmit` is the real gate), @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-24-dig-deeper-in-place-expansion-design.md` (read §3a, §5, §6). **Review addressed:** `docs/reviews/plan-dig-deeper-v2-review.md` (r2 fixes B1, B2, H1–H4, M1–M5).

## Global Constraints
- **AGENTS.md:** modified Next.js — read `node_modules/next/dist/docs/` before route/app code.
- **TDD:** tests first, fail for the right reason. Mock Gemini/yt-dlp/ffmpeg at lib boundary; E2E mocks at route level.
- **`tsc --noEmit` green** + **full `npm test` green** before every commit. **Run `npm test` once before T1 to record the true baseline count** (plan assumes ~1211; verify — 2a3bfc7 just landed).
- **nav.ts dual-source (spec §9):** new dig-doc client logic is **inline-only** in `NAV_SCRIPT`, contract-tested by Playwright E2E. Do **not** write a parallel TS copy of new logic. Summary-side edits touch both the TS helper and the inline string.
- **Event delegation:** the dig-doc inline script attaches click handlers on the stable `.dg` container (delegation), NOT per-node — so section `outerHTML` swaps after generation don't kill the toggle/trigger listeners (review H2).
- **Section-keying contract (spec §3a) is law** (see T3).
- Commit trailers: project Co-Authored-By + Claude-Session.

## Three distinct controls (review H1 — keep straight)
1. **Summary doc, per-section** (`render.ts` + `nav.ts`): same-tab nav link. un-dug `dig deeper ▶` → `…type=dig-deeper&dig=N#t=N`; dug `view detail ↓` → `…type=dig-deeper#t=N`. No POST, no `target`.
2. **Dig doc, per-section** (`renderDigDeeperDoc` + inline script): un-dug `dig deeper ▶` (POST-on-click, in-place expand); dug `show summary ⌃`/`show dug ⌄` (CSS toggle).
3. **Dig doc, top bar** (`renderDigDeeperDoc`): `↑ summary` (same-tab → `type=summary`, no `#t`) + `⤢ expand all`.

## File Structure
| File | Responsibility | Change |
|---|---|---|
| `lib/html-doc/render.ts` | summary render; owns `GENERATOR_VERSION`; summary nav-link control markup | modify (T1, T13) |
| `lib/dig/companion-doc.ts` | delta-store; pure `parseDugSections` | modify (T2) |
| `lib/html-doc/dig-merge.ts` | pure §3a merge | **create** (T3) |
| `lib/html-doc/rerender.ts` | export `sameTitles`; return html in `rerendered` | modify (T3, T4) |
| `app/api/html/[id]/route.ts` | summary version-gate; dig-deeper merge | modify (T5, T8) |
| `lib/html-doc/render-dig-deeper.ts` | new `renderDigDeeperDoc(args)`; asset split; remove old fn (T9) | modify (T6, T7, T9) |
| `app/api/videos/[id]/dig/[sectionId]/route.ts` | drop dead HTML render/write | modify (T9) |
| `lib/html-doc/nav.ts` | dig-doc inline state machine; summary nav links | modify (T10–T13) |
| tests across `tests/lib/html-doc`, `tests/lib/dig`, `tests/api`, `tests/e2e` | per task | create/modify |

---

## Task 1: GENERATOR_VERSION constant + bump v2
**Files:** Modify `lib/html-doc/render.ts` (meta ~:104); Test `tests/lib/html-doc/render.test.ts` (**update `:33` which asserts `magazine-skim v1`**).
**Produces:** `export const GENERATOR_VERSION = 'magazine-skim v2';`
**Behaviors:** (1) rendered HTML contains `content="magazine-skim v2"`; (2) constant exported and equals that string.
- [ ] Run `npm test` once; record baseline count in the commit message.
- [ ] Update `render.test.ts:33` expectation to `v2`; add assertion that output contains `content="${GENERATOR_VERSION}"`. Run → fails (still v1).
- [ ] Implement constant + meta interpolation. Targeted test → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): single GENERATOR_VERSION constant, bump magazine-skim v2`.

## Task 2: companion-doc — pure `parseDugSections` (frontmatter + body)
**Files:** Modify `lib/dig/companion-doc.ts`; Test `tests/lib/dig/companion-doc.test.ts`.
**Produces:** `export function parseDugSections(content: string): DugSection[]` — a **pure** string→array that reads **both** frontmatter (`sectionId`, `startSec`, `generatedAt`, `title`) and body sentinel blocks (`title`, `bodyMarkdown`). `readDugSectionIds` and `readCompanionDoc` delegate to it (review M1: today `readCompanionDoc` is async+fs; extract its sync assembly core as `parseDugSections`).
**Behaviors:** (1) multi-block → N DugSections, ids in order, each with frontmatter `startSec`+`generatedAt` AND body `title`+`bodyMarkdown`; (2) `bodyMarkdown` excludes the `## ` line; (3) `### ` subheadings preserved; (4) no sentinels → `[]`; (5) unclosed sentinel → skipped, no throw; (6) `readDugSectionIds(content)` === `parseDugSections(content).map(s=>s.sectionId)`.
- [ ] Tests 1–6 using **real serializer output** (build a companion via `upsertDugSection` or the real shape from §7), not hand-rolled strings (review L2). Run → fail.
- [ ] Refactor: extract pure core; delegate. Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): pure parseDugSections (frontmatter+body) shared by readers`.

## Task 3: `dig-merge.ts` — keying contract (pure)
**Files:** Create `lib/html-doc/dig-merge.ts`; export `sameTitles` from `lib/html-doc/rerender.ts`; Test `tests/lib/html-doc/dig-merge.test.ts`.
**Consumes:** `ParsedSummary`, `ModelEnvelope|null`, `DugSection[]`.
**Produces:**
```ts
export interface MergedSection { index:number; numeral:string|null; title:string; startSec:number|null; gist:{lead:string;bullets:{text:string}[]}|null; dug:{bodyMarkdown:string}|null; }
export interface MergeResult { sections: MergedSection[]; orphans: {sectionId:number;title:string;bodyMarkdown:string}[]; }
export function mergeDigDoc(summary: ParsedSummary, envelope: ModelEnvelope|null, dug: DugSection[]): MergeResult;
```
**Keying rules (spec §3a):** one MergedSection per `summary.sections[i]` in order; `startSec = timeRange?.startSec ?? null`; **gist** = `envelope.model.sections[i]` only if envelope non-null AND `sameTitles(parsedTitles, envelope.sourceSections)` AND index in range, else `null`; **dug match** step 1 `DugSection.sectionId === startSec` (review M2 — match the stored `sectionId` field), step 2 fallback exact `title` to a not-yet-dug section; unmatched DugSections → `orphans`.
**Behaviors:** (1) 7 sections / 0 dug → 7 gists, no dug, no orphan; (2) dug by sectionId; (3) title-fallback re-anchor (sectionId≠startSec, title matches) → no orphan; (4) true orphan (id & title absent) → in `orphans`; (5) timeRange null → startSec null, gist set, no dug; (6) envelope null → all gist null; (7) `!sameTitles` → all gist null; (8) model shorter than summary → overflow gist null, no crash; (9) zero dug, model present → gists, no orphan.
- [ ] (Behaviors adversarial review — keying state machine, >8 behaviors.)
- [ ] Tests 1–9 (pure fixtures). Run → fail. Implement. Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): dig-merge keying contract (startSec→title→orphan, drift→skeleton)`.

## Task 4: `rerender.ts` — return html in `rerendered`
**Files:** Modify `lib/html-doc/rerender.ts` (`:72`); Test `tests/lib/html-doc/rerender.test.ts`.
**Produces:** `rerendered` variant → `{status:'rerendered'; htmlPath:string; html:string}`.
**Behaviors:** (1) `result.html` equals the string written + contains `GENERATOR_VERSION`; (2) other statuses unchanged; (3) `reRenderAll` still compiles/passes (reads `.status` only — review L1; confirm no full-object snapshot test).
- [ ] Tests. Run → fail. Capture rendered string, write it, return it. Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): reRenderSummaryHtml returns rendered html string`.

## Task 5: Summary route — version-gated re-render + status map
**Files:** Modify `app/api/html/[id]/route.ts` (`type==='summary'`, ~:59-68); Test `tests/api/html-route.test.ts`.
**Consumes:** `GENERATOR_VERSION` (T1), `reRenderSummaryHtml` `{html}` (T4).
**Logic:** read cached `summaryHtml`; extract `<meta generator content>`; if `===GENERATOR_VERSION` serve cached (do NOT call rerender); else call `reRenderSummaryHtml` → map: `rerendered`→serve `result.html`; `skipped-*`→serve stale cached + `console.warn`; cached-read-throws→404.
**Behaviors:** (1) current → cached, rerender NOT called; (2) stale+eligible → rerendered html (v2, dig controls); (3) stale+`skipped-drift` → stale cache, 200, warn; (4) stale+`skipped-no-model` → stale cache, 200; (5) missing file → 404; (6) null `summaryHtml` field → 404.
- [ ] Tests 1–6 (mock `reRenderSummaryHtml` per status; spy not-called when current). Run → fail. Implement. Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `fix(dig): version-gated summary re-render self-heals stale dig menu (#1)`.

## Task 6: `renderDigDeeperDoc(args)` — NEW additive merge renderer
**Files:** Modify `lib/html-doc/render-dig-deeper.ts` (**add** new export; leave old `renderDigDeeperHtml` intact for now); Test `tests/lib/html-doc/render-dig-deeper.test.ts` (add new describe block).
**Produces:** `export function renderDigDeeperDoc(args:{summary:ParsedSummary; envelope:ModelEnvelope|null; dug:DugSection[]; mdPath:string; videoId:string}): string`. Calls `mergeDigDoc`; reuses `buildRenderer(mdPath)` for body markdown + base64 images.
**Emits:** per MergedSection `<section data-start data-dug>`: `<h2>` title + muted ts link + control (un-dug `dig deeper ▶` class `dig-trigger data-section=N`; dug `show summary ⌃` class `dig-toggle`); `.gist` (lead+bullets; hidden when dug); `.dug` (rendered bodyMarkdown; shown when dug); skeleton (gist null) → no `.gist`. Top bar `<div class="dg-topbar">` with `↑ summary` (`<a class="dig" data-type="summary">`) + `⤢ expand all` (`<button class="dg-expand-all">`). Orphan region `<section class="dg-orphans">` when orphans exist. **#6 spacing CSS:** `section{padding:2.4em 0}`, `2px` top rule, `1.2em` around `.dug img`. **Toggle CSS:** `section[data-dug="true"] .gist{display:none}` default; `.show-gist .gist{display:block}` / `.show-gist .dug{display:none}`.
**Behaviors:** (1) all sections in order; (2) un-dug has `.gist`+`dig-trigger`; (3) dug has `.gist`(hidden)+`.dug`(shown)+`dig-toggle`; (4) timeRange null → no `data-start`/trigger, `.gist` shown; (5) skeleton → no `.gist`, trigger present if startSec; (6) orphan region rendered; (7) top bar once; (8) spacing CSS present.
- [ ] Tests 1–8 (merged fixtures). Run → fail. Implement (old fn untouched). Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): renderDigDeeperDoc merge renderer (additive; gist/dug/orphan/topbar)`.

## Task 7: missing-asset split (buildRenderer)
**Files:** Modify `lib/html-doc/render-dig-deeper.ts` (`buildRenderer` image rule ~:94-113); Test same file's test.
**Behavior (spec §4):** containment-fail → `''` (silent drop, unchanged); benign missing file → `<span class="missing-slide">${esc(alt)}</span>`; present → base64 (unchanged). Add `.missing-slide` CSS.
**Behaviors:** (1) present→base64 img; (2) missing→placeholder w/ escaped alt; (3) containment→`''`; (4) alt with `"`/`<` escaped.
- [ ] Tests 1–4. Run → fail. Implement (only the missing-file branch changes). Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): missing-asset placeholder (benign) vs silent containment-drop`.

## Task 8: dig-deeper GET route → `renderDigDeeperDoc` + assertWithin
**Files:** Modify `app/api/html/[id]/route.ts` (`type==='dig-deeper'`, ~:71-83); Test `tests/api/html-route.test.ts`.
**Logic:** `<base>` = basename(`video.digDeeperMd` or, when null, `video.summaryMd`) minus `-dig-deeper.md`/`.md`; resolve `summaryMdPath=<dir>/<base>.md`; `envelope=readModelEnvelope(outputFolder, base)`; `dug = digDeeperMd ? parseDugSections(read(digDeeperMd)) : []`. **New generic** `assertWithin(outputFolder, p)` (resolve + prefix-assert; review M3 — NOT the `htmls` `guard()`); apply to summaryMdPath + model path + digDeeperMd; violation → 400. Parse summary; call `renderDigDeeperDoc(...)`. Summary `.md` missing → "Summary unavailable" page (200, not 500). Render even when `digDeeperMd` null (skeleton).
**Behaviors:** (1) dug+un-dug merged; (2) zero/absent companion → skeleton, 200; (3) summary md missing → "Summary unavailable", 200; (4) model missing → skeleton-without-gist, 200; (5) crafted `..` base → 400; (6) orphan companion → orphan region.
- [ ] Tests 1–6 (temp-dir fixtures). Run → fail. Implement. Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): dig-deeper route merges summary+model+companion via renderDigDeeperDoc`.

## Task 9: POST route cleanup + remove old `renderDigDeeperHtml` (review B1)
**Files:** Modify `app/api/videos/[id]/dig/[sectionId]/route.ts` (remove HTML render/write ~:170-186 + `digDeeperHtml` index stamp); Modify `lib/html-doc/render-dig-deeper.ts` (delete old `renderDigDeeperHtml`); Tests: `tests/api/dig-post.test.ts:309` (rewrite — no longer renders HTML), remove old `renderDigDeeperHtml` tests in `render-dig-deeper.test.ts`.
**Rationale:** GET now renders fresh every time (T8); the pre-rendered `-dig-deeper.html` cache is dead. The POST route keeps `upsertDugSection` + SSE `done` (generation), only drops the HTML render/write. Old `renderDigDeeperHtml` is now unused (GET uses `renderDigDeeperDoc`, POST renders nothing).
**Behaviors:** (1) POST still upserts companion + emits `done` (unchanged generation); (2) POST no longer writes `<base>-dig-deeper.html`; (3) index no longer stamps `digDeeperHtml`; (4) `renderDigDeeperHtml` symbol gone — no remaining importers (grep clean); (5) `dig-post.test.ts` asserts companion write + done, not HTML write.
- [ ] Update tests to new expectations (RED). Run → fail. Remove dead code + old fn. Targeted → pass. `grep -rn renderDigDeeperHtml` returns only history. `tsc --noEmit`. Full suite.
- [ ] Commit: `refactor(dig): drop dead -dig-deeper.html cache; remove old renderDigDeeperHtml`.

## Task 10: dig-doc client — event-delegated in-place expand + toggle (inline-only)
**Files:** Modify `lib/html-doc/nav.ts` (inline `NAV_SCRIPT` — new dig-doc block, **delegation on `.dg`**); Test `tests/e2e/dig-deeper.spec.ts`.
**Behavior (spec §5, review H2):** detect `type=dig-deeper`. Delegate `click` on `.dg`: target `.dig-trigger` → POST `/api/videos/<id>/dig/<startSec>` → EventSource stream; on `done`, re-GET the dig-deeper HTML, parse, replace this `[data-start]` section's node with the fresh node (base64 slides included); flip `data-dug`. Because listeners are **delegated on `.dg`**, the swapped node's toggle works immediately. Target `.dig-toggle` → toggle `.show-gist` class on the section (zero fetch). On stream `error`/transport error → ⚠ retry on the trigger. **Correctness premise:** the POST job upserts the companion (`upsertDugSection`) before emitting `done`, so the re-GET reflects the new dug section.
**Behaviors (E2E):** (1) click `dig deeper ▶` → `.dug`+slide appears in place, control→`show summary ⌃`, no navigation; (2) toggle→summary; (3) toggle→dug; (4) POST 500 → ⚠ retry, stays un-dug.
- [ ] E2E 1–4 (mock dig POST/stream + dig-deeper GET at route level; renderer-driven fixture). Run → fail. Implement inline block + delegation. Targeted E2E → pass. `tsc --noEmit`. Full jest suite.
- [ ] Commit: `feat(dig): in-place expand + show/dug toggle (event-delegated)`.

## Task 11: dig-doc client — guarded `?dig=` + replaceState + pageshow
**Files:** Modify `lib/html-doc/nav.ts` (inline dig-doc block); Test `tests/e2e/dig-deeper.spec.ts`.
**Behavior (spec §5):** on dig-doc load with `?dig=N`: fetch `dig-state`; if N dug → scroll only, no POST; else trigger T10 generation for N once, then scroll. Always `history.replaceState` to strip `?dig` (keep `type`,`outputFolder`,`#t`). Fire once; failure → ⚠, no auto-retry. `pageshow` (`event.persisted`) → re-fetch `dig-state`, re-apply states.
**Behaviors (E2E):** (1) `?dig=N` un-dug → fires once, expands, URL stripped; (2) `?dig=N` already-dug → **no POST** (request spy), scroll, stripped; (3) reload → no re-POST; (4) bfcache back → `pageshow` re-fetch.
- [ ] E2E 1–4 (request spy). Run → fail. Implement. Targeted E2E → pass. `tsc --noEmit`. Full jest suite.
- [ ] Commit: `feat(dig): guarded ?dig (already-dug→no POST, replaceState, pageshow)`.

## Task 12: dig-doc client — expand-all (confirm + serialized + progress + cancel)
**Files:** Modify `lib/html-doc/nav.ts` (inline) + `render-dig-deeper.ts` (dialog markup/CSS); Test `tests/e2e/dig-deeper.spec.ts`.
**Behavior (spec §5/§12/§13):** `⤢ expand all` → confirm dialog `Expand N remaining sections? ~$X, ~Y min (rough estimate)` (N=un-dug w/ startSec; X=`(N*0.05).toFixed(2)`; Y=`Math.ceil(N*30/60)`). Confirm → serialized loop reusing T10 generate-and-swap, skipping already-dug/in-progress; progress `section k of N…`; **Cancel** stops after current section (persisted); failures collected + reported at end; auto-close on completion. To bound payload (review M4), do per-section swaps but a single final full re-GET is acceptable. Cancel/backdrop/Escape on confirm → dismiss, no generation.
**Behaviors (E2E):** (1) dialog shows count+`~$`+`~ min`; (2) confirm → all expand; (3) cancel dialog → none; (4) cancel mid-batch → stop after current, prior persisted; (5) one fails → batch continues, reported.
- [ ] E2E 1–5 (one section POST 500). Run → fail. Implement. Targeted E2E → pass. `tsc --noEmit`. Full jest suite.
- [ ] Commit: `feat(dig): expand-all confirm/estimate, serialized progress, cancel`.

## Task 13: Summary side — same-tab nav links (render.ts + nav.ts) — LANDS LAST (review B2)
**Files:** Modify `lib/html-doc/render.ts` (summary control markup), `lib/html-doc/nav.ts` (TS `initDigControls`/`applyDugState` AND inline summary block); Tests `tests/lib/html-doc/nav.test.ts` (**delete** Issue-#3 new-tab `:411-444` + the POST/SSE describe blocks B3–B8 + force-redig), `render.test.ts`.
**Behavior (spec §5):** summary `.dig[data-section]` controls become same-tab links via `dig-state`: un-dug `dig deeper ▶` href `…type=dig-deeper&dig=N#t=N` (no `target`); dug `view detail ↓` href `…type=dig-deeper#t=N` (**remove** `target="_blank"`/`rel`). Delete summary-side `startDig`/`applyLoading`/`applyError`/force-`↻` in **both** TS and inline. Add summary-side `pageshow` re-fetch of `dig-state` (review M5). Update both TS + inline identically.
**Behaviors:** (1) un-dug href has `type=dig-deeper&dig=N#t=N`, no `target`; (2) dug href `type=dig-deeper#t=N`, no `target=_blank`; (3) click → navigates (no POST — spy); (4) dig-state failure → fail-open to un-dug nav link; (5) `pageshow` persisted → re-fetch dig-state; (6) obsolete POST/new-tab suites removed.
- [ ] Rewrite/delete obsolete nav tests (RED clarity); add new jsdom tests 1–5. Run → fail. Implement (TS+inline). Targeted → pass. `tsc --noEmit`. Full suite.
- [ ] Commit: `feat(dig): summary dig controls are same-tab nav links (no POST/new tab) (#5)`.

## Task 14: E2E suite + fixtures (rewrite — review H4)
**Files:** Rewrite `tests/e2e/dig-deeper.spec.ts` (the static-companion-HTML harness is incompatible with merge-from-inputs; remove old summary-POST B1–B6 blocks); fixtures.
**Coverage (spec §10):** summary nav → dig same tab (no new tab; **all** URL params; scroll); `↑ summary` same-tab (no `#t`); **#1 regression** (summary cached at v1 → dig controls after re-render); fixtures (a) mixed dug/un-dug, (b) zero dug, (c) missing-asset, (d) real existing companion shape (§7), (e) orphan companion section.
**Behaviors (E2E):** (1) same-tab nav (page count unchanged, params, scroll); (2) ↑ summary same-tab no `#t`; (3) v1 regression; (4) orphan region visible; (5) missing-asset placeholder visible; (6) zero-dug skeleton renders.
- [ ] Write fixtures + E2E 1–6 (RED). Run → fail. Wire. Full E2E → pass. `tsc --noEmit`. Full jest suite.
- [ ] Commit: `test(dig): E2E — same-tab nav, v1 regression, orphan, missing-asset, skeleton`.

---

## Self-Review (r2)
- **Spec coverage:** §3a→T3; §4 images→T7, spacing→T6; §5 dig-doc expand/toggle→T10, ?dig/bfcache→T11, expand-all→T12, summary nav→T13; §6→T1/T4/T5; §7 fixture→T14; §8 errors→T3/T5/T6/T7/T8/T10/T11/T12; §9 boundaries + dead-cache removal→T8/T9; §10 tests→each+T14; §11→T13/T6; §12→T12.
- **Ordering (review B2):** backend/merge (T1–T5) → render+route (T6–T8) → dead-cache/old-fn removal (T9) → **dig-doc generation** (T10–T12) → **summary flip last** (T13) → E2E (T14). No window where digging is dead on both surfaces: summary keeps its existing POST machine until T13, by which time the dig doc fully generates.
- **Signature break (review B1):** additive `renderDigDeeperDoc` (T6); GET migrates (T8); POST stops rendering + old fn removed (T9). No commit breaks tsc on a live caller.
- **Obsolete tests enumerated (review H3/H4):** T1 `render.test.ts:33`; T9 `dig-post.test.ts:309` + old renderer tests; T13 nav.test.ts Issue-#3 + POST/SSE + force-redig; T14 E2E B1–B6.
- **Type consistency:** `DugSection`(T2)→T3/T8; `MergedSection`/`MergeResult`/`mergeDigDoc`(T3)→T6; `sameTitles` exported(T3)→T3; `GENERATOR_VERSION`(T1)→T4/T5; `reRenderSummaryHtml{html}`(T4)→T5; `renderDigDeeperDoc`(T6)→T8; `parseDugSections`(T2)→T8; `assertWithin`(T8).
- **Placeholders:** none (formulas, signatures, file:line all concrete).
