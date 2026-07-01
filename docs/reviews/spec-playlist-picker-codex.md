# Codex Adversarial Review — Playlist Picker Design Spec

**Date:** 2026-06-30
**Target:** `docs/superpowers/specs/2026-06-30-playlist-picker-design.md`
**Reviewer:** Codex (fresh thread), adversarial mandate
**Gate:** Phase 1 spec review (AFK — substitutes for human approval per feedback-afk-autonomy)

---

## Findings (verbatim) + disposition

### Blocking

**B1 — `/api/playlists/recent?root=` path traversal.** "reuse assertOutputFolder-style check" anchors to home,
not the configured data root; a caller can point `root` at arbitrary home subtrees and enumerate
`*/raw/playlist-index.json` metadata. Needs normalize + realpath + reject traversal/symlink escapes + anchor to
an explicit allowed base.
→ **Disposition (accept-with-rationale + hardening note).** `assertOutputFolder` already normalizes (`path.resolve`)
and realpath-checks symlink escapes, rejecting anything outside `$HOME`. The picker route only **reads** playlist
metadata under the same guard the app **already** applies to ingest **writes** (`/api/ingest`), `/api/videos`,
`/api/html` — so it adds **no new exposure** beyond the existing app-wide boundary, and reads are strictly less
dangerous than the writes already permitted. The "Browse to any folder as root" UX means there is no single fixed
base to anchor to today. Documented as an accepted boundary for the localhost single-user app; **tightening to a
per-user base is tracked as multi-tenant hardening** in the cloud roadmap. Spec updated to state normalize+realpath
explicitly and to make the residual explicit. Addressed in plan Task 4 (assertOutputFolder + 400 on invalid).

**B2 — title persistence threading broken.** resolve-folder returns only `{root, outputFolder}`; `onIngest` gets
`(playlistUrl, outputFolder)`; no contract to return/thread `playlistTitle`.
→ **Fixed (plan already avoids client threading).** Title is persisted **server-side inside `runIngestion`**
(`lib/pipeline.ts`), which already holds `playlistUrl` + `apiKey` and calls `fetchPlaylistTitle` — the index stamp
at pipeline.ts:271 gains `playlistTitle`. For **display**, `playlistTitle` is surfaced via `/api/videos` (plan
Task 9) → page → Header caption (Task 12). No change to resolve-folder or `onIngest` needed. Spec updated to
describe this path.

### High

**H1 — `PlaylistIndexSchema` lacks `playlistTitle`.** → **Already in plan Task 1** (`z.string().optional()` added
to the schema; test asserts accept-with and accept-without). No change needed.

**H2 — handle parsing underconstrained** (no allowlist/length/decode/ID-regex). → **Fixed in plan Task 5.**
Tighten `parseChannelHandle` to strict forms: handle `^[A-Za-z0-9._-]{1,30}$`, channelId `^UC[A-Za-z0-9_-]{20,}$`;
reject otherwise (surface as ChannelNotFound / 400). Added tests for oversized/invalid input.

**H3 — recent provider must cover flat folders, not only `*/raw/`.** → **Already in plan Task 3**
(`readCandidate` checks `[dir/raw, dir]`, mirroring `output-folder.ts isPlaylistFolder`). No change needed.

### Medium

**M1 — contradiction: "never show a bare hash" vs fallback ending in `id`.** → **Fixed.** Display fallback chain
changed to `playlistTitle → folder slug → "Untitled playlist"` (synthetic). In `recent-provider` the folder name
always exists, so the id is never reached; the synthetic label is belt-and-suspenders. Spec + plan updated.

**M2 — invalid-root status codes / UI behavior undocumented.** → **Documented.** Route: 400 on missing/invalid
root (plan Task 4). UI (`PlaylistPicker.loadRecent`) shows empty recents on a non-OK response — accepted for a
read-only localhost picker; noted in spec.

**M3 — one-page (50) cap not surfaced in UI.** → **Fixed.** Channel panel shows a "showing first 50" note when
results length is 50 (plan Task 11). Spec updated.

**M4 — backfill read-modify-write lacks "do not run during ingest" guard.** → **Fixed.** Backfill script prints
the same concurrency warning the existing scripts carry (plan Task 8). Spec updated.

---

**Outcome:** All Blocking + High addressed (B2/H1/H3 already covered by the plan's approach; B1 accepted-with-
rationale + roadmap note; H2 tightened). All four Mediums addressed. Spec + plan updated accordingly. Gate
satisfied to proceed to the Post-Plan (plan) adversarial review.
