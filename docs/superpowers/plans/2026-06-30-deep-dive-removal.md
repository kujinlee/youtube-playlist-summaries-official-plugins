# Deep-Dive Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the deep-dive feature entirely (whole-video Gemini analysis + its doc), leaving summary and dig-deeper fully intact.

**Architecture:** Peel the feature from the outside in across ordered, individually-green commits: (1) delete on-disk artifacts; (2) remove the UI + API entry points so deep-dive is unreachable; (3) delete the dedicated lib/gemini/render code and fix its remaining importers; (4) surgically trim the shared `nav.ts` inline script; (5) remove the schema fields atomically. Deleting inner code before its outer callers would break the build, so callers are severed first.

**Tech Stack:** Next.js (custom build — read `node_modules/next/dist/docs/` before any config/runtime API doubt), TypeScript, Zod, jest + ts-jest/SWC, Playwright.

## Global Constraints

- Full jest suite runs serially: `npm test`. Type gate: `npx tsc --noEmit` (jest uses SWC, no typecheck — tsc is the real gate for fixture/type breakage).
- Zod `VideoSchema` is **non-strict** → stale `deepDive*` keys in existing `index.json` drop on next write. No data migration.
- **NEVER touch `*-dig-deeper.*` files or dig-deeper code.** `*-deep-dive` and `*-dig-deeper` are different features; the globs are distinct (`-deep-dive` vs `-dig-deeper`).
- KEEP: `DocVersion`/`DocVersionSchema`/`docVersion`/`CURRENT_DOC_VERSION` (summary uses them), `transcript-source.ts`, `theme.ts`, summary "dig deeper ▶" nav, the dig-state machine in `nav.ts`.
- Data repo (`../youtube-playlist-summaries-official-plugins-data`) is separate; `건강/` is not git-tracked (deletion irreversible).
- Commit footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
  ```

---

### Task 1: Delete on-disk deep-dive artifacts (data repo)

**Files (data repo, not code repo):** 24 `*-deep-dive.md` + 16 `*-deep-dive.html` across `agentic-ai-claude-code`, `cs146s-the-modern-software-development`, `건강` (`raw/` + `archived/` + `htmls/`).

**Interfaces:** None (filesystem only).

- [ ] **Step 1: Re-confirm counts and that no dig-deeper files match**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data
echo "deep-dive md:   $(find . -name '*-deep-dive.md' | wc -l | tr -d ' ')"
echo "deep-dive html: $(find . -name '*-deep-dive.html' | wc -l | tr -d ' ')"
echo "dig-deeper (must stay): $(find . -name '*-dig-deeper.*' | wc -l | tr -d ' ')"
```
Expected: `24`, `16`, and a non-zero dig-deeper count that must be UNCHANGED after deletion.

- [ ] **Step 2: Delete only the deep-dive files**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data
find . -name '*-deep-dive.md' -delete
find . -name '*-deep-dive.html' -delete
```

- [ ] **Step 3: Verify deep-dive gone, dig-deeper intact**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data
echo "deep-dive remaining: $(find . -name '*-deep-dive.*' | wc -l | tr -d ' ')"   # expect 0
echo "dig-deeper remaining: $(find . -name '*-dig-deeper.*' | wc -l | tr -d ' ')" # expect unchanged
```

- [ ] **Step 4: Commit the deletions in the two git vaults**

```bash
for d in agentic-ai-claude-code cs146s-the-modern-software-development; do
  cd "/Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data/$d"
  [ -n "$(git status --porcelain)" ] && git add -A && git commit -q -m "chore: remove deep-dive docs (feature retired; dig-deeper supersedes)" && echo "$d committed $(git rev-parse --short HEAD)" || echo "$d: no tracked changes"
done
# 건강 is not git-tracked — files already removed.
```

---

### Task 2: Remove deep-dive UI + API entry points

Make deep-dive unreachable from the app. The schema fields and lib code still exist after this task (removed later), so these edits compile.

**Files:**
- Delete: `app/api/videos/[id]/deep-dive/route.ts` (+ the now-empty `deep-dive/` dir), `tests/api/deep-dive-post.test.ts`
- Delete: `components/DeepDiveOverlay.tsx`, `components/DeepDiveStatusBar.tsx`, `tests/components/DeepDiveOverlay.test.tsx`, `tests/components/DeepDiveStatusBar.test.tsx`
- Delete: `tests/api/html-serve-deep-dive.test.ts`
- Modify: `app/api/html/[id]/route.ts` (remove the `type==='deep-dive'` branch)
- Modify: `components/VideoMenu.tsx` (remove deep-dive items + `onDeepDive` prop + version import)
- Modify: `app/page.tsx` (remove `DeepDiveStatusBar`, `deepDive` state, handlers, render)

**Interfaces:**
- Consumes: existing `Video` type (still has `deepDive*` fields at this point).
- Produces: no UI/API path to deep-dive. `VideoMenu` no longer has an `onDeepDive` prop. `/api/html/[id]` accepts only `type ∈ {summary, dig-deeper}`.

- [ ] **Step 1: Delete the API route, components, and their tests**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins
git rm -r "app/api/videos/[id]/deep-dive"
git rm components/DeepDiveOverlay.tsx components/DeepDiveStatusBar.tsx
git rm tests/api/deep-dive-post.test.ts tests/api/html-serve-deep-dive.test.ts
git rm tests/components/DeepDiveOverlay.test.tsx tests/components/DeepDiveStatusBar.test.tsx
```

- [ ] **Step 2: Remove the deep-dive branch from the HTML serve route**

Open `app/api/html/[id]/route.ts`. Delete the entire `type === 'deep-dive'` branch (the block that reads `video.deepDiveHtml` / `video.deepDiveMd` and calls `runDeepDiveHtml`). Tighten the type guard so only `'summary'` and `'dig-deeper'` are accepted (the existing guard that currently lists `'deep-dive'` — drop that literal so an unknown type still 400s).

- [ ] **Step 3: Remove deep-dive from VideoMenu**

Open `components/VideoMenu.tsx`. Remove: the `import { CURRENT_DEEP_DIVE_VERSION } from ...deep-dive/version`; the `onDeepDive` prop from the props type and the component signature; the `deepDiveFile` / `deepDiveHtmlHref` locals; the "Deep Dive doc" menu item block; the "Open Deep Dive in Obsidian" menu item block. Leave summary, corrections, archive, and Ask-AI items untouched.

- [ ] **Step 4: Remove deep-dive from the page**

Open `app/page.tsx`. Remove: the `DeepDiveStatusBar` import; the `deepDive` state declaration; the `handleDeepDive` function; the `handleDeepDiveClose` callback; the `onDeepDive={handleDeepDive}` prop passed to `VideoMenu`/`VideoRow`; the conditional `<DeepDiveStatusBar … />` render block. Leave summary/dig handlers and renders untouched.

- [ ] **Step 5: Find and fix any remaining references to the deleted symbols**

```bash
grep -rn "DeepDiveOverlay\|DeepDiveStatusBar\|onDeepDive\|handleDeepDive\|/deep-dive/route\|deep-dive'" app components --include='*.ts' --include='*.tsx' | grep -v node_modules
```
Expected: no matches. Fix any stragglers (e.g. `VideoRow.tsx` may forward `onDeepDive` — remove it there too).

- [ ] **Step 6: Typecheck + full suite**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -12
```
Expected: tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
refactor(deep-dive): remove UI + API entry points

Deletes the deep-dive API route, the DeepDiveOverlay/StatusBar components,
the type=deep-dive branch of the HTML serve route, and the deep-dive menu
items + page handlers. Deep-dive is now unreachable from the app; the lib
code and schema fields are removed in later commits.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
EOF
```

---

### Task 3: Delete dedicated lib/gemini/render code + fix importers

**Files:**
- Delete: `lib/deep-dive/` (entire dir: `ensure.ts`, `version.ts`, `write-doc.ts`), `tests/lib/deep-dive/` (entire dir: 4 files)
- Delete: `lib/html-doc/generate-deep-dive.ts`, `lib/html-doc/render-deep-dive.ts`, `tests/lib/html-doc/generate-deep-dive.test.ts`, `tests/lib/html-doc/render-deep-dive.test.ts`, `tests/lib/html-doc/render-deep-dive-helpers.test.ts`
- Delete: `tests/api/deep-dive-html-pipeline.test.ts`, `tests/lib/gemini-deepdive-timestamps.test.ts`, `tests/lib/gemini-deepdive-prompt.test.ts`, `tests/lib/gemini-deepdive-combined.test.ts` (confirm exact names via grep — see Step 1)
- Modify: `lib/gemini.ts` (delete `generateDeepDive`, `generateDeepDiveFromTranscript`, `generateDeepDiveCombined` + any helpers/prompt constants used ONLY by them)
- Modify: `lib/timestamp-repair.ts` (remove `ensureDeepDiveHtml` import + its repair path)
- Modify: `lib/timestamp-audit.ts` (remove `CURRENT_DEEP_DIVE_VERSION` import + the `deepDives` audit branch)

**Interfaces:**
- Consumes: nothing new.
- Produces: `lib/gemini.ts` no longer exports the three `generateDeepDive*` functions. `timestamp-audit`/`timestamp-repair` operate on summary only. `nav.ts` `wireDigLinks`/`digControl('summary',…)` become dead (removed in Task 4).

- [ ] **Step 1: Enumerate the exact dedicated test filenames + every importer**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins
ls tests/lib/gemini-deepdive-* tests/lib/deep-dive/ 2>/dev/null
grep -rln "lib/deep-dive\|generate-deep-dive\|render-deep-dive\|generateDeepDive\|ensureDeepDiveHtml\|runDeepDiveHtml\|reRenderDeepDiveHtml\|CURRENT_DEEP_DIVE_VERSION" lib app --include='*.ts' --include='*.tsx' | grep -v node_modules
```
The second command lists every production importer to fix in this task. Expected importers: `lib/timestamp-repair.ts`, `lib/timestamp-audit.ts` (route + components already handled in Task 2).

- [ ] **Step 2: Delete the dedicated lib + render + their tests**

```bash
git rm -r lib/deep-dive tests/lib/deep-dive
git rm lib/html-doc/generate-deep-dive.ts lib/html-doc/render-deep-dive.ts
git rm tests/lib/html-doc/generate-deep-dive.test.ts tests/lib/html-doc/render-deep-dive.test.ts tests/lib/html-doc/render-deep-dive-helpers.test.ts
git rm tests/api/deep-dive-html-pipeline.test.ts
git rm tests/lib/gemini-deepdive-timestamps.test.ts tests/lib/gemini-deepdive-prompt.test.ts tests/lib/gemini-deepdive-combined.test.ts
```

- [ ] **Step 3: Remove the deep-dive functions from `lib/gemini.ts`**

Delete the three exported functions `generateDeepDive`, `generateDeepDiveFromTranscript`, `generateDeepDiveCombined` and any prompt-builder constants/helpers used ONLY by them. After editing, confirm nothing else in `gemini.ts` references the deleted helpers:
```bash
grep -n "DeepDive\|deepDive\|deep-dive" lib/gemini.ts
```
Expected: no matches.

- [ ] **Step 4: Fix `lib/timestamp-repair.ts`**

Remove the `ensureDeepDiveHtml` (or `runDeepDiveHtml`/`reRenderDeepDiveHtml`) import and the branch that repairs deep-dive docs. Keep the summary repair path intact. If the repair tool iterated `[summary, deepDive]`, reduce it to summary only.

- [ ] **Step 5: Fix `lib/timestamp-audit.ts`**

Remove the `CURRENT_DEEP_DIVE_VERSION` import, the `deepDives` field from the report type, and the loop branch that classifies deep-dive docs. Keep summary auditing.

- [ ] **Step 6: Verify no remaining production references; typecheck + suite**

```bash
grep -rn "lib/deep-dive\|generate-deep-dive\|render-deep-dive\|generateDeepDive\|ensureDeepDiveHtml\|runDeepDiveHtml\|CURRENT_DEEP_DIVE_VERSION" lib app components --include='*.ts' --include='*.tsx' | grep -v node_modules || echo "NONE"
npx tsc --noEmit && npm test 2>&1 | tail -12
```
Expected: NONE; tsc clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
refactor(deep-dive): delete lib/deep-dive, gemini generators, and renderers

Removes lib/deep-dive/*, lib/html-doc/{generate,render}-deep-dive.ts, the
three generateDeepDive* functions in lib/gemini.ts, and their tests; trims
timestamp-audit/timestamp-repair to summary-only.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
EOF
```

---

### Task 4: Trim deep-dive cross-doc nav from `nav.ts` (HIGH RISK)

After Task 3, `render-deep-dive.ts` (the only caller of `wireDigLinks` and `digControl('summary',…)`) is gone, so these are dead. Remove them and the matching block in the inline `NAV_SCRIPT`.

**Files:**
- Modify: `lib/html-doc/nav.ts`
- Test: existing nav coverage in `tests/lib/html-doc/nav*.test.ts` (if present) + Playwright nav specs

**Interfaces:**
- Consumes: nothing.
- Produces: `nav.ts` exports only the summary/dig-shared API (`digControl(startSec: number)`, `scrollToHashSection`, `NAV_SCRIPT`, `NAV_CSS`, `initDigControls`). No `wireDigLinks`, no `digControl('summary',…)` overload, no `data-type="summary"` handling.

- [ ] **Step 1: Confirm the deep-dive nav symbols are now dead**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins
grep -rn "wireDigLinks\|data-type=.summary\|digControl(.summary" lib app components --include='*.ts' --include='*.tsx' | grep -v node_modules
```
Expected: matches ONLY inside `lib/html-doc/nav.ts` itself (no external callers).

- [ ] **Step 2: Remove the TS helpers**

In `nav.ts`: delete `wireDigLinks()` and the `digControl(targetType: 'summary', startSec)` overload + its implementation branch, collapsing `digControl` to the single summary-side signature `digControl(startSec: number)`. Leave `initDigControls`, `scrollToHashSection`, and the dig-state TS helpers intact.

- [ ] **Step 3: Remove the cross-doc block from the inline NAV_SCRIPT**

In the `NAV_SCRIPT` template string, delete ONLY the deep-dive cross-doc navigation block (the section that rewrites `data-type="summary"` links / wires the "↑ summary" back-link). Keep: the `#t=` hash-scroll block, the dig-state machine, and the summary-side dig-control wiring. The inline JS mirrors the TS helpers (DRIFT WARNING) — keep them consistent.

- [ ] **Step 4: Verify no stray references and the script is well-formed**

```bash
grep -rn "wireDigLinks\|data-type=.summary\|↑ summary\|targetType" lib --include='*.ts' | grep -v node_modules || echo "NONE"
npx tsc --noEmit && echo TSC_OK
```
Expected: NONE; TSC_OK.

- [ ] **Step 5: Nav regression — unit + E2E**

```bash
npx jest nav 2>&1 | tail -6
npx playwright test --grep "dig|nav|summary" 2>&1 | tail -12
```
Expected: green. If Playwright isn't runnable in this environment, run the full jest suite and do the manual boot check in Verification instead, and note it.

- [ ] **Step 6: Full suite + commit**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -8
git add -A
git commit -F - <<'EOF'
refactor(deep-dive): trim cross-doc nav from nav.ts

Removes wireDigLinks, the digControl('summary',…) overload, and the
deep-dive cross-doc block in the inline NAV_SCRIPT. Summary "dig deeper ▶"
controls, the dig-state machine, and #t= hash scrolling are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
EOF
```

---

### Task 5: Remove `deepDiveMd` / `deepDiveHtml` / `deepDiveVersion` schema fields (atomic)

**Files:**
- Modify: `types/index.ts` (remove the three fields; KEEP `docVersion`, `DocVersion`, `DocVersionSchema`)
- Modify: `lib/archive.ts` (drop `video.deepDiveMd` from the move + cached-HTML loops)
- Modify: all remaining test files that set `deepDiveMd`/`deepDiveHtml` in fixtures (tsc surfaces the list)

**Interfaces:**
- Consumes: nothing.
- Produces: `Video` type has no `deepDive*` fields. `archive.ts` moves/deletes summary files only.

> **Why atomic:** the fields are `.nullable()` (required); `Video`-typed fixtures won't compile without them, so the type edit + every fixture edit land in one commit.

- [ ] **Step 1: Remove the fields from the schema**

In `types/index.ts` delete:
```ts
  deepDiveMd: z.string().nullable(),
  deepDiveHtml: z.string().nullable().optional(),
  deepDiveVersion: DocVersionSchema.optional(),
```
Keep `summaryMd`, `docVersion`, `DocVersion`, `DocVersionSchema`, and the dig fields.

- [ ] **Step 2: Fix `lib/archive.ts`**

Change the two loops that include `video.deepDiveMd` to summary-only:
```ts
for (const relPath of [video.summaryMd]) {
```
and the cached-HTML loop similarly (drop the deep-dive md entry). If the summary is the only remaining entry, simplify accordingly.

- [ ] **Step 3: Let tsc enumerate every remaining fixture, then strip the keys**

```bash
npx tsc --noEmit 2>&1 | head -60
```
For each reported file, delete the `deepDiveMd: …,` and `deepDiveHtml: …,` keys (keep `summaryMd`, `digDeeperMd`, etc.). Repeat tsc until clean. Watch for fixtures that set a non-null `deepDiveMd` used in an assertion — remove those assertions (there should be none after Tasks 2–4, but verify).

- [ ] **Step 4: Verify zero references; typecheck + full suite**

```bash
grep -rn "deepDiveMd\|deepDiveHtml\|deepDiveVersion" . --include='*.ts' --include='*.tsx' | grep -v node_modules || echo "NONE"
npx tsc --noEmit && npm test 2>&1 | tail -12
```
Expected: NONE; tsc clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
refactor(deep-dive): remove deepDiveMd/deepDiveHtml/deepDiveVersion fields

Drops the deep-dive schema fields from VideoSchema and archive.ts, and
clears them from all test fixtures. Keeps docVersion/DocVersion (summary).
Zod non-strict → stale keys drop from existing index.json on next write.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01AALGnVtj4uLCXBKEeNSbYf
EOF
```

---

## Self-Review

- **Spec coverage:** §1 on-disk → Task 1; §2 dedicated code → Tasks 2 (UI/API) + 3 (lib/gemini/render); §3 surgical edits → nav (Task 4), serve route + menu + page (Task 2), archive + audit + repair (Tasks 3, 5), schema (Task 5); §4 preserved → enforced by grep guards; §5 no migration → noted. All covered.
- **Placeholder scan:** none — every step has concrete commands/edits.
- **Type consistency:** `digControl(startSec: number)` is the single surviving signature (Task 4); `docVersion`/`DocVersion` consistently preserved; `deepDive*` consistently removed in Task 5.

## Final Verification (after Task 5)

- [ ] `npx tsc --noEmit` clean
- [ ] `npm test` full serial suite green
- [ ] `grep -rn "deepDive\|DeepDive\|deep-dive\|render-deep-dive" lib app components types --include='*.ts*' | grep -v node_modules` → only incidental comments, no live code
- [ ] `*-dig-deeper.*` files on disk UNCHANGED; `*-deep-dive.*` = 0
- [ ] App boots (`npm run dev`): video menu shows no deep-dive items; a summary doc's "dig deeper ▶" still navigates to dig; a dig doc still loads with no console errors
- [ ] README / docs: scan for deep-dive mentions; update user-facing ones (defer design-spec.md historical rewrite unless trivial)
