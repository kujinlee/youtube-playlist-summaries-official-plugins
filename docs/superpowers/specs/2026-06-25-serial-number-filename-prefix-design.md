# Design — Serial-Number Filename Prefix

**Date:** 2026-06-25
**Status:** APPROVED (user sign-off 2026-06-25; 3 open decisions confirmed: meta-rewrite provenance, document max+1 race, fixed 3-digit pad; +`^\d+_` strip-safety clarified). Adversarial-reviewed (Claude fallback; F1/F2 HIGH + F3/F4/F6/F7/F8 addressed — see `docs/reviews/spec-serial-number-filename-prefix-review.md`). → proceeding to implementation plan.
**Related:** [`2026-06-23-playlist-index-current-position-design.md`](2026-06-23-playlist-index-current-position-design.md) (the `playlistIndex` change this spec deliberately does NOT reuse)

---

## 1. Problem

Output files (raw summary `.md` and all derived `.html`/`.pdf`/model/companion files) are named by a kebab-case slug of the video title only, e.g. `software-fundamentals-matter-more-than-ever-matt-pocock.md`. There is no number in the filename.

A numeric prefix (`007_<slug>.md`) **used to exist** but was deliberately removed in commit `824bd38` (2026-05-22, "drop rank prefix from filenames") so files would sort alphabetically by title in Finder. A migration `migrateToSlugFilenames()` still actively *strips* any `NNN_` prefix on every `GET /api/videos`.

The user wants the numeric prefix back — a **human-facing serial that lets you locate a file quickly** — but as a **stable, ingestion-time-determined, monotonically-increasing** number.

### 1.1 Key terminology correction (resolved during brainstorming)

The user initially believed the recent `playlistIndex` fix made the number "keep increasing." It did the **opposite**: commit `42483e1` (2026-06-23) made `playlistIndex` **re-derive from the video's current playlist position on every sync** (fixing 12 videos frozen at `#1`). `playlistIndex` is therefore **unique at a point in time but unstable** — it shifts on playlist reorder / removal / re-add.

**Decision:** `playlistIndex` stays exactly as-is — it remains the UI "#" column (live playlist position) and is **NOT** used in filenames. A **new, independent, write-once `serialNumber`** is introduced for the filename prefix.

---

## 2. Goals / Non-Goals

**Goals**
- Add a stable, write-once, monotonically-increasing `serialNumber` to each video that has output files.
- Prefix every output filename for that video with the zero-padded serial: `NNN_<slug>.<ext>`.
- Backfill existing files (one-time) and assign serials to new videos at ingest, going forward.
- Keep all references consistent after rename (index path-fields, HTML provenance meta, Obsidian links).

**Non-Goals**
- No change to `playlistIndex` semantics or the UI "#" column.
- No change to slug generation (`slugify`) or collision handling beyond placement of the prefix.
- No change to slide-asset storage (assets are keyed by `videoId`, not slug — unaffected).
- No reuse/recycling of serials when a video is removed.

---

## 3. Data Model

Add to the video schema (`types/index.ts`):

```ts
serialNumber: z.number().int().positive().optional(),
```

- **Write-once.** Once assigned to a video, it is never recomputed or changed (unlike `playlistIndex`).
- **Source of truth for the number.** The filename embeds it for humans; the field is authoritative so we never parse it back out of filenames.
- **Per output folder (per playlist).** Serials are local to a playlist's `raw/` folder; each playlist has its own `001..N`.
- Absent (`undefined`) for videos that have no output files yet (in-playlist but not summarized).

---

## 4. Filename Convention (Output File Format)

`NNN_<slug>.<ext>` — zero-padded serial, underscore separator, then the existing slug.

- **Padding:** minimum 3 digits (`001`). Auto-widens past 999 (→ `1000_`). Width is derived from `String(serialNumber).padStart(3, '0')`.
- **Separator:** underscore `_` (matches the historical `NNN_` convention; visually distinct from the slug's own hyphens).
- **Applies to every artifact that shares the base slug:**

| Artifact | Before | After |
|---|---|---|
| Summary md | `<slug>.md` | `001_<slug>.md` |
| Summary pdf | `pdfs/<slug>.pdf` | `pdfs/001_<slug>.pdf` |
| Summary html | `htmls/<slug>.html` | `htmls/001_<slug>.html` |
| Magazine model | `models/<slug>.json` | `models/001_<slug>.json` |
| Deep-dive md | `<slug>-deep-dive.md` | `001_<slug>-deep-dive.md` |
| Deep-dive pdf/html/model | `…<slug>-deep-dive.*` | `…001_<slug>-deep-dive.*` |
| Dig-deeper companion md | `<slug>-dig-deeper.md` | `001_<slug>-dig-deeper.md` |
| Dig-deeper html | `htmls/<slug>-dig-deeper.html` | `htmls/001_<slug>-dig-deeper.html` |

- **Slug collisions** still resolved by the existing `-2`, `-3` suffix on the *slug* (before prefixing): `001_hello-world.md`, `005_hello-world-2.md`.
- **Slide assets unaffected:** image refs inside the dig-deeper md are `assets/<videoId>/<sectionId>-<sec>.jpg` (keyed by `videoId`) — no rename, no content rewrite.

### 4.1 Example

```
001_software-fundamentals-matter-more-than-ever-matt-pocock.md
001_software-fundamentals-matter-more-than-ever-matt-pocock-dig-deeper.md
htmls/001_software-fundamentals-matter-more-than-ever-matt-pocock.html
pdfs/001_software-fundamentals-matter-more-than-ever-matt-pocock.pdf
models/001_software-fundamentals-matter-more-than-ever-matt-pocock.json
002_accelerating-ai-on-edge-chintan-parikh-and-weiyi-wang-google.md
```

---

## 5. Serial Assignment

The serial is computed from `max(serialNumber)` over the **whole folder index** (including archived/removed videos, which retain their serial) `+ 1`, falling back to `1`. The index `serialNumber` field — never the filename — is the source for `max`.

### 5.1 Going forward (ingest)
In the ingestion pipeline (`lib/pipeline.ts`), when a new video first produces a summary file, assign `serialNumber = max(serialNumber over folder index) + 1`. Write-once. The slug + collision logic runs first; the prefix is applied to the resolved base name.

**Concurrency (F6 / ADR-005):** `playlist-index.json` is written without locking (ADR-005 single-writer assumption). To avoid two concurrent same-folder ingests reading the same `max` and assigning a duplicate serial, the `max+1` read **must occur inside the same read-modify-write critical section** as the `upsertVideo` that persists the new video (not as a separate earlier read). This narrows but does not eliminate the race; the app is single-user, so we **document** the residual risk rather than add locking. A concurrent ingest *and* a `--apply` migration on the same folder is disallowed (operator constraint, stated in script help).

### 5.2 Backfill (existing files — one-time)
Order all videos **that currently have output files** by `processedAt` ascending (a required, always-populated schema field), tie-break by `videoId` (deterministic, total order). Assign `1..N` in that order. Most faithful proxy for "ingestion order" for the existing backlog.

### 5.3 Monotonicity / no reuse
- Removed/archived videos **retain** their `serialNumber` and their (renamed) files, so `max + 1` never reuses a number.
- `serialNumber` is never recomputed for a video that already has one.
- **Orphan recovery (F7):** `recoverOrphanedVideos` / `reconstructVideo` (`lib/pipeline.ts`) rebuilds a video from files on disk and does **not** set `serialNumber`. After this feature ships, a recovered file may be prefixed (`NNN_<slug>.md`). Recovery is therefore the **one** place permitted to parse the serial back out of the filename: `reconstructVideo` must adopt the leading `NNN_` (if present) into `serialNumber`, so the field and filename never drift and a later `max+1` counts it.

---

## 6. Migration Mechanism (Approach A)

A dedicated migration script `scripts/backfill-serial-prefix.ts` — **dry-run by default**, matching the repo's dry-run-default repair precedent (timestamp guard/audit/repair, PR #17). `--apply` executes; `--folder <path>` targets one playlist folder.

The migration is **two-phase** specifically to be crash-resumable without serial drift (addresses F1):

### Phase A — assign serials (index only, atomic)
Order target videos (those with output files, lacking a `serialNumber`) per §5.2 and assign `1..N` continuing from `max+1`. Persist **all** new `serialNumber`s in a **single atomic** `playlist-index.json` write (existing temp-file→rename write path). No file operations occur in Phase A.

Why first: once `serialNumber` is committed, every target filename in Phase B is a **pure, deterministic function** of the committed serial + current slug-base. A crash + resume recomputes the **identical** names — assignment can never diverge (which was the F1 data-loss path). Phase A is idempotent: videos that already have a `serialNumber` are skipped.

### Phase B — rename files + fix references (per-video, idempotent)
For each video with a `serialNumber`, derive the base from its **current index path-field** (stripping any existing leading serial prefix matching `^\d+_` to avoid double-prefix), then for every artifact that exists:

> **Strip-pattern safety:** the prefix delimiter is an **underscore** (`^\d+_`), and `slugify` (`lib/slugify.ts`) emits only lowercase alphanumerics and **hyphens** — never underscores. So a legitimate slug that begins with digits (e.g. `2024-ai-predictions`) can never be mistaken for a serial prefix; the `^\d+_` strip is unambiguous and cannot eat slug content.


1. **Compute** target = `<dir>/<NNN>_<base><suffix><ext>`.
2. **Rename guard (F2):** rename **only if** `exists(src) && !exists(dst)`. If `dst` already exists and is the intended file (basename matches the committed serial), treat as already-done and skip. If `dst` exists with a *different* origin, **abort this video** with a logged conflict — never clobber (mirrors `migrateToSlugFilenames:222`).
3. **Provenance (F3/F4) — meta-rewrite, not re-render:** in each renamed rendered HTML (summary `render.ts:107`, deep-dive `render-deep-dive.ts:230`, dig-deeper `render-dig-deeper.ts:268`), do a targeted string-rewrite of `<meta name="source-md" content="OLD">` → new name. Also rewrite the model envelope's internal `sourceMd` (`model-store.ts:14`) when renaming `models/<base>.json`. This is deterministic and **does not depend on a model file existing** (old summaries predating the persisted-model feature have no `models/<base>.json`; re-render would no-op on them — `rerender.ts:38` `skipped-no-model`). Missing HTML/model → that step is a no-op, not a failure.
4. **Per-video index update (F1):** immediately persist this video's updated `serialNumber` (already set in Phase A) and its 8 path-fields via a single-video update (`updateVideoFields`), bounding blast radius to one video. Do **not** batch all videos into one end-of-run write.

**Archived files (F8):** archived videos still have index entries with path-fields, but their files live under `archived/<relPath>` (archive moves only `summaryMd/summaryPdf/deepDiveMd/deepDivePdf`, not `digDeeper*`/`*Html`/models). Phase B resolves each artifact at its **actual on-disk location** (root or `archived/`) and renames in place, keeping the index field's stored relative form consistent. (Edge case 3 below corrected accordingly.)

**The 8 index path-fields:** `summaryMd`, `summaryPdf`, `deepDiveMd`, `deepDivePdf`, `summaryHtml`, `deepDiveHtml`, `digDeeperMd`, `digDeeperHtml` (verified complete — `types/index.ts:55-62`). The `models/<base>.json` file is **not** an index field but **is** renamed (derived from `summaryMd` base).

**Remove the stripper:** delete `migrateToSlugFilenames()` and its single caller at `app/api/videos/route.ts:71`. Verified: it has no other caller, and the adjacent `recoverOrphanedVideos` call (line 70) is an independent try/catch — removal does not affect orphan recovery (F7).

---

## 7. References That Must Stay Consistent

| Reference | Handling |
|---|---|
| `playlist-index.json` path fields (8) | Updated per-video during Phase B / set at ingest |
| `<meta name="source-md">` in rendered HTML — **3 emitters** (summary `render.ts:107`, deep-dive `render-deep-dive.ts:230`, dig-deeper `render-dig-deeper.ts:268`) | Targeted meta string-rewrite (§6 Phase B step 3), not re-render |
| Model envelope internal `sourceMd` (`model-store.ts:14`) | Rewritten when `models/<base>.json` is renamed |
| Obsidian vault links (`VideoMenu.tsx`) | Auto-correct — derived client-side from index fields |
| Dig-deeper companion name (`dig/[sectionId]/route.ts:150`) | Derived from `summaryMd` basename at generation → a fresh re-dig self-corrects to the prefixed name |
| Serve route base inference (`app/api/html/[id]/route.ts:122-142`) | Operates on index `summaryMd`/`digDeeperMd` basenames → works post-rename |
| Slide assets (`assets/<videoId>/…`) | Unaffected (keyed by videoId) |
| Orphan recovery (`reconstructVideo`) | Must adopt leading `NNN_` from recovered filename into `serialNumber` (§5.3) |

---

## 8. Edge Cases

| # | Case | Expected |
|---|---|---|
| 1 | Video in playlist, no summary file yet | No `serialNumber`, no rename; gets one when first summarized |
| 2 | Slug collision (same title) | `-2` suffix on slug, then prefixed: `005_hello-world-2.md` |
| 3 | Removed/archived video with files (under `archived/`) | Files renamed in place at their actual location; serial retained; counter never reuses (F8) |
| 4 | Re-run migration | Idempotent: Phase A skips videos with a serial; Phase B skips files already at the committed `NNN_` name |
| 5 | Crash mid-migration, then resume | Safe (F1): Phase A serial is committed atomically first, so Phase B target names are deterministic on resume — no divergent reassignment; per-video index writes bound the blast radius |
| 6 | Rename target `NNN_<slug>` already exists | If it's the intended file → skip; if different origin → abort that video, log conflict, **no clobber** (F2) |
| 7 | serial > 999 | Becomes `1000_` (4 digits); see O-1 on lexical sort at the boundary |
| 8 | A derived file (e.g. pdf) missing while md exists | Rename only what exists; index field stays null; provenance/meta steps no-op |
| 9 | Old summary with no `models/<base>.json` | Meta-rewrite still fixes `source-md` (no re-render dependency); model rename/envelope-rewrite skipped (F4) |
| 10 | Concurrent same-folder ingests | Residual race documented (F6); `max+1` read inside the `upsertVideo` critical section; migration `--apply` must not run concurrently with ingest |
| 11 | Orphaned prefixed file recovered later | `reconstructVideo` adopts the `NNN_` serial into `serialNumber` (F7) |

---

## 9. Testing Strategy

- **Unit (serial assignment):** ordering (processedAt asc, tie-break videoId), `max+1` continues over archived/removed serials, write-once (no recompute), collision interaction, padding/format (`001`, `1000`).
- **Unit (Phase A):** assigns to videos lacking a serial; atomic single index write; idempotent (skips videos that already have a serial).
- **Unit (Phase B):** full rename cascade updates all present artifacts + 8 index fields + `models/<base>.json`; `exists(src)&&!exists(dst)` guard; **conflict-abort** when `dst` exists with different origin (no clobber); **crash-resume** produces identical names (no drift) given a committed serial; archived files renamed under `archived/`; missing artifact / missing model → no-op not failure.
- **Unit (provenance):** `source-md` meta string-rewrite fixes all 3 emitters (summary/deep-dive/dig-deeper) to the new `.md` name; envelope `sourceMd` rewritten on model rename; old doc with no model file still gets meta fixed.
- **Unit (recovery):** `reconstructVideo` adopts the `NNN_` serial from a prefixed filename into `serialNumber`.
- **Dry-run:** emits the full plan and writes nothing to disk or index.
- **E2E:** after migration, the serve route (`/api/html/[id]`) resolves the renamed summary + dig-deeper files; Obsidian hrefs in the menu point at prefixed names; a fresh re-dig writes a prefixed `digDeeperMd`.

---

## 10. Open Questions

- **O-1 (sort past 999):** fixed 3-digit padding means `1000_` sorts before `999_` lexically. Acceptable given per-playlist counts (~236 today). Revisit only if a single playlist approaches 1000. (Default: leave as fixed-3-pad.)
- **O-2 (RESOLVED — provenance via meta-rewrite):** §6 Phase B uses a targeted `source-md` meta string-rewrite, **not** re-render. Chosen because re-render no-ops on summaries that predate the persisted-model feature (`rerender.ts:38` `skipped-no-model`) and there are 3 distinct emitters; a string-rewrite is deterministic and dependency-free. Re-render is **not** used by the migration.

---

## 11. Out of Scope / Deferred

- Changing Finder sort behavior expectations (prefix restores numeric/ingest-order sort, reversing `824bd38`'s alphabetical-by-title intent — this is the user's explicit choice).
- Any `playlistIndex` change.
- Reusing freed serials.
