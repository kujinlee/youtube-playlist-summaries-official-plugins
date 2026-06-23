# Deep-Dive H3 Subsection Timestamps

**Date:** 2026-06-23
**Branch:** `feat/deepdive-h3-timestamps`
**Status:** Design — pending adversarial review gate. (Design approved by the user earlier.)

## Problem

In deep-dive HTML, `## ` (H2) section timestamps get the polished muted `(label)` trailing-link treatment (`<a class="ts">`), but `### ` (H3) subsection ▶ lines are left to generic `md.render`, which emits a **literal `▶` glyph + a default-styled link**. Confirmed on `yB16BT1IMag`: 9 H2 ▶ rendered as `class="ts"`, but 11 H3 ▶ rendered as raw `▶ + plain <a>`. All are clickable, but the styling is inconsistent. This became visible after the lenient resolver (PR #18) produced ▶ on subsections too.

**Root cause** (`lib/html-doc/render-deep-dive.ts`): `splitSections` splits only on `## ` (H2). `renderSection` lifts the **first** ▶ line via `extractTimestamp` into the `<h2>`’s trailing `class="ts"` link, but the rest of the section body — including every `### ` heading and its leading ▶ — goes through plain `md.render(rest)`.

## Decision

Apply the H2 treatment one level down: within each H2 section's body, fold each `### ` subsection's leading ▶ into a muted `<a class="ts">(label)</a>` trailing the `<h3>`, mirroring `renderSection`.

**Approach** — add a helper that processes the H2 section's `rest` (the content after the gold lead):
- **Fence-aware** split `rest` into `{ preH3: string, subs: { heading, lines }[] }` by `### ` headings. The helper MUST copy `splitSections`' `inFence` toggle (`/^\s*(```|~~~)/`) verbatim — a `### ` line inside a ``` fence (e.g. the ASCII-diagram fixture) must NOT be promoted to a heading. Heading regex is pinned to `/^###\s+(.*)$/` so it matches H3 only — it rejects `#### ` (H4: the char after `###` is `#`, not whitespace) and `###x` (no space → CommonMark prose).
- `preH3` → `md.render` (unchanged).
- Each `### ` subsection → `extractTimestamp(lines)` (the existing helper; lifts a leading ▶), render `<h3>${md.renderInline(heading)}${tsHtml}</h3>` + `md.render(remaining lines)`, where `tsHtml` is the SAME `<a class="ts" …>(label)</a>` string `renderSection` builds for H2.
- **HTML composition (html:false):** build the `<h3>` as a STRING and `md.render` the body SEPARATELY (mirroring how `renderSection` composes `<h2>`). NEVER inject `<a class="ts">` into a markdown string passed to `md.render` — `html:false` would escape it. A plain `### Detail` must yield byte-identical `<h3>Detail</h3>` to today's `md.render` output (`md.renderInline` does not wrap in `<p>`); `### **X**` → `<h3><strong>X</strong></h3>`.

**Decisions baked in:**
1. **No gold lead for H3.** The `lead`/`lead-accent` first-sentence gold stays an H2-section signature (visual hierarchy). H3 gets only heading + muted ▶ link + normal body.
2. **`####` (H4) and deeper:** left to `md.render` (the generators don't emit ▶ on H4; folding only H3 covers the observed case). A ▶ leading an H4 would remain raw — acceptable, noted limitation.
3. **▶-less `### ` subsections:** render identically to today (`<h3>heading</h3>` + body) — `extractTimestamp` returns null, no trailing link. Output matches `md.render`'s `<h3>` (same `.dd h3` CSS), so no visual regression.
4. **Prose line starting with `▶`:** `extractTimestamp` consumes a subsection's first non-blank line if it starts with `▶`, regardless of TS-line validity — so a body line legitimately starting with `▶` (not a timestamp) is dropped. Same accepted contract as the H2 path; rare (generators emit only TS-line ▶).

**Version bump (`lib/deep-dive/version.ts`):** `CURRENT_DEEP_DIVE_VERSION` `{2,1} → {2,2}` (minor — HTML render/style change). This makes every current-major deep-dive doc **lazily re-render from its existing `.md`** on next open (`ensureDeepDiveHtml` minor-stale branch → `reRenderDeepDiveHtml`, no Gemini). Update the version comment (minor 2 = H3 subsection timestamps).

## Components & boundaries

| Unit | Responsibility | Change |
|------|----------------|--------|
| `lib/html-doc/render-deep-dive.ts` | fold H3 subsection ▶ into a muted `class="ts"` link trailing `<h3>` | Modify (`renderSection` + a new H3 helper) |
| `lib/deep-dive/version.ts` | bump minor `{2,1}→{2,2}` + comment | Modify |

`extractTimestamp`, `splitSections`, `takeFirstParagraph`, the CSS, and the H2 path are reused/unchanged. Summary renderer (`render.ts`) is untouched (magazine model, no subsection ▶).

## Migration

After merge: re-render the deep-dive docs so they pick up the H3 styling (throwaway script calling `reRenderDeepDiveHtml(videoId, folder)` per deep-dive video — reads `.md`, no Gemini). The script MUST surface non-`rerendered` statuses (`skipped-no-md`, etc.) rather than silently skipping.

**Scope:** the minor bump only affects **major-2** docs (cheap `reRenderDeepDiveHtml`). Pre-major-2 docs (`deepDiveVersion` absent/`{1,x}`) would full-regenerate via Gemini on open regardless of this change — the eager script re-renders only the major-2 ones from `.md`.

**Verification:** for a doc with H3 ▶ (e.g. `yB16BT1IMag`), confirm every **H3-led** ▶ becomes a `class="ts"` link. Do NOT hard-gate on "20 ts" until a grep confirms all of that doc's raw ▶ are H3-led (not H4-led); H4-led ▶ remain raw and are counted separately.

## Testing (TDD)

`tests/lib/html-doc/render-deep-dive.test.ts` (and a version-constant assertion):
1. **H3 with leading ▶ → muted trailing link:** a section with `## H2\n▶ [..](u)\n\n### Sub\n▶ [0:36–1:42](u2)\n\nbody` → output has `<h3>Sub <a class="ts" …>(0:36–1:42)</a></h3>` and the H3 ▶ does NOT appear as a literal leading `▶` glyph in a `<p>`.
2. **H3 without ▶ → unchanged:** `### Sub\n\nbody` → `<h3>Sub</h3>` + `<p>body</p>`, no `class="ts"` on it.
3. **H2 ▶ + gold lead still correct:** existing H2 behavior (trailing `class="ts"`, `lead-accent` first sentence) unchanged; H3 gets NO `lead`/`lead-accent`.
4. **Mixed:** preamble before the first `###` renders normally; multiple `###` subsections each fold their own ▶.
5. **Fenced `### `/▶ untouched:** a `### ` or ▶ inside a ``` fence is left verbatim (fence-aware split).
6. **Malformed H3 ▶ line consumed, not leaked:** a `▶` line that isn't a valid `TS_LINE_RE` is consumed (no raw `▶ [[`/token leaks), mirroring `extractTimestamp`'s contract.
7. **Version:** `CURRENT_DEEP_DIVE_VERSION` equals `{ major: 2, minor: 2 }`.

Full `npm test` + `npx tsc --noEmit` green before commit. Dual review per task.

## Out of scope

- H4+ ▶ folding (not produced by the generators).
- The summary renderer.
- Re-generating deep-dive `.md` (this is render-only; existing `.md` already carry the H3 ▶ from the lenient resolver / generation).
