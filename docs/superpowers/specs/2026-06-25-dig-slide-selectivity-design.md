# Design — Dig-Deeper Slide Selectivity (graphics-only screenshots)

**Date:** 2026-06-25
**Status:** Approved (design, decisions locked) — pending spec review → implementation plan
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
Add `genVersion: number` to `DugSection` (`lib/dig/companion-doc.ts`):
- **Serialize** it in the per-section frontmatter (alongside `sectionId/startSec/title/generatedAt`).
- **Parse** it back in `parseFrontmatter`/`parseDugSections`.
- **Stamp** it at generation time: the dig route sets `section.genVersion = DIG_GENERATOR_VERSION` when it upserts a freshly-generated section.
- **Backward-compat:** an existing companion doc has no per-section `genVersion`; parse a missing value as `0` ⇒ treated as stale.

(The dead doc-level `digVersion: { major:1, minor:0 }` literal at `companion-doc.ts:69` — currently written but never parsed — is removed/replaced by this per-section field to avoid two competing notions of version.)

### 4.3 Staleness detection (render time)
`mergeDigDoc` / `renderDigDeeperDoc` compares each dug section's `genVersion` against `DIG_GENERATOR_VERSION`. `genVersion < DIG_GENERATOR_VERSION` ⇒ **stale**. The merged section carries an `isStale` flag.

### 4.4 Refresh UX (deliberate, no auto-spend)
A **stale** dug section renders its existing content **plus** an `↻ outdated` control in the heading (next to the `show summary ⌃` toggle):
- Clicking `↻ outdated` re-digs **that one section** — reusing the existing client `_startDocDig` POST→SSE→swap path (the dig POST already replaces the section via `upsertDugSection`, now stamping the new `genVersion`). On completion the section swaps to fresh content (transcribed code, graphics-only slides) and the badge clears.
- **No Gemini call fires on page load.** Opening a doc with stale sections shows them as-is with the badge; cost is incurred only when the user clicks.
- **Refresh-all:** the existing `⤢ expand all` control is extended to a "refresh outdated" affordance that serially re-digs all stale sections (reusing the existing serialized batch + cancel + cost-estimate dialog). Optional but cheap to add since the batch machinery exists.

### 4.5 Fresh (non-stale) sections
Render exactly as today — no badge, no behavior change.

---

## 5. Components touched

| Unit | Change |
|---|---|
| `lib/dig/generate.ts` | Rewrite slide instruction (§3); export/define `DIG_GENERATOR_VERSION` |
| `lib/dig/companion-doc.ts` | Add `genVersion` to `DugSection` + serialize + parse; remove dead doc-level `digVersion` literal |
| dig route (`app/api/videos/[id]/dig/[sectionId]/route.ts`) | Stamp `section.genVersion = DIG_GENERATOR_VERSION` on upsert |
| `lib/html-doc/dig-merge.ts` | Carry `genVersion`; compute `isStale` per merged section |
| `lib/html-doc/render-dig-deeper.ts` | Render `↻ outdated` control for stale sections; CSS (muted, like `.dig-toggle`) |
| `lib/html-doc/nav.ts` (NAV_SCRIPT) | Wire `↻ outdated` click → `_startDocDig` for that section; extend expand-all to "refresh outdated" |

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
- **Unit (`companion-doc`):** `genVersion` round-trips (serialize→parse); missing `genVersion` parses as `0`; upsert stamps current version.
- **Unit (`dig-merge`):** `isStale` true when `genVersion < current`, false when equal; missing → stale.
- **Unit (`render-dig-deeper`):** stale section emits `↻ outdated` control; fresh section does not; control text/markup stable.
- **Prompt:** `buildDigPrompt` contains the transcribe-code instruction and the graphics-only restriction; does NOT contain "code screen"; states zero-slides-normal.
- **E2E:** stale section shows `↻ outdated`; clicking re-digs (stubbed POST→SSE) and clears the badge; opening a doc fires **no** dig POST until the click; expand-all "refresh outdated" serially refreshes stale sections.

---

## 8. Open Questions

- **O-1 (prompt sufficiency):** Part 1 relies on Gemini's judgment of "true graphic vs text." Since Gemini is clip-grounded this is expected to work; if real output still over-captures, a post-capture heuristic (OCR text-density drop) is a **deferred** fallback — not in this scope (YAGNI).
- **O-2 (refresh-all):** extending `⤢ expand all` to "refresh outdated" is included as low-cost reuse; if it complicates the plan, it can ship as a fast-follow while per-section `↻` ships first.

---

## 9. Out of Scope / Deferred

- OCR / image-content heuristics (O-1 fallback).
- Re-cropping/zooming captured slides (the original "#4 slide-crop" geometry idea — superseded by "capture fewer, better frames").
- Any change to summary/deep-dive docs.
- Bulk auto-refresh of all existing docs (explicitly rejected in favor of deliberate refresh).
