# Design — Serial-Number Filename Prefix

**Date:** 2026-06-25
**Status:** Approved (design) — pending spec review → implementation plan
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

### 5.1 Going forward (ingest)
In the ingestion pipeline (`lib/pipeline.ts`), when a new video first produces a summary file:
```
serialNumber = max(serialNumber over all videos in this folder's index) + 1   // 1 if none
```
Assigned once and written to the index. The slug + collision logic runs first; the serial prefix is applied to the resolved base name.

### 5.2 Backfill (existing files — one-time)
Order all videos **that currently have output files** by `processedAt` ascending, tie-break by `videoId` (deterministic). Assign `1..N` in that order. This is the most faithful proxy for "ingestion order" for the existing backlog.

### 5.3 Monotonicity / no reuse
- Removed/archived videos **retain** their `serialNumber` and their (renamed) files on disk, so `max + 1` never reuses a number.
- `serialNumber` is never recomputed for a video that already has one.

---

## 6. Migration Mechanism (Approach A)

A dedicated migration script — **dry-run by default**, matching the repo's existing dry-run-default repair precedent (timestamp guard/audit/repair, PR #17).

`scripts/backfill-serial-prefix.ts`:
- **Default (dry-run):** prints the planned per-video rename map (old → new for every artifact) and the assigned serial; touches nothing.
- **`--apply`:** executes. Per video, idempotently:
  1. Resolve serial (existing `serialNumber`, else assign per §5.2).
  2. Rename each existing artifact file on disk to its `NNN_`-prefixed name.
  3. Set `serialNumber` and update the 8 index path-fields (`summaryMd`, `summaryPdf`, `deepDiveMd`, `deepDivePdf`, `summaryHtml`, `deepDiveHtml`, `digDeeperMd`, `digDeeperHtml`).
  4. Re-render the derived HTML so `<meta name="source-md">` reflects the new `.md` name (offline render from index + model; no external API).
  5. Single read-modify-write of `playlist-index.json` (consistent with ADR-005).
- **Idempotent:** a file already matching `NNN_<slug>` is skipped; re-running is a no-op.
- **`--folder <path>`** to target a specific playlist folder.

**Remove** `migrateToSlugFilenames()` and its `GET /api/videos` invocation (it would otherwise strip the new prefixes). Confirm no other caller depends on it.

---

## 7. References That Must Stay Consistent

| Reference | Handling |
|---|---|
| `playlist-index.json` path fields (8) | Updated in-place during migration / set at ingest |
| `<meta name="source-md">` in rendered HTML | Fixed by re-render step (§6.4) |
| Obsidian vault links (`VideoMenu.tsx`) | Auto-correct — derived client-side from index fields |
| Dig-deeper companion name (`route.ts`) | Derived from `summaryMd` basename at generation → naturally picks up the prefix once `summaryMd` is prefixed |
| Serve route base inference (`app/api/html/[id]/route.ts`) | Operates on index `summaryMd`/`digDeeperMd` basenames → works post-rename |
| Slide assets (`assets/<videoId>/…`) | Unaffected (keyed by videoId) |

---

## 8. Edge Cases

| # | Case | Expected |
|---|---|---|
| 1 | Video in playlist, no summary file yet | No `serialNumber`, no rename; gets one when first summarized |
| 2 | Slug collision (same title) | `-2` suffix on slug, then prefixed: `005_hello-world-2.md` |
| 3 | Removed/archived video with files | Keeps serial + (renamed) files; counter never reuses |
| 4 | Re-run migration | Idempotent no-op for already-prefixed files |
| 5 | Partial failure mid-migration | Re-run resumes; already-renamed entries skipped |
| 6 | serial > 999 | Becomes `1000_` (4 digits); see Open Question O-1 on sort at the boundary |
| 7 | A derived file (e.g. pdf) missing while md exists | Rename only what exists; index field stays null |
| 8 | New ingest while some files unprefixed | `max+1` still correct (reads `serialNumber` field, not filenames) |

---

## 9. Testing Strategy

- **Unit (`lib/pipeline` + new serial module):** assignment ordering (processedAt asc, tie-break videoId), `max+1`, write-once (no recompute), collision interaction, padding/format (`001`, `1000`).
- **Unit (migration):** full rename cascade updates all present artifacts + 8 index fields; dry-run emits a plan and writes nothing; idempotent re-run is a no-op; missing-artifact handled.
- **Component/render:** re-rendered HTML `<meta name="source-md">` equals the new `.md` name.
- **E2E:** after migration, the serve route (`/api/html/[id]`) resolves the renamed summary + dig-deeper files; Obsidian hrefs in the menu point at prefixed names.

---

## 10. Open Questions

- **O-1 (sort past 999):** fixed 3-digit padding means `1000_` sorts before `999_` lexically. Acceptable given per-playlist counts (~236 today). Revisit only if a single playlist approaches 1000. (Default: leave as fixed-3-pad.)
- **O-2 (re-render vs meta-rewrite):** §6.4 specifies full offline re-render for correctness. If re-render proves heavy, fall back to a targeted string-rewrite of the `source-md` meta. (Default: re-render.)

---

## 11. Out of Scope / Deferred

- Changing Finder sort behavior expectations (prefix restores numeric/ingest-order sort, reversing `824bd38`'s alphabetical-by-title intent — this is the user's explicit choice).
- Any `playlistIndex` change.
- Reusing freed serials.
