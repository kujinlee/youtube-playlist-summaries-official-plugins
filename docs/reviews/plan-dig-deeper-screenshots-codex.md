# Adversarial Review — Implementation Plan: Dig-Deeper with Slide Screenshots

**Date:** 2026-06-24
**Reviewer:** Claude (opus) adversarial review — **Codex fallback** (Codex at usage limit until 2026-07-18 per `docs/plugins.md`). **Re-attempt the Codex pass before merge** if access returns.
**Plan reviewed:** `docs/superpowers/plans/2026-06-24-section-dig-deeper-screenshots.md`

## Verdict (reviewer)
**Not ready to execute as written** — four BLOCKING issues each defeat a fresh subagent. Lib-layer design (Tasks 2–7) otherwise sound; spec coverage honest.

## Findings

### BLOCKING
- **B-1 — Task 1 line refs/assertion off.** `resolveTranscriptTokens` is 3-arg; duration computed at `transcript-timestamps.ts:85` (not :84-85) and reused at `:97`/`:119`. Test must assert the tail token's **end** uses the passed duration, not just `data-t`. **Confirmed.**
- **B-2 — Tests written where jest can't find them.** `jest.config.ts` `testMatch` = `tests/lib/**`, `tests/api/**`, `tests/components/**`. Plan puts tests beside source (`lib/dig/*.test.ts`, `app/api/.../route.test.ts`) → 0 tests found → every RED step false-green. **Confirmed.** Relocate ALL tests under `tests/`; import via `@/` alias (`jest.config.ts:9` moduleNameMapper).
- **B-3 — `Video` is a Zod schema, not a TS interface.** It's `z.infer<typeof VideoSchema>` in `types/index.ts:46-78` (`deepDiveHtml: z.string().nullable().optional()` at :60). Task 8 must add to `VideoSchema`. Its RED test ("field stripped") is a false-RED — `readIndex` doesn't Zod-parse, so unknown fields already survive. **Confirmed.**
- **B-4 — Spec D1 (replace deep-dive + repoint control) has NO task.** `render.ts:83`: `const dig = (hasDeepDive && startSec != null) ? digControl('deep-dive', startSec) : '';` — control only renders when `deepDiveMd` set, and links to the legacy `type=deep-dive` doc. Tasks 9–12 build a parallel flow nothing invokes. **Confirmed.** Need a task to (a) emit the new control for ALL timestamped sections regardless of `deepDiveMd`, (b) repoint `digControl`/`wireDigLinks` to the POST→SSE flow.

### HIGH
- **H-1 — Task 12 understates the nav rewrite.** `NAV_SCRIPT` (`nav.ts:42-58`) is a ~12-line IIFE with no fetch/EventSource/state machine. The 4-state control, dig-state fetch, POST-then-stream, `force=1` are all net-new inline browser JS. Split into 2–3 tasks with own behaviors (initial-fetch failure, EventSource vs job-error, double-click, exact `view detail` href).
- **H-2 — POST transport inconsistent.** Mirrored `deep-dive/route.ts:17-18` reads `outputFolder` from the **JSON body**, not query. Plan/spec show `?outputFolder=`. Pick one; make Task 9 server + Task 12 client agree (incl. `force`). **Confirmed body-based.**
- **H-3 — Lock-key assertion.** Task 9 keys `${outputFolder}::${videoId}::${sectionId}` via `getActiveJob` (valid; `job-registry.ts:77`). Behavior test must assert the **key string** includes sectionId, not just "returns existing jobId".
- **H-4 — `VIDEO_ID_RE` not exported** (`index-store.ts:8` private). Use `assertVideoId` (exported, :33) in `slides.ts`, not a regex import. **Confirmed.**
- **H-5 — Route tests should copy an existing harness.** `tests/api/deep-dive-post.test.ts` shows the `Request`-building + `params: Promise` + job-registry mock pattern. Tasks 9/10/11 must model on it, not invent.

### MEDIUM
- **M-1 — `.cache/` not gitignored** (no entry; no task). Fold a `.gitignore` append into Task 4.
- **M-2 — exec path only ever mocked.** No `child_process` use exists in `lib/` today; E2E mocks at route level, so `slides.ts` exec + "binary missing→text-only" (L4) is only unit-mocked. Note the coverage gap; optional binary-gated smoke test.
- **M-3 — Task 6 frontmatter underspecified.** No YAML block helper exists (`parse.ts:4` `frontmatterField` is single-field regex, unexported; no `gray-matter`). Task 6 must specify the exact `sections:` YAML serialization, not "minimal YAML".
- **M-4 — Task 5 retry untested.** Behavior 4 requires one retry; tests only assert non-200 throws. Add: 503-then-200 resolves; two failures throw.
- **M-5 — Task 7 base64/missing-asset ambiguous.** Decide drop-`<img>` vs alt-only; assert `not.toMatch(/src="assets\//)`. Prefer a markdown-it `image` renderer-rule override over post-hoc HTML regex.

### LOW
- **L-1 — `SectionTimeRange` has required `label`/`url`** (`types.ts:4-9`); Task 2 fixtures omit them → need `as ParsedSection`.
- **L-2 — File Structure row institutionalizes the B-2 wrong location.** Fix the table.
- **L-3 — Env var:** plan uses `GEMINI_DEEPDIVE_MODEL` (matches `gemini.ts:12` ✅); spec §3b says `DEEPDIVE_MODEL` (the internal const). Plan is correct; no change needed.
- **L-4 — `[sectionId]` route param is a string.** Task 9 must `Number(sectionId)` + validate non-negative integer.

## Disposition (author)
All BLOCKING + HIGH + Medium addressed in plan rev 2 (commit following this review): tests relocated under `tests/` with `@/` imports (B-2/L-2); Task 1 line ref + tail-end assertion (B-1); Task 8 rewritten against `VideoSchema` with a real RED (B-3); new **Task 12 (repoint summary dig control)** added for D1 (B-4); nav task expanded with full state-machine behaviors (H-1); POST body transport (H-2); lock-key assertion (H-3); `assertVideoId` not regex (H-4); route tests model on `tests/api/deep-dive-post.test.ts` (H-5); `.cache/` gitignore in Task 4 (M-1); explicit YAML format Task 6 (M-3); retry test Task 5 (M-4); missing-asset decision + renderer rule Task 7 (M-5); `sectionId` coercion L-4; fixture `as ParsedSection` L-1. M-2 noted as accepted coverage gap.
