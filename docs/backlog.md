# Enhancement Backlog

Triaged feedback for enhancing the current version. Captured 2026-06-19.
Sequence/bundles below; `#8` is explicitly **someday** (vision, not near-term).

## Items

| # | Item | Touches | Size | Bundle | Status |
|---|------|---------|------|--------|--------|
| 6 | **Lead prominence** — gold "lead" line is over-emphasized (bold + larger + saturated gold) and competes with the section title. Make it non-bold (and/or italic), keep gold so it supplements rather than co-headlines. | `render.ts .lead` + `render-deep-dive.ts h2+p` (shared treatment) | XS | A | **in progress** |
| 7 | **Drop bullet labels** — the bold `label:` prefix usually just repeats the sentence's first words and adds a competing black anchor per line. Drop it; experiment with inline emphasis instead (bold key term / italic / underline). | `render.ts` `<li>` + `generateMagazineModel` prompt | S | A | **in progress** |
| 5 | **Palette dedup** — the shared magazine palette is copy-pasted across `render.ts` and `render-deep-dive.ts`. Extract a shared `BASE_PALETTE`. Opportunistic while both renderers are open for A. | `theme.ts` + both renderers | XS | A | **in progress** |
| 1 | **Deep-dive version-aware regeneration** — deep-dive HTML serves a stale cache and the "Deep Dive" menu button silently always-regenerates with no hourglass. Bring it to summary parity: a `deepDiveVersion` (major = `.md`/prompt → re-generate; minor = CSS/render → cheap `runDeepDiveHtml` re-render), an `ensureDeepDiveHtml` orchestrator, a unified version-aware "Deep Dive doc" menu action, and the per-row hourglass. Regenerate trigger = version check for BOTH summary and deep-dive. | new orchestrator + route + `VideoMenu` + status bar + `deepDiveVersion` field | L | B | pending |
| 3 | **Deep-dive timestamps** — clickable ▶ per-section YouTube timestamps in deep-dives. Now feasible because the deep-dive is transcript-grounded (PR #3). **Folds into Bundle B** (since #8 is someday). | deep-dive prompt tokens + resolver (mirror summary) | M | B | pending |
| 4 | **Fence info-string guard** — `padDividers`/`parse.ts` treat a closing fence with an info string (` ```python `) as a valid closer. Pre-existing repo-wide limitation, low impact. Fold into any markdown-touching bundle or skip. | `markdown-dividers.ts` + `parse.ts` | XS | (loose) | pending |
| 2 | **PDF story** — re-summarize leaves the PDF stale. Decide: keep PDF, or make the HTML printable and drop separate PDF generation ("print to PDF from HTML"). Needs a product decision before it's actionable. | pipeline PDF gen, print CSS, menu | M + decision | C | pending (needs decision) |
| 8 | **Deep-dive as aligned expandable detail view** — reframe the deep-dive from an independent topic-organized doc into the section-aligned detail view of the summary: each summary section expands to a richer detail (text + diagrams + **screen captures** at the section's timestamp). Staged: (a) structural alignment (deep-dive sections keyed to summary sections + timestamps), (b) expand-in-place UI, (c) diagrams + screen-capture infra (needs downloadable video + ffmpeg; Gemini can describe frames but not extract them). **SOMEDAY** — vision, not near-term. | new pipeline arch + video-frame extraction + expand UI | XL / staged | D | **someday** |

## Bundles

- **A — Magazine style refinement** *(XS–S)*: #6 + #7 + #5. Prototype the lead + bullet-emphasis variants, user picks, implement. Stacks on PR #3. ← **STARTED** (branch `feat/magazine-style-refinement`).
- **B — Deep-dive parity** *(M–L)*: #1 + #3 (folded in, since #8 is someday). Brings deep-dive to the summary's version-aware/hourglass/timestamp parity.
- **C — Output formats** *(M + decision)*: #2. Blocked on the PDF-vs-printable-HTML product call.
- **D — Aligned detail view** *(XL, someday)*: #8. Own staged roadmap when revisited.
- *(Loose: #4 — fold into A or B opportunistically, or skip.)*

## Sequence

1. **A** (now) → 2. **B** → 3. **C** (after PDF decision) → 4. **D** (someday).

**Decisions recorded:** #8 = someday → #3 does NOT wait for #8; it rides Bundle B. #1 is built standalone (it's orthogonal to #8's alignment, so no rework).

## Notes
- All near-term bundles stack on PR #3 (`feat/summary-deepdive-quality`) → merge order: #1 timestamps → #2 versioned-regen → #3 quality-pass → A → B …
