# Design — Dig-Deeper Slide Selectivity (graphics-only screenshots)

**Date:** 2026-06-25
**Status:** Adversarial-reviewed (Claude fallback; no Blocking — H1/H2/M1/M3/L1/L2 absorbed into spec — see `docs/reviews/spec-dig-slide-selectivity-review.md`) — pending user spec-review → implementation plan
**Related:** [`2026-06-24-section-dig-deeper-screenshots-design.md`](2026-06-24-section-dig-deeper-screenshots-design.md) (the dig-deeper + slide-screenshot feature this refines — the deferred "#4 slide-crop" item)

---

## 1. Problem

Dig-deeper sections embed slide screenshots captured from the video. In practice many captured frames are **commands, code, title cards, or tips** (e.g. a `/grill-me` command card, an "IT AIN'T WRONG" title slide) — text that the prose already conveys. A blurry video frame of text adds no understanding and clutters the doc.

**Root cause (not a capture bug):** slide selection is entirely **prompt-driven**. Gemini is clip-grounded (it watches the frame) and emits `[[SLIDE:M:SS|caption]]` tokens; `lib/dig/slides.ts` simply extracts a frame at each token's timestamp (`slide-tokens.ts` parses/caps at ≤3). The prompt (`lib/dig/generate.ts:63`) tells Gemini to emit a slide when *"a slide, diagram, chart, or **code screen** conveys information beyond what is spoken"* — which actively invites command/code/title cards, and "beyond what is spoken" is a bar a tip card trivially clears.

**Principle (user):** a screenshot should appear **only when the picture itself is what aids understanding** — not when the frame is text the prose can carry.

---

## 2. Decisions (locked during brainstorming)

1. **Code/commands → transcribe to text, never screenshot.** Because Gemini is clip-grounded, it can transcribe a command/CLI/code/config it sees into a fenced ```code block``` inline in the prose. Code-as-text beats code-as-image: sharp, copyable, theme-aware, searchable. The renderer already supports it (`render-dig-deeper.ts` markdown-it + `.dg pre`/`.dg code`).
2. **Screenshot only true graphics:** diagram, chart, architecture/flow figure, data visualization, or a UI/result screenshot where the spatial/visual layout carries meaning text can't reproduce.
3. **Neither (prose only):** title cards, bullet/section slides, quote/tip cards, talking-head frames.
4. **Scope:** going-forward immediately (new/re-dug sections); existing dug sections **version-gated, lazily re-generated on a deliberate refresh** (no auto Gemini calls on page load).

### Representation table

| On-screen content | Representation | Why |
|---|---|---|
| Command, CLI, code, config | Transcribe → ```code block``` in prose | Gemini sees it; text is sharper/copyable/themed |
| Diagram, chart, architecture, data viz, UI layout | `[[SLIDE:…]]` screenshot | Text can't reproduce the visual/spatial meaning |
| Title card, bullets, quote/tip, talking head | Neither — prose covers it | No added understanding |

---

## 3. Part 1 — Prompt change (going-forward fix)

Rewrite the slide instruction in `buildDigPrompt` (`lib/dig/generate.ts:63`). New wording (intent; exact text finalized in the plan):

- **Remove** "code screen" from the slide allow-list.
- **Add:** "If the clip shows a command, terminal/CLI, code, or config, **transcribe it into a fenced code block** inline in your prose — do not screenshot it."
- **Restrict slides:** "Emit `[[SLIDE:M:SS|caption]]` **only** when a genuine *visual* — a diagram, chart, architecture/flow figure, data visualization, or a UI/result screenshot whose layout carries meaning — cannot be conveyed in words. **Never** for title cards, bullet lists, quotes, tips, or a speaker on camera."
- **Floor:** "Most sections need **zero** slides; emitting none is the normal, preferred case." Keep the existing ≤3 ceiling.

`[[TS:i]]` citation behavior is unchanged. Korean-output behavior unchanged (code blocks and captions still produced under `lang='ko'`).

No pipeline change is required for Part 1 — `slide-tokens.ts` / `slides.ts` already only act on whatever tokens Gemini emits, so fewer/no tokens ⇒ fewer/no captures automatically.

---

## 4. Part 2 — Versioning + stale-section refresh

### 4.1 Version constant
Introduce `DIG_GENERATOR_VERSION` (integer; this change sets it to its first meaningful value, e.g. `2`). Bumped whenever the dig generation policy changes.

### 4.2 Per-section version (persisted)
Add `genVersion: number` to `DugSection` (`lib/dig/companion-doc.ts`). This touches **several hard-coded-4-field sites** that the parser/serializer enumerate — the plan must list each (review M3/L1):
- **Type:** add `genVersion` to the `DugSection` interface (`:30`) and the internal `ParsedFrontmatter.sections` shape (`:145`) and the `currentSection` `Partial<…>` (`:159`).
- **Serialize:** emit `    genVersion: <n>` in `serializeFrontmatter` (`:77-80`), placed **after `generatedAt`** (fixed position for test determinism; parse is regex-keyed so position is otherwise free).
- **Parse:** add `^\s{4}genVersion\s*:\s*(\d+)` mirroring the `startSec` regex (`:188`), and set it in `currentSection`.
- **Commit (two sites):** the list-item commit block (`:176-183`) and the trailing-section commit (`:239-245`) both hard-list the 4 fields — add `genVersion: currentSection.genVersion ?? 0` to **both**.
- **Return:** `parseDugSections` constructs the returned `DugSection` literal (`:315-323`) — add `genVersion: s.genVersion ?? 0`.
- **Stamp:** the dig route sets `section.genVersion = DIG_GENERATOR_VERSION` in the section literal it upserts (`route.ts:160-166`); it flows through `upsertDugSection`/`doUpsert` unchanged.
- **Backward-compat (review L3, confirmed):** a legacy doc has no per-section `genVersion` ⇒ `?? 0` ⇒ stale. Safe.

(The dead doc-level `digVersion: { major:1, minor:0 }` literal at `companion-doc.ts:69` — written but never parsed — is removed. **This breaks 3 tests that embed the literal** (`tests/api/html-serve.test.ts:140,223`, `tests/lib/dig/companion-doc.test.ts:345`) — they must be updated in the same task.)

### 4.3 Staleness detection (render time)
**`mergeDigDoc` owns the comparison** and imports `DIG_GENERATOR_VERSION`. `genVersion < DIG_GENERATOR_VERSION` ⇒ **stale**.

Critical (review H2): `MergedSection.dug` is currently typed `{ bodyMarkdown: string } | null` (`dig-merge.ts:31`), and the merge **discards every other `DugSection` field** at its two construction sites (`:100` and `:148`) — so `genVersion` is *not* available downstream as-is. The plan must:
1. Add `isStale: boolean` to `MergedSection` (cleaner than widening `dug`).
2. Compute `isStale` in `mergeDigDoc` from `matched.genVersion < DIG_GENERATOR_VERSION` at **both** `:100` and `:148`.
3. Thread `isStale` into `renderDigDeeperDoc` (`render-dig-deeper.ts:175+`) to emit the refresh control.
The orphan path (`:163-167`) is independent of staleness (orphans already show a re-dig note).

### 4.4 Refresh UX (deliberate, no auto-spend)
A **stale** dug section renders its existing content **plus** a refresh control in the heading, using a **distinct class `.dig-refresh[data-section]`** (review M1 — *not* `.dig-trigger` or `.dig-toggle`, so the `nav.ts` click delegation stays unambiguous: toggle ≠ trigger ≠ refresh):
- The control reuses the existing client `_startDocDigAsync` POST→SSE→swap path keyed on `data-section`. The dig POST replaces the section via `upsertDugSection` (now stamping the new `genVersion`). **The click delegation (`nav.ts:318-329`) must add a `.dig-refresh` branch** that calls `_startDocDig` (the `?dig` already-dug guard at `:363-366` does NOT block this — it only gates the URL auto-trigger; confirmed review F5).
- **Badge clears via re-GET swap, not client mutation** (review M2): on `done`, `_startDocDigAsync` re-fetches `location.href` → server re-renders with the freshly-written `genVersion=current` → `isStale=false` → the swapped-in section has no refresh control. Relies on the existing upsert-before-`done` ordering (`route.ts:154` upsert, `:174` emit done). E2E must assert the badge is **gone after swap**, not merely that a POST fired.
- **No Gemini call fires on page load.** Opening a doc with stale sections shows them with the badge; cost only on click (confirmed review F8).

### 4.5 Refresh-all (separate task, NOT a freebie — review H1)
The existing `⤢ expand all` batch selects **`.dig-trigger[data-section]` only** (`nav.ts:273,297`) — stale dug sections have **no** `.dig-trigger`, so reusing it as-is would refresh **nothing**. A "refresh outdated" therefore requires explicit changes, enumerated as its own plan task:
- Batch selector must include `.dig-refresh` (e.g. `.dig-trigger, .dig-refresh`) in `_eaRunBatch`/`_next` (`:273`) and the count (`:297`).
- The cost estimate (`:300-302`, `N*0.05`, `N*30/60`) must count stale sections.
- The `_next` loop filters `state==='error'/'loading'`; a refreshed section's control must end in a non-re-selectable state (it disappears on swap → naturally drops out).
- **Sequencing:** ship per-section `↻` first; refresh-all as a fast-follow task. Do **not** frame it as "cheap reuse."

### 4.6 Fresh (non-stale) sections
Render exactly as today — no badge, no behavior change.

---

## 5. Components touched

| Unit | Change |
|---|---|
| `lib/dig/generate.ts` | Rewrite slide instruction (§3); export/define `DIG_GENERATOR_VERSION` |
| `lib/dig/companion-doc.ts` | Add `genVersion` to `DugSection` + serialize + parse (multi-site: type, regex, 2 commit blocks, parseDugSections return — §4.2); remove dead doc-level `digVersion` literal + fix its 3 tests |
| dig route (`app/api/videos/[id]/dig/[sectionId]/route.ts`) | Stamp `section.genVersion = DIG_GENERATOR_VERSION` in the upserted section literal (`:160-166`) |
| `lib/html-doc/dig-merge.ts` | Add `isStale` to `MergedSection`; compute from `genVersion` at **both** construction sites (`:100`, `:148`); import `DIG_GENERATOR_VERSION` |
| `lib/html-doc/render-dig-deeper.ts` | Render distinct `.dig-refresh[data-section]` control for `isStale` sections; CSS (muted, like `.dig-toggle`) |
| `lib/html-doc/nav.ts` (NAV_SCRIPT) | Add a `.dig-refresh` branch to click delegation → `_startDocDig`; **separate task**: extend expand-all selector + cost to include `.dig-refresh` (§4.5) |

---

## 6. Edge cases

| # | Case | Expected |
|---|---|---|
| 1 | Existing dug section, no `genVersion` in file | Parsed as `0` → stale → shows `↻ outdated`; content untouched until refreshed |
| 2 | Fresh section just dug | `genVersion = current` → no badge |
| 3 | Refresh click | Re-digs that section (Gemini), swaps content, stamps new `genVersion`, clears badge |
| 4 | Refresh fails (POST/stream error) | Existing `⚠ retry` path; stale content retained; badge remains |
| 5 | Gemini emits zero slides | Section is all prose (+ any transcribed code blocks); valid and normal |
| 6 | Long/dense code on screen | Transcribed as a code block; acceptable (rare in talk slides). Not screenshotted. |
| 7 | Opening a doc with N stale sections | N badges shown, **zero** Gemini calls until a click |
| 8 | `lang='ko'` | Code blocks + slide captions produced in Korean; policy unchanged |

---

## 7. Testing

- **Unit (`slide-tokens`/`slides`):** unchanged behavior given tokens; confirm zero tokens → no exec calls (already covered).
- **Unit (`companion-doc`):** `genVersion` round-trips (serialize→parse); **legacy doc with old doc-level `digVersion` line still parses (line ignored) and per-section `genVersion` defaults to `0`**; missing `genVersion` → `0`; upsert stamps current version. Update the 3 fixtures embedding the old `digVersion` literal (L2).
- **Unit (`dig-merge`):** `isStale` true when `genVersion < current`, false when equal; missing → stale; verify computed at **both** construction sites (matched at `:100` and `:148`).
- **Unit (`render-dig-deeper`):** stale section emits `.dig-refresh` control; fresh section does not; control class distinct from `.dig-toggle`/`.dig-trigger`.
- **Prompt:** `buildDigPrompt` contains the transcribe-code instruction and the graphics-only restriction; does NOT contain "code screen"; states zero-slides-normal.
- **E2E:** stale section shows `.dig-refresh`; clicking re-digs (stubbed POST→SSE) and the **badge is gone after the swap** (assert absence post-swap, not just that a POST fired); opening a doc fires **no** dig POST until the click; (refresh-all task) expand-all selects + refreshes `.dig-refresh` sections.

---

## 8. Open Questions

- **O-1 (prompt sufficiency):** Part 1 relies on Gemini's judgment of "true graphic vs text." Since Gemini is clip-grounded this is expected to work; if real output still over-captures, a post-capture heuristic (OCR text-density drop) is a **deferred** fallback — not in this scope (YAGNI).
- **O-2 (refresh-all):** ships as a **separate fast-follow task after** per-section `↻` (§4.5). It is **not** free reuse — the expand-all batch selects `.dig-trigger` only and would miss stale sections (review H1); selector + cost-estimate must change.

---

## 9. Out of Scope / Deferred

- OCR / image-content heuristics (O-1 fallback).
- Re-cropping/zooming captured slides (the original "#4 slide-crop" geometry idea — superseded by "capture fewer, better frames").
- Any change to summary/deep-dive docs.
- Bulk auto-refresh of all existing docs (explicitly rejected in favor of deliberate refresh).
