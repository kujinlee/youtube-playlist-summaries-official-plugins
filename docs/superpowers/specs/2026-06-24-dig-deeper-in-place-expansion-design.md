# Dig-Deeper v2 — In-Place Section Expansion

**Date:** 2026-06-24
**Branch:** `feat/section-dig-deeper-screenshots` (continuation; follows PR #23)
**Supersedes interaction model of:** `2026-06-24-section-dig-deeper-screenshots-design.md`
**Status:** Approved (brainstorming) — adversarial-reviewed — pending implementation plan

**Revision r2 (2026-06-24, post-adversarial-review):** Two independent adversarial reviews
(`docs/reviews/spec-dig-deeper-v2-review.md`, `…-in-place-expansion-review.md`; both Claude —
Codex CLI at usage limit) converged on the same blockers. Resolved inline: §3a section-keying
contract + orphan handling (was BLOCKING — gist-by-index vs dug-by-startSec never reconciled,
re-summarize silently orphaned dug content); §6 reuses `reRenderSummaryHtml` with a full
status→outcome map + atomicity/concurrency note + single `GENERATOR_VERSION` constant; §5
guarded `?dig=` (already-dug → no POST, `replaceState`, fire-once) + expand-all cancel +
`pageshow` bfcache; §4 split missing-asset (containment-drop vs escaped placeholder); §9
nav.ts dual-source mitigation + route path-containment; §7 "no migration" verified against the
one real companion.

---

## 1. Problem & Motivation

PR #23 shipped the first dig-deeper feature: an on-demand, per-section elaboration of a
summary, with slide screenshots, stored in a `<base>-dig-deeper.md` companion file. User
validation against the live PR returned seven issues. This spec addresses them, with the
centerpiece being a redesign of the dig-deeper **document model**.

### Validation findings (from user)

| # | Item | Disposition |
|---|------|-------------|
| 1 | Some HTML docs show no dig-deeper menu | **Fix** — stale cached summary HTML (see §6) |
| 2 | "Can't find the file" for a dig-deeper URL | **No bug** — file is `<slug>-dig-deeper.md` in `raw/`; user searched the *videoId*, but filenames are slug-based (videoId→slug via `playlist-index.json`). Documented, no code change. |
| 3 | Are embedded images robust? | **Keep base64-inline** + add missing-asset guard (see §4) |
| 4 | Slide has speaker/branding; want clean full-width slide | **Deferred** — keep full-frame capture as-is for now |
| 5 | Returning to summary forces a new tab | **Fixed by redesign** — all navigation becomes same-tab (see §5) |
| 6 | Sections not spaced enough | **Fix** — CSS spacing (see §4) |
| 7 | Mirror summary structure; expand sections in place | **Redesign** — the core of this spec (see §3–§5) |

### Root causes confirmed during exploration

- **#7:** The companion doc is an upsert accumulator of **only dug sections**
  (`lib/dig/companion-doc.ts`). Un-dug sections do not appear. A summary with 7 sections
  whose user dug 5 yields a dig doc with 5 sections; sections 6 and "Conclusion" are absent.
- **#5:** Asymmetric navigation. "view detail ↓" opens a **new tab** (`target="_blank"`,
  commit `2a3bfc7`), but "↑ summary" navigates the **current tab** (`location.href`).
  Returning to summary replaces the dig tab; re-digging then spawns yet another new tab.
- **#1:** `app/api/html/[id]/route.ts` serves `type=summary` from a **pre-built cached file**
  (`htmls/<slug>.html`) with **no version check**. The KO doc's cache (mtime Jun 23 09:25)
  predates the dig feature → has `▶` timestamp links but **zero** dig controls. The EN doc
  (mtime Jun 24 17:23) was re-exported after the feature → has 7 dig controls. The renderer
  and parser are correct; the served artifact is stale.

---

## 2. Goals & Non-Goals

### Goals
- The dig-deeper doc presents **every** summary section, in summary order, showing the
  summary gist by default and expandable to the dug elaboration **in place**.
- Per-section compare: toggle a dug section between its summary gist and its dug elaboration
  with no refetch.
- "Expand all" generates all remaining sections (guarded by a confirm dialog).
- All navigation is **same-tab**; no tab proliferation.
- Stale summary HTML self-heals (lazy, version-gated) so the dig menu always appears.
- No migration of existing dig companion files.

### Non-Goals
- Slide cropping / removing speaker & branding from frames (#4) — deferred.
- Retiring the legacy `-deep-dive.md` document — out of scope (separate decision).
- Changing the dig **generation** pipeline (Gemini REST, yt-dlp/ffmpeg slide extraction) —
  reused as-is.

---

## 3. Document Model & Data Flow (Approach 1: thin companion + render-time merge)

The companion `<base>-dig-deeper.md` remains a **delta store of only dug sections** — its
sentinel-delimited format (`<!-- dig-section: <id> -->`) is **unchanged**. The dig-deeper
doc structure is assembled at **render time** by merging three already-existing inputs.

### Inputs (all derivable from the companion path)
| Input | Source | Provides |
|---|---|---|
| Summary markdown | `<base>.md` → `parseSummaryMarkdown` | Section order, numerals, titles, `timeRange.startSec` |
| Magazine model | `models/<base>.json` (`MagazineModel`) | Per-section `lead` + `bullets` (the gist, identical to the summary doc) |
| Dig companion | `<base>-dig-deeper.md` | Dug sections (elaboration markdown + `assets/` slide refs), keyed by `sectionId` = `startSec` |

`<base>` is recovered from the companion filename (`<base>-dig-deeper.md`); the summary,
model, and `assets/` all live in the same `outputFolder`.

### Output
One `<section data-start="<startSec>" data-dug="true|false">` **per summary section, in
summary order** — not only dug ones. The companion file is **not required to exist**: with
zero dug sections, every section renders un-dug (skeleton from summary + model).

### 3a. Section-keying contract & reconciliation (resolves BLOCKING-1, BLOCKING-2)

Three inputs use **two different keying schemes** that must be reconciled explicitly:

- **Gist** (`lead`+`bullets`) is **positional**: `model.sections[i]` aligns with
  `parsed.sections[i]` by array index. The model envelope (`{sourceMd, generatedAt,
  sourceSections, model}`) stores `sourceSections` — the section **titles** the model was
  built against. Validity invariant: gist-by-index is trusted **only if**
  `sameTitles(parsed.sections.map(s=>s.title), envelope.sourceSections)` (the same guard
  `rerender.ts:56` uses). If titles drift, the model is stale relative to the summary →
  render **title + timestamp skeleton without gist** for affected sections (never wrong
  gist). This case is rare (a re-summarize without a model regen) and degrades safely.
- **`data-start` / dig affordance** depend on `timeRange`: a section with `timeRange === null`
  (no `▶` line — e.g. "Conclusion" in some docs) gets **no `data-start`**, `data-dug="false"`,
  and **no dig trigger** — exactly matching today's summary (`render.ts:81-83`). Such sections
  render gist-only and can never be dug. *(New Enumerated-Behaviors row.)*
- **Dug overlay** is matched to a summary section by a **two-step key**:
  1. **By `startSec`:** companion `sectionId === section.startSec` → attach as the dug block.
  2. **Fallback by title:** any companion section still unmatched is matched to a remaining
     summary section by **exact title** (companion stores the title in frontmatter and the
     `## ` line). This recovers the common drift case — a re-summarize shifted `startSec` but
     kept the title — and re-anchors the dug content to the right section.

### Orphan handling (no silent loss)
A companion section matched by **neither** `startSec` **nor** title is an **orphan** (its
summary section was removed/renamed). Orphans are **never silently dropped** (they cost real
Gemini + slide spend). They render in a labeled **"Unmapped dug sections"** region appended
after the last section — stored title + dug body + a one-line "this section no longer maps to
the current summary; re-dig to re-anchor" notice — plus an HTML comment for debuggability.

### Single source of truth
The summary drives structure; the companion is a pure delta store. With the keying contract
above, regenerating or retitling the summary propagates safely: aligned sections re-anchor by
title, truly-removed sections surface as visible orphans — **no silent drift, no data loss**.

---

## 4. Rendering

### Per-section content
| State (`data-dug`) | Renders |
|---|---|
| `false` (un-dug) | numeral ghost · `<h2>` title + `(label)` timestamp link · `dig deeper ▶` trigger · `.gist` (summary `lead` + `bullets`) |
| `true` (dug) | same header, trigger replaced by `show summary ⌃` toggle · **both** `.gist` (lead+bullets, hidden by default) **and** `.dug` (elaboration + slides, shown by default), in the DOM |

Both blocks present in the DOM for dug sections ⇒ "show summary / show dug" is a **zero-fetch
CSS toggle**.

### Top bar
`↑ summary` (same-tab link to the clean summary doc) · `⤢ expand all`.

### #6 — Spacing
Increase inter-section rhythm from today's cramped `1.6em`/`1px` rule to a clearer
separation (target: `section{padding:2.4em 0}` + a `2px` top rule between sections; extra
vertical breathing room around slide `<img>` in dug blocks). Exact values finalized during
implementation against a visual check.

### #3 — Images (base64-inline + missing-asset guard)
Keep inlining each `assets/…jpg` as a base64 data-URI (self-contained, portable HTML). The
current renderer (`render-dig-deeper.ts:99,106`) returns `''` (drops the `<img>`) for **both**
the containment-failure and the missing-file cases. Split these two branches:

- **Containment violation** (resolved path escapes `assets/`, e.g. a traversal attempt at
  `:99`) → **still drop silently** (`return ''`). Do **not** render a placeholder or
  attacker-controllable `alt` text.
- **Benign missing file** (`:103` catch) → emit a `.missing-slide` placeholder containing the
  HTML-**escaped** `alt` text (`esc(altAttr)`, already applied at `:108`). A deleted frame
  degrades gracefully rather than vanishing or 500-ing the document.

Two unit tests: containment-drop (no placeholder, no alt leak) and missing-file-placeholder.

---

## 5. Interaction & Navigation

Because the dig doc renders from summary + model (§3), **all generation moves into the dig
doc**, and the summary side becomes **navigation-only**. This removes the POST→SSE client
and the `target="_blank"` logic from the summary HTML entirely.

### Summary doc — per-section control (same-tab nav)
The summary continues to fetch `dig-state` to label sections; the control becomes a link:
| Section state | Control | Action (same tab) |
|---|---|---|
| un-dug | `dig deeper ▶` | → `…&type=dig-deeper&dig=<startSec>#t=<startSec>` |
| dug | `view detail ↓` | → `…&type=dig-deeper#t=<startSec>` |

### Dig doc — the interactive surface
- **`dig deeper ▶`** (un-dug): POST→SSE generate (existing state machine) → on success inject
  the `.dug` block + slides, flip section to expanded, swap control to `show summary ⌃`.
- **`?dig=<startSec>` on load** (guarded — resolves BLOCKING-3 / HIGH-7):
  - Consult the already-fetched `dig-state` first. **If section N is already dug → scroll
    only, no POST** (prevents wasted ~$0.05/30s re-dig from a shared URL or back-nav).
  - **If N is not dug → trigger generation exactly once**, then scroll to it.
  - **In both cases, `history.replaceState` strips `?dig` from the URL after firing** so a
    reload / back-forward never re-triggers generation (the job-lock's `GRACE_MS=15_000`
    window is not a sufficient guard on its own).
  - On generation **failure**: surface ⚠ on the section, **no auto-retry**; the user retries
    manually. Invalid/unknown N ⇒ no-op.
- **`show summary ⌃` / `show dug ⌄`** (dug): zero-fetch CSS toggle.
- **`⤢ expand all`**: confirm dialog with count + estimate
  (`Expand N remaining sections? ~$X, ~Y min (rough estimate)`) → **serialized** generation
  with a progress indicator (`section k of N…`). Skips sections that are **already dug or
  in-progress**. Includes a **Cancel** control during the batch: cancel **stops after the
  current section completes** (its result is persisted); already-completed sections stay dug.
  Navigating away mid-batch abandons the client loop — the in-flight section's server job
  still completes and persists (visible on next load). One section failing does **not** abort
  the batch; failures are collected and reported at the end.
- **`↑ summary`** (top bar): same-tab link back to the clean summary doc (no `#t` fragment —
  links to the top of the summary; see §11).

### bfcache (resolves HIGH-3)
Same-tab navigation means the browser back/forward cache may restore a **frozen** dig or
summary page with stale control states (e.g. a section dug in another visit still shows
`dig deeper ▶`). Add a `pageshow` listener: when `event.persisted` is true, re-fetch
`dig-state` and re-apply control states.

### #5 outcome
Every navigation is same-tab. "Back to summary" affordances are (a) the per-section CSS
toggle (inline compare) and (b) the one top-bar link. No tabs are spawned anywhere. The
`target="_blank"` added in `2a3bfc7` is removed from the dig control path in **both** the
`nav.ts` TS helper (`applyDugState`) **and** the duplicated inline `NAV_SCRIPT` string
(resolves LOW-1). The two-tab side-by-side compare affordance is intentionally dropped; the
per-section toggle replaces it (acceptable for a single-user tool — resolves LOW-12).

---

## 6. #1 — Stale Summary HTML (version-gated lazy re-render, rewrite-once)

The summary render output changes (per-section nav controls). **Export a single version
constant** `GENERATOR_VERSION` (e.g. in `render.ts`) — currently the literal
`magazine-skim v1` at `render.ts:104` — bump it to **`magazine-skim v2`**. The renderer emits
`<meta name="generator" content="${GENERATOR_VERSION}">`; the route imports the **same
constant** for its staleness comparator. One constant, two consumers ⇒ no drift between what
is written and what is checked (resolves HIGH-5).

### Reuse `reRenderSummaryHtml` — do not reimplement
`lib/html-doc/rerender.ts` already performs the stale re-render with an **atomic temp-file +
rename** (`:64-67`) and returns the discriminated union `ReRenderResult`
(`rerendered{htmlPath} | skipped-not-eligible | skipped-no-model | skipped-no-md |
skipped-unparseable | skipped-drift`). The `type=summary` GET reuses it. **Extend the
`rerendered` variant to also return the rendered HTML string** (`{htmlPath, html}`) so the
route serves the in-memory string and never re-reads disk after the write (resolves HIGH-4
read-side race).

### GET flow (`app/api/html/[id]/route.ts`, `type=summary`)
1. Read cached `htmls/<slug>.html`; extract its `<meta generator>` version.
2. **Version === `GENERATOR_VERSION`** → serve cached as-is (today's fast path, zero work).
3. **Version stale/missing** → call `reRenderSummaryHtml(videoId, outputFolder)` and map the
   result:

| `ReRenderResult` | GET outcome |
|---|---|
| `rerendered` | Serve the **returned HTML string** (cache already rewritten atomically) |
| `skipped-not-eligible` | Shouldn't occur (we have `summaryHtml`); serve cached as-is |
| `skipped-no-model` | **Serve the stale cached HTML** (it is renderable; the *model* is only needed for a fresh render) — do **not** 500 or show "unavailable". Log the reason. |
| `skipped-no-md` / `skipped-unparseable` | **Serve the stale cached HTML**; log the reason |
| `skipped-drift` | **Serve the stale cached HTML**; log the reason (summary changed vs model — regeneration is surfaced elsewhere, not here) |
| (cached read itself fails — no artifact) | 404 "regenerate the summary" |

**Rule:** if *any* servable cached HTML exists, serve it rather than erroring; only 404 when
there is no artifact at all.

### Concurrency
`reRenderSummaryHtml`'s temp+rename is atomic on POSIX: a concurrent reader always sees a
whole file (old or new), never a torn write. Two simultaneous stale GETs may both re-render
and both rename — wasted work, last-writer-wins, no corruption; re-render is idempotent. The
route serves the **HTML string returned** by `reRenderSummaryHtml` (not a post-write disk
re-read), so a concurrent writer cannot interleave into the served bytes.

### Version-bump enforcement (test, not memory)
A guard test snapshots that the rendered summary HTML contains
`content="${GENERATOR_VERSION}"`, and that the route's comparator treats `magazine-skim v1`
as **stale** against the current constant. If a future render change forgets to bump, the
snapshot diff flags it.

Tradeoff accepted: a `type=summary` GET may write to disk (cache rewrite) on a stale doc —
acceptable cache-warming for a local single-user tool.

---

## 7. Versioning & Migration

- **Summary:** no batch migration. Fresh-render-on-stale (§6) self-heals every existing
  summary on first view.
- **Dig companion `.md`:** format **unchanged** (delta store). **Verified (2026-06-24):** there
  is exactly **one** real companion on disk
  (`accelerating-ai-on-edge-…-dig-deeper.md`); its `sectionId`s `{16,133,231,343,663}` all
  match current summary `startSec`s `{16,133,231,343,663,1003,1150}`. So it renders correctly
  under the new merge renderer with **no migration**. The §3a keying contract (startSec →
  title fallback → orphan) covers any future drift. An E2E fixture uses this real companion's
  shape (not a synthetic one).
- **`digVersion`:** bumped only if the generation prompt/output changes during
  implementation; not required by the doc-model redesign alone.

---

## 8. Error Handling

| Failure | Behavior |
|---|---|
| Summary `.md` missing when rendering dig doc | Graceful page: "Summary unavailable — regenerate the summary first." No crash. |
| Model missing/invalid when rendering dig doc | Render title + timestamp **skeleton without gist** (still navigable + dug blocks shown); not a hard error (§3a) |
| Model section titles drift from summary (`!sameTitles`) | Affected sections render skeleton-without-gist (never wrong gist) (§3a) |
| Companion `sectionId` matches no summary section by startSec **or** title | **Orphan** — rendered in "Unmapped dug sections" region + HTML comment; never dropped (§3a) |
| Section has no `timeRange` (no `▶`) | Gist-only, `data-dug="false"`, no `data-start`, no dig trigger (§3a) |
| Slide asset missing (benign) | `.missing-slide` placeholder with escaped `alt` (§4) |
| Slide asset path fails containment | Drop silently — no placeholder, no alt leak (§4) |
| Generation fails (Gemini / yt-dlp / ffmpeg) | Per-section ⚠ + manual retry; section stays un-dug; rest of doc unaffected |
| `?dig=N` on an **already-dug** section | Scroll only, **no POST** (§5) |
| `?dig=N` reload / back-forward | `history.replaceState` stripped the param after first fire → no re-trigger (§5) |
| `?dig=N` auto-trigger fails | ⚠ on section, **no auto-retry**; param already stripped (§5) |
| `?dig=N` invalid/unknown N | No-op; render normally |
| `expand all` — one section fails | Continue remaining; collect + report failures at end; never abort the batch (§5) |
| `expand all` — user cancels mid-batch | Stop after the current section completes (persisted); prior sections stay dug (§5) |
| `expand all` — user navigates away mid-batch | Client loop abandoned; in-flight server job completes + persists (visible next load) (§5) |
| Summary/dig page restored from bfcache | `pageshow` (`event.persisted`) re-fetches `dig-state`, re-applies states (§5) |
| Stale summary cache + re-render skipped/throws | Serve stale cached HTML (servable artifact wins); 404 only if no artifact (§6) |

---

## 9. Components & Boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `lib/html-doc/render-dig-deeper.ts` (reworked) | Merge summary + model + companion → full-structure HTML; §3a keying/orphan; per-section gist/dug blocks; base64 images + split missing-asset guard | `parse.ts`, model envelope (`sourceSections`+`model`), companion parser |
| `lib/dig/companion-doc.ts` (unchanged format) | Delta store of dug sections; upsert | fs atomic write |
| `lib/html-doc/render.ts` (summary) | Per-section control → same-tab nav link (un-dug vs dug); emit `GENERATOR_VERSION` | `nav.ts` |
| `lib/html-doc/nav.ts` (reworked, dual-source mitigation below) | Dig-doc client state machine: in-place expand, toggle, expand-all confirm+progress+cancel, guarded `?dig=`, `pageshow`; summary-side nav links (no POST); remove `target=_blank` in TS **and** inline | `dig-state`, dig POST/SSE |
| `lib/html-doc/rerender.ts` (extended) | `rerendered` variant also returns rendered `html` string | parse + model + render |
| `app/api/html/[id]/route.ts` | `summary`: version-gated re-render via `reRenderSummaryHtml` + status mapping (§6). `dig-deeper`: now also reads `<base>.md` + `models/<base>.json` (M-4); all derived paths `path.resolve`'d + asserted within `outputFolder` (reuse `:51` containment); `<base>` from index field, not URL | `rerender.ts`, `render-dig-deeper.ts` |
| `app/api/videos/[id]/dig/[sectionId]/route.ts` (unchanged) | Per-section generation (Gemini + slides) | existing pipeline |

### nav.ts dual-source mitigation (resolves HIGH-6)
`nav.ts` carries a jsdom-testable TS module **and** a hand-duplicated inline `NAV_SCRIPT`
string (the browser can't import the module). To avoid expanding the untested duplicated
surface:
- **The new dig-doc state machine** (in-place expand, toggle, expand-all, guarded `?dig=`,
  `pageshow`) is authored **once, inline-only**, and its contract is **Playwright E2E in a
  real browser** (every behavior gets an E2E test). We do **not** write a second TS copy of
  this new logic — so no new TS/inline drift is created.
- **Summary-side edits** (nav-link controls, removing `target=_blank`) touch the existing
  `applyDugState` in **both** the TS helper and the inline string; both are updated, the TS
  side keeps its jsdom unit coverage, the inline side is covered by E2E.
- `type=dig-deeper` re-renders fresh on every GET (no HTML cache) — explicit decision (M-5);
  the added summary+model reads are cheap; base64 inlining cost is unchanged from today.

---

## 10. Testing

Layers per `docs/dev-process.md`. Mock Gemini/yt-dlp/ffmpeg at the lib boundary; E2E mocks
at the API-route level.

### Unit (jest)
- Merge renderer: summary order drives sections; dug overlay on matching `sectionId`;
  un-dug gist from model; mixed dug/un-dug; **zero-dug skeleton**.
- §3a keying: **orphan** companion `sectionId` (no startSec match, no title match) → rendered
  in "Unmapped dug sections", not dropped; **title-fallback** re-anchor (startSec drifted,
  title matched); **timestamp-less section** → gist-only/no-dig; **model drift** (`!sameTitles`)
  → skeleton-without-gist; **model missing** → skeleton-without-gist.
- Missing-asset: **benign missing-file** → `.missing-slide` with escaped alt; **containment
  fail** → silent drop (no placeholder, no alt leak).
- Version-gated re-render: current → cached served unchanged; each `ReRenderResult` status →
  its mapped GET outcome (esp. `skipped-no-model`/`skipped-drift` → serve stale, not 500);
  generator-version extraction; **guard test** asserts rendered HTML contains
  `GENERATOR_VERSION` and comparator treats `v1` as stale.
- Derived-path containment (summary/model/assets resolve within `outputFolder`).
- Expand-all estimate math (remainingCount × per-section cost/time; skip already-dug count).

### Component (RTL)
- Section state machine: un-dug → generating → dug.
- `show summary ⌃` / `show dug ⌄` toggle swaps visible block.
- Expand-all confirm dialog (count/estimate) + progress indicator.

### E2E (Playwright)
- Summary nav → dig doc **same tab** (assert no new tab opened; assert **all** URL params
  per the URL Contracts table; assert scroll to the section).
- `dig deeper ▶` in dig doc → section expands **in place** (no navigation).
- `?dig=N` auto-generation + scroll on load.
- Toggle compare (summary ↔ dug) without refetch.
- `?dig=N` on an **already-dug** section → scrolls, **no POST fired** (assert no POST via
  request spy); URL `?dig` stripped after fire (assert `history` updated).
- Toggle compare (summary ↔ dug) without refetch.
- `expand all` → confirm dialog shows **count + estimate text** → progress → all expanded;
  **cancel mid-batch** stops after current section (assert prior sections persisted).
- `↑ summary` → same-tab back to summary.
- **#1 regression:** a summary whose cached HTML lacks dig controls (generator `v1`) serves
  them after the version-gated re-render.
- bfcache: navigate away + back → `pageshow` re-fetches dig-state (assert refreshed state).
- **Fixtures:** (a) video with mixed dug/un-dug, (b) video with **zero** dug, (c) a
  **missing-asset** case, (d) the **real existing companion** shape (§7), (e) an **orphan**
  companion section (sectionId/title absent from summary).

---

## 11. URL Contracts

| Component | Link text | Full URL (same tab) |
|---|---|---|
| Summary §, un-dug | `dig deeper ▶` | `/api/html/<videoId>?outputFolder=<of>&type=dig-deeper&dig=<startSec>#t=<startSec>` |
| Summary §, dug | `view detail ↓` | `/api/html/<videoId>?outputFolder=<of>&type=dig-deeper#t=<startSec>` |
| Dig doc top bar | `↑ summary` | `/api/html/<videoId>?outputFolder=<of>&type=summary` (no `#t` fragment — top of summary; it is a doc-level link, not section-scoped) |
| Dig §, dug-trigger (client) | `dig deeper ▶` | POST `/api/videos/<videoId>/dig/<startSec>` body `{outputFolder[, force]}` |

## 12. Overlay / Dismissal Contracts

| Component | Mechanism | Expected result |
|---|---|---|
| Expand-all confirm dialog | Confirm button | Begins serialized generation with progress |
| Expand-all confirm dialog | Cancel / backdrop / Escape | Dismiss; no generation; doc unchanged |
| Expand-all progress | **Cancel button (mid-batch)** | Stop after current section completes (persisted); prior sections stay dug; dialog closes |
| Expand-all progress | Auto-close on completion | Returns to doc; all targeted sections expanded; failures (if any) reported |
| Per-section dug block | `show summary ⌃` / `show dug ⌄` toggle | Swaps visible block (no navigation, no fetch) |

---

## 13. Decided Defaults (were open; locked to keep implementation unblocked)
- **Spacing (#6):** `section{padding:2.4em 0}`, `2px` top rule between sections, `1.2em`
  vertical margin around dug-block slide `<img>`. Adjust only if a Phase-4 visual check
  shows a problem; these are the implementation targets.
- **Expand-all estimate:** fixed heuristic — `remainingCount` × `$0.05` and
  `remainingCount` × `~30s`, rendered as rounded `~$X` / `~Y min`. No live measurement.
- **Summary entry points:** per-section controls **only** (no separate top-level "open
  dig-deeper" link). Matches the existing summary layout; avoids a redundant affordance.
