# Dig-Deeper "Expand All" — Non-Blocking Progress

**Date:** 2026-07-01
**Status:** Approved (design)
**Scope:** Render-only change to the exported dig-deeper HTML doc. No generator/version bump.

---

## Problem

In the rendered dig-deeper HTML doc, the top-bar **⤢ expand all** control digs every
remaining (missing/stale) section, one at a time. Each section takes ~30s, so for a doc with
N sections the whole run can take several minutes.

While it runs, a **full-screen blocking overlay** (`#_dg-ea-prog`, `position:fixed; inset:0`
with a dark `rgba(0,0,0,.45)` backdrop) covers the entire viewport, showing only
`section k of N…` and a **Cancel** button. The reader cannot scroll or read the document
until the whole batch finishes.

This contradicts the project convention (`docs/dev-process.md`): *"A full-screen blocking
overlay requires explicit justification in the spec; 'simpler to build' is not justification.
… default to non-blocking unless the user cannot do anything useful during the operation."*
During expand-all the user **can** do something useful — read the sections that already
exist, and watch new ones fill in as each completes.

## Goal

Make expand-all **non-blocking**: while the batch runs, the reader keeps full access to the
scrollable document, and sees a compact **bottom status bar** reporting progress. Sections
continue to swap into the page in place as each finishes, so progress is visible live.

## Non-Goals

- No change to *how* sections are generated (still serialized, one POST→SSE→re-GET→swap per
  section via `_startDocDigAsync`).
- No change to the **confirm dialog** (`#_dg-ea-dlg`) — a single cost/time decision the user
  makes before anything runs; blocking is appropriate and it is kept as-is.
- No generator version bump. This is presentation-only (embedded CSS/markup/JS in the render
  template), consistent with prior render-only changes; existing docs pick up the new bar on
  next render/serve.
- No new dependency, API route, or server change.

## Current Implementation (reference)

| Piece | Location |
|---|---|
| `⤢ expand all` button | `lib/html-doc/render-dig-deeper.ts:255` (top bar) |
| Confirm dialog markup `#_dg-ea-dlg` | `lib/html-doc/render-dig-deeper.ts:330` |
| Progress overlay markup `#_dg-ea-prog` | `lib/html-doc/render-dig-deeper.ts:337` |
| Overlay CSS (`#_dg-ea-dlg,#_dg-ea-prog{position:fixed;inset:0;…}`) | `lib/html-doc/render-dig-deeper.ts:165` |
| Existing non-blocking idiom `#_dg-ai-toast` (`position:fixed;bottom:1.4rem`) | `lib/html-doc/render-dig-deeper.ts:179` |
| Expand-all loop `_eaRunBatch` / click handler | `lib/html-doc/nav.ts:265`–`317` |

## Design

### 1. Split the shared overlay CSS

Currently `#_dg-ea-dlg` and `#_dg-ea-prog` share one full-viewport rule. Split them:

- **`#_dg-ea-dlg`** (confirm) — keep `position:fixed; inset:0` centered modal with backdrop.
  Unchanged.
- **`#_dg-ea-prog`** (progress) — restyle to a bottom status bar:
  - `position:fixed; left:0; right:0; bottom:0; z-index:9000`
  - full-width bar, no full-viewport backdrop (no `inset:0`, no dimming of the page)
  - `display:none` by default; `#_dg-ea-prog[data-open]{display:block}` (retain the
    `[data-open]` open/close mechanism already used by `_eaOpen`/`_eaClose`). The inner
    `._dg-bar` container owns the flex row layout, so the outer element is `block`, not `flex`.
  - horizontal layout: progress text on the left, Cancel button on the right — mirroring the
    `BatchDocStatusBar`/`HtmlDocStatusBar` bottom-bar look (`bg-zinc-900`-equivalent using the
    doc's `--card`/`--rule` theme variables, top border, small padding)
  - the failure line (`#_dg-ea-fail-msg`) sits inline within the bar

The inner `._dg-box` structure is retained for the **dialog** only; the **progress** bar gets
its own flat flex layout so it reads as a bar, not a centered card.

### 2. No logic change to the loop

`_eaRunBatch` (`nav.ts:265`) is unchanged in behavior:

- opens `#_dg-ea-prog` via `_eaOpen` (now a bottom bar)
- serialized `_next()` loop; sets `_eaProgMsg.textContent = 'section '+k+' of '+N+'…'`
- Cancel button sets `cancelled=true`; the in-flight section finishes, then the loop stops
- on completion with no failures → `_eaClose(_eaProg)` (bar disappears)
- on completion with failures → shows `Done with M failure(s).` + `Failed sections: …` for
  ~6s, then auto-closes

Only the *container* is non-blocking; the state machine is untouched.

### 3. Progress bar copy

- Running: `Expanding — section k of N…`  *(was `section k of N…`)*
- Done + failures: `Done with M failure(s).` / `Failed sections: X, Y`
- Cancel button label: `Cancel`

## Enumerated Behaviors

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Confirm dialog still blocking | Click ⤢ expand all | `#_dg-ea-dlg` opens centered with `inset:0` backdrop; page not scrollable behind it |
| 2 | Progress is a bottom bar, not full-screen | Confirm expand | `#_dg-ea-prog` is `position:fixed;bottom:0`, no `inset:0`, no full-viewport backdrop |
| 3 | Document scrollable during run | Batch running | User can scroll/read the doc; bar stays pinned to bottom |
| 4 | Live progress text | Each section starts | Bar shows `Expanding — section k of N…` with incrementing k |
| 5 | Sections fill in live | Each section done | Finished section is swapped into the page in place and is readable while later sections run |
| 6 | Cancel mid-run | Click Cancel in bar | `cancelled=true`; in-flight section completes; loop stops; bar dismisses |
| 7 | Auto-dismiss on success | All sections done, 0 failures | Bar removed (`data-open` cleared) |
| 8 | Failure summary then auto-dismiss | ≥1 section fails | Bar shows `Done with M failure(s). Failed sections: …` ~6s, then dismisses |
| 9 | No sections to expand | Click ⤢ expand all with N=0 | No-op (existing guard `if(N===0)return`) |
| 10 | Manual dig during batch | User clicks another section's ▶ while batch runs | Now physically possible (page uncovered). Loop skips `loading`/`error` triggers when choosing next section → no double-dig of the same section |
| 11 | Bar does not block content clicks | Batch running | Thin bottom bar; content above remains clickable (links, zoom, toggles) |

## Testing

**Render-string tests** (`tests/lib/html-doc/render-dig-deeper.test.ts`):
- `#_dg-ea-prog` CSS contains `bottom:0` and does **not** contain `inset:0`
- `#_dg-ea-dlg` CSS still contains `inset:0`
- progress bar markup present with Cancel button and message/fail elements

**E2E tests** (`tests/e2e/dig-deeper.spec.ts`):
- during a mocked expand-all run, the progress element is a bottom bar (assert bounding box is
  pinned to viewport bottom / not covering full height) and the document is scrollable
- Cancel path: bar dismisses, loop stops
- done path: bar auto-dismisses
- failure path: failure summary shown then dismissed

Mock the dig POST/SSE endpoints at the route level (per project mocking policy) so no real
Gemini calls occur.

## Risks

- **Scroll jump on in-place swap** — replacing a section node the user is currently viewing
  could shift scroll position. Pre-existing behavior (single-click dig already swaps in
  place); non-blocking merely makes it observable during batch. Acceptable; note only.
- **Theme variables** — the bar must use the doc's CSS variables (`--card`, `--rule`, `--ink`,
  `--meta`) so it renders correctly in both light and dark exports. Covered by using the same
  variables already used by `#_dg-ai-toast`.
- **Z-index / AI-toast overlap** — the bar is `z-index:9000`; the Ask-AI toast (`#_dg-ai-toast`)
  is `z-index:9600` at `bottom:1.4rem`. Now that content is clickable during a batch, a user could
  trigger the toast mid-run and it would visually overlap the bar. **Decision:** accept it — the
  toast is transient (~seconds) and correctly renders above the bar; no suppression logic added.
- **Failure-list overflow** — a long "Failed sections: …" line must not push the Cancel button
  off-screen. The bar uses `flex-wrap` + `min-width:0` (fail line wraps to its own row) and
  `max-height:40vh;overflow-y:auto`.
