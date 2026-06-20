# Deep-Dive Version-Aware Regeneration (+ Timestamps) — Design Spec

> Bundle B from `docs/backlog.md` (#1 + #3). Brings the deep-dive HTML feature to
> full parity with the summary's version-aware regeneration (PR #4), and adds
> clickable per-section ▶ YouTube timestamps to deep-dives.

## 1. Goal

The deep-dive HTML currently serves a stale lazy-rendered cache, and the "Deep Dive"
menu button silently always-regenerates (no version check, no hourglass, no view
link on completion). Bring it to summary parity:

- a `deepDiveVersion` (`major.minor`) so clicking the menu brings the doc to the current version,
- an `ensureDeepDiveHtml` orchestrator mirroring `ensureHtmlDoc`,
- a unified version-aware **"Deep Dive doc"** menu action,
- the per-row hourglass while a deep-dive job runs,
- and **clickable ▶ timestamps** in deep-dives (the first major bump).

## 2. Decisions (locked during brainstorming)

| # | Decision |
|---|----------|
| D1 | **Timestamps are in scope.** The first `deepDiveVersion` is a MAJOR bump (re-generate `.md` to gain `[[TS:i]]` tokens), mirroring the summary's 1.0→2.0 timestamp rollout. |
| D2 | **Eager render + track `deepDiveHtml`.** On regeneration the HTML is rendered eagerly and its path stored in the index (mirroring `summaryHtml`). Unlocks "link when current" + "View Deep Dive doc" on completion. |
| D3 | **Orchestrator = Approach A:** a parallel module `lib/deep-dive/ensure.ts` mirroring `lib/html-doc/ensure.ts`. No shared generic abstraction (the generators differ too much); no inline-in-route logic. |
| D4 | **The `.md` IS the cached model.** Minor (style) bumps re-render straight from the existing `.md` — there is no `models/<base>.json` envelope for deep-dives. |
| D5 | **Version is stamped regardless of which cascade path ran.** A no-transcript (video-only) deep-dive is stamped `{2,0}` with no `▶` lines — version means "generated under the current pipeline," not "physically contains timestamps." Avoids a perpetual-"Update"-button trap. |
| D6 | **PDF left stale on regen** (`deepDivePdf` untouched), exactly as PR #4 decided for the summary. |
| D7 | **Two independent menu items.** "HTML doc" (summary) and "Deep Dive doc" remain separate, each independently version-aware. |
| D8 | **Non-blocking** status bar (mirror summary). Generation ~30s; the user keeps browsing. |
| D9 | **Extract the shared `isOlder` comparator** so both summary and deep-dive use one implementation (small consolidation, like the palette dedup). |

## 3. Deep-dive version

New `lib/deep-dive/version.ts` (parallel to `lib/doc-version.ts`):

- `DeepDiveVersion = { major: number, minor: number }` — reuses the `DocVersionSchema` shape.
- `CURRENT_DEEP_DIVE_VERSION = { major: 2, minor: 0 }`.
- `needsRegenerate(stored, current)` ⇒ `stored.major < current.major` (re-run Gemini cascade).
- `isOlder(a, b)` — extracted to a shared module (D9) and imported by both `doc-version.ts` and `deep-dive/version.ts`.

**Version meaning:**

| Bump | Trigger | Action |
|------|---------|--------|
| **major** | deep-dive `.md`/prompt format change (e.g. gaining `▶` timestamps) | re-run transcript cascade → regenerate `.md` → render HTML |
| **minor** | HTML render/CSS-only change | cheap re-render from existing `.md`, no Gemini |

**Baseline:** existing deep-dives have **no** `deepDiveVersion` → treated as `{1,0}`. `CURRENT` is
`{2,0}`, so every pre-Bundle-B deep-dive reads as stale and clicking regenerates it to gain timestamps.

### Staleness → action

For `stored = video.deepDiveVersion ?? {1,0}`:

| # | Condition | Action | Gemini? |
|---|-----------|--------|---------|
| 1 | `deepDiveMd` is null **or** `needsRegenerate(stored, CURRENT)` | run cascade → write `.md` → render HTML → store `deepDiveHtml` → stamp version | ✅ |
| 2 | `.md` current but `deepDiveHtml` null/missing | render HTML from existing `.md` → store → stamp | ❌ |
| 3 | `isOlder(stored, CURRENT)` (minor-only) | cheap `reRenderDeepDiveHtml` from `.md` → store → stamp | ❌ |
| 4 | else | no-op (already current) | ❌ |

Row 1 folds together "never generated" and "major-stale." Unlike "HTML doc" (disabled until a
summary exists), the deep-dive has **no prerequisite** beyond the video, so the menu item is
enabled whenever the video exists.

## 4. The `ensureDeepDiveHtml` orchestration

New `lib/deep-dive/ensure.ts`, signature mirroring `ensureHtmlDoc`:

```
ensureDeepDiveHtml(video, outputFolder, emit) → updated index fields
```

- Executes the Staleness→action table above.
- **Cascade** (unchanged order): `generateDeepDiveCombined` → `generateDeepDiveFromTranscript` → `generateDeepDive` (video-only).
- **Timestamps (resolved at generation, mirroring `generateSummary`):** the combined / transcript-only
  generators are fed `buildIndexedTranscript(segments)` (the `[i @m:ss] text` form) + the segments +
  `videoId`, instructed to emit own-line `[[TS:i]]` tokens at section boundaries, and call
  `resolveTranscriptTokens(...)` **internally before returning** — so the markdown they return already
  contains resolved `▶ [m:ss](youtube…&t=Xs)` lines (never raw tokens). `runDeepDive` writes that
  resolved markdown to the `.md`. **`renderDeepDiveHtml` is unchanged** — it just renders markdown.
  This is what keeps the minor-bump re-render network-free: the `.md` on disk already has `▶` lines,
  so re-rendering needs no transcript fetch.
- **Video-only path:** the video-only generator gets no segments → emits no tokens → no `▶` lines;
  still stamped `{2,0}` (D5). `resolveTranscriptTokens` also strips any stray token so none ever
  reaches the reader.
- **Stamping discipline:** `deepDiveVersion` + `deepDiveHtml` are written **only on full success**,
  after the HTML is written, and the terminal `done` SSE event is emitted **after** the stamp — so a
  UI refetch never sees a stamped-but-stale state (mirrors the summary rule).

## 5. Output File Format

The deep-dive `.md` at `major: 2` gains own-line section timestamp tokens, resolved at render time.

**Filename convention:** unchanged — `<slug>-deep-dive.md` in the playlist output folder (existing).

**`.md` body — annotated sample (transcript-grounded path, AS STORED):**

```markdown
## How the transformer attends to context

▶ [3:42–6:05](https://www.youtube.com/watch?v=<id>&t=222s)

The model computes attention weights across all positions … (prose)

## Why positional encoding matters

▶ [6:05–9:48](https://www.youtube.com/watch?v=<id>&t=365s)
```

- Gemini emits own-line `[[TS:i]]` tokens; the generator resolves them to the `▶` lines above
  **before** the `.md` is written (mirroring `generateSummary`). Raw `[[TS:i]]` tokens never appear
  in the stored `.md`.
- Video-only path: identical structure **without** the `▶` lines.

**Rendered HTML:** unchanged magazine deep-dive skin (PR #3) plus the resolved `▶` anchors. Path
stored in `deepDiveHtml` (new).

## 6. UI / UX

- **Menu** (`VideoMenu.tsx`): the menu today has **two** deep-dive items — "Deep Dive" (regenerate
  button) and "View Deep Dive HTML" (view link). **Unify them into one version-aware "Deep Dive doc"**
  item (exactly as the summary unified into "HTML doc"): **link** when current, **button** when
  stale/never-generated, **disabled + hourglass** when busy. "Open Deep Dive in Obsidian" and "View
  Deep Dive PDF" remain separate items (mirrors the summary keeping its Obsidian/PDF items).
- **Hourglass** (`VideoRow.tsx` / `page.tsx`): `busyVideoId` today tracks only the summary job. A row
  now shows the hourglass when **either** the summary or deep-dive job targets it. Each menu item
  disables only while *its own* job runs.
- **Status bar** (`DeepDiveStatusBar.tsx`): non-blocking bottom bar, enhanced to show a **"View Deep
  Dive doc"** link on `done` (today shows only "✓ Done"), with the same auto-close delay as the
  summary bar.

### URL Contracts

| Component | Link text | Full URL |
|-----------|-----------|----------|
| VideoMenu (current) | "Deep Dive doc" | `/api/html/[id]?type=deep-dive&outputFolder=<folder>` |
| DeepDiveStatusBar (on done) | "View Deep Dive doc" | `/api/html/[id]?type=deep-dive&outputFolder=<folder>` |
| In-doc section timestamp | `▶ m:ss` | `https://www.youtube.com/watch?v=<videoId>&t=<seconds>s` |

### Overlay Dismissal

| Component | Mechanism | Expected result |
|-----------|-----------|-----------------|
| DeepDiveStatusBar | ✕ close button | bar hidden immediately |
| DeepDiveStatusBar | auto-close after `done` | bar hidden after the summary bar's delay |

## 7. API

- **Route** (`app/api/videos/[id]/deep-dive/route.ts`): swap `runDeepDive` (always-full) for
  `ensureDeepDiveHtml` (version-aware). Adopt the summary route's machinery it currently lacks:
  **double-submit guard** (return existing `jobId` for an in-flight video), **job-lock release** on
  success, and **15s grace delete**. Request `POST { outputFolder }` → `{ jobId }`; SSE at
  `/deep-dive/stream?jobId=…`. The PR #5 dev-logger wiring stays.
- **Serve route** (`app/api/html/[id]/route.ts`, `type=deep-dive`): read the stored `deepDiveHtml`
  path (like the summary). If null — an old deep-dive never regenerated under Bundle B — fall back to
  the existing lazy-render so old links don't break (graceful degradation).

## 8. Error Handling

- **All 3 cascade paths fail** → emit error SSE event; dev-logger records the full cause chain
  (PR #5); `errorSummary` surfaces to the UI; **version is NOT stamped** (next click retries).
- **Render fails after a successful `.md` regen** → no stamp; `.md` is on disk but the doc stays
  "stale" so the next click re-renders. No partial-success stamping.
- **Transient Gemini errors** → covered by the PR #5 retry treatment on the relevant calls.
- **No-transcript video** → not an error; cascade lands on video-only and stamps `{2,0}` (D5).

## 9. Testing

Layers: unit (jest) → component (@testing-library/react) → E2E (Playwright). Mock at
`lib/gemini.ts` / `lib/youtube.ts` for unit/component; at the **route level** for E2E.

**Unit:**
- `lib/deep-dive/version.ts` — `isOlder`/`needsRegenerate` truth table.
- `lib/deep-dive/ensure.ts` — every row of the decision tree; version stamped only on full success,
  never on failure; null `.md` → generate; each cascade fallback; **video-only → `{2,0}`, no `▶`**.
- `renderDeepDiveHtml` token resolution — `[[TS:i]]` → `▶` links; tokens absent → no `▶` lines.
- Deep-dive prompt builders — fed indexed transcript + emit token instruction (mocked Gemini).
- Extracted shared `isOlder` — plus a **regression run of the existing summary `doc-version`/`ensure`
  tests** to prove the consolidation didn't disturb the merged summary flow.

**Component:**
- `VideoMenu` — "Deep Dive doc" link / button / disabled+hourglass; **optional-prop rendering for
  both null and set** states of `deepDiveHtml` and `deepDiveVersion`.
- `VideoRow` — hourglass when the deep-dive (or summary) job targets the row.
- `DeepDiveStatusBar` — View link on `done`; **both dismissal paths** (✕ and auto-close).

**E2E (route-level mocks):**
- Fixtures cover **null and non-null** `deepDiveHtml`/`deepDiveVersion`, including a **no-transcript** video.
- Stale (pre-Bundle-B) video → click → regenerates → `▶` timestamps appear, `{2,0}` stamped, served
  HTML has `▶` anchors.
- **Link assertions check ALL params** (`type=deep-dive` *and* `outputFolder`).
- Both dismissal paths exercised; 2nd click on current → link, no regen (idempotent).

**Process:** this feature clears the bar (>8 behaviors, SSE async state machine, multiple error
paths), so the **behaviors-table Codex adversarial review** is mandatory before writing tests.

## 10. Non-Goals

- **PDF regeneration** — `deepDivePdf` left stale (D6); the print/PDF story is Bundle C (#2).
- **Deep-dive as aligned/expandable detail view** — backlog #8, explicitly someday.
- **Summary–deep-dive version coupling** — the two artifacts version independently (D7).
- **Migration/backfill** — `deepDiveVersion` is optional; absent ⇒ `{1,0}`. No bulk migration.

## 11. File Structure

```
lib/
  shared-version.ts            (new — extracted isOlder comparator)   [D9]
  doc-version.ts               (import isOlder from shared)
  deep-dive/
    version.ts                 (new — DeepDiveVersion, CURRENT, needsRegenerate)
    ensure.ts                  (new — ensureDeepDiveHtml orchestrator)
  deep-dive.ts                 (cascade fed segments; passes them to generators)
  gemini.ts                    (deep-dive generators: indexed transcript + token instruction +
                                resolveTranscriptTokens internally → return resolved ▶ markdown)
  html-doc/
    render-deep-dive.ts        (UNCHANGED — renders markdown that already has ▶ lines)
    generate-deep-dive.ts      (runDeepDiveHtml + reRenderDeepDiveHtml; eager render writes html + path)
app/api/videos/[id]/deep-dive/route.ts   (drives ensureDeepDiveHtml; guard + lock + grace)
app/api/html/[id]/route.ts               (type=deep-dive reads stored deepDiveHtml)
components/
  VideoMenu.tsx                ("Deep Dive doc" version-aware item)
  VideoRow.tsx                 (hourglass for either job)
  DeepDiveStatusBar.tsx        (View link on done)
types/index.ts                 (+ deepDiveVersion?, + deepDiveHtml?)
```
