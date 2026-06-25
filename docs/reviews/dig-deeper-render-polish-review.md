# Review — Dig-Deeper Doc Render Polish (PR #23 review feedback)

**Date:** 2026-06-25
**Branch:** `feat/section-dig-deeper-screenshots`
**Scope:** 5 UI-styling fixes to `lib/html-doc/render-dig-deeper.ts` from user screenshot feedback during PR #23 review.

## Changes

| # | Feedback | Fix | Evidence (live app, video `v4F1gFy-hqg`) |
|---|----------|-----|------|
| 1 | Section number in front of title aids readability | Heading text = `${numeral}. ${title}` (numeral guarded for null) | `<h2>3. Cultivating a Ubiquitous Language for Precision …` |
| 2 | Title repeated in heading + muted line | `.ts` link now shows only the play timestamp, no title repeat | `.ts` = `▶ (7:21)`; samples `▶ (0:33)`, `▶ (4:36)` |
| 3 | "dig deeper" too big/flashy (1.5rem serif gold) | New `.dg .dig-trigger,.dg .dig-toggle` CSS → muted `.8rem` `-apple-system` `--meta` | computed: `12.8px / rgb(154,144,130) / -apple-system` |
| 4 | Gold lead emphasis missing | `.dg .lead` color `var(--ink)` → `var(--gold)` (matches `render.ts:39`) | computed lead color `rgb(230,181,77)` = gold |
| 5 | More spacing before/after screenshot | `.dug img` margin `1.2em` → `2em` | computed `marginTop/Bottom = 32px` |

Added helper `fmtClock(sec)` → `m:ss` / `h:mm:ss`. Removed dead `.dg .lead-accent` CSS (Low finding, see below).

## Verification

- `npx jest render-dig-deeper` — **75/75** (added "Behavior 9" coverage block: numeral heading, no title repeat, muted control CSS, gold lead, control text pinned).
- `npx tsc --noEmit` — clean.
- Full `npm test` — 1276/1277 (1 red = pre-existing `pdf.test.ts` parallel-load flake; passes 12/12 in isolation; not touched by this change).
- `npx playwright test dig-deeper` — **23/23** (incl. E4, the prior flake).
- Visual + computed-style verification against the live app on the exact section from the user's screenshot.

## Adversarial Review (Claude — Codex at usage limit)

> **Codex gap:** Codex CLI was at its usage limit at review time, so this adversarial pass was performed by a fresh Claude subagent with full file access and an explicit adversarial mandate, per `docs/plugins.md` Codex-fallback policy. Re-run the Codex-specific pass before merge if access returns.

Independent reviewer verdict: **No Blocking, High, or Medium findings.** Scrutiny points all cleared:
- Null numeral guarded — no `"undefined."` prefix possible (`numeral: string | null`).
- Dropping title from `.ts` link breaks no test/consumer (no one parses link text; summary state machine uses `data-section`/`data-type`).
- `.dg .dig-trigger` (0,2,0) correctly overrides `.dg h2` inheritance and `.dg a` (0,1,1); does NOT touch the summary-side `.dig` control (different class).
- `fmtClock` correct across 0/59/60/3600/3661.
- `.lead` gold scoped to gist lead only; `.dug`/orphan content rendered via markdown-it emit plain `<p>` (no `lead` class).
- Escaping intact (full `headingText` passes through `esc()`).
- No `toHaveText` E2E breakage — control text unchanged.

**Low (addressed):** `.dg .lead-accent` was dead CSS in this renderer (only `render-deep-dive.ts` emits `lead-accent`, under `.dd`). Removed for clarity.

## Outcome

Ready. PR #23 remains open (user is reviewing before merge).
