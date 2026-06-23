# Adversarial Spec Review — timestamp-guard-audit-repair

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback. Re-attempt the Codex-specific pass before merge if access returns.**

Verdict: **needs-rework** → all Blocking/High applied; Medium/Low folded in; now sound-to-plan.

## Blocking (applied)

- **B1 — `.mjs` cannot import the TS lib in this repo.** No `tsc` emit step exists (it's a Next app), and every script that touches the lib runs `.ts` via `ts-node` (`scripts/rerender-html.ts`, invoked `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' ts-node …`). `node scripts/*.mjs` literally cannot resolve `../lib/*.ts`. → Both scripts are now `scripts/audit-timestamps.ts` / `scripts/repair-timestamps.ts`, run via ts-node with new `npm run audit-timestamps` / `repair-timestamps` entries mirroring `rerender-html`. All `node …mjs` invocations in the spec rewritten to the `ts-node`/`npm run` form.

- **B2 — `tests/scripts/**` is outside jest's `testMatch`** (`tests/lib|api|components` + `tests/smoke` only) → those tests would silently never run. → Adopted the reviewer's cleaner option (b): testable logic extracted into `lib/timestamp-audit.ts` (`auditTimestamps`) and `lib/timestamp-repair.ts` (`repairTimestamps`), tested under `tests/lib/`. The `scripts/*.ts` are thin arg-parse + console wrappers (the `rerender-html.ts` → `reRenderAll` pattern). No new jest glob needed.

- **B3 — repair's "forced-regen flag" did not exist and `ensure*` cannot fix a stuck doc.** `needsResummarize = stored.major < current.major`; a stuck doc has `stored.major == current.major`, so the only reachable branches are HTML-only rebuild (no re-summarize → no new ▶) or cheap re-render from the ▶-less `.md` (→ still 0 ▶). → Added a real `force?: boolean` param to `ensureHtmlDoc` and `ensureDeepDiveHtml` as an explicit, tested change: `if (force || needsResummarize(...))` / `if (force || !deepDiveMd || needsRegenerate(...))` takes the re-gen branch regardless of version and stamps the **true** current version (never an inflated major). `repairTimestamps` calls `ensure*(…, { force: true })`, reusing their tested render-then-stamp sequence (incl. deep-dive's single post-render `updateVideoFields` and `deepDiveMd` pass-through) — no duplicated stamp logic. The dead "reuse `ensure*` where practical" parenthetical is gone.

## High (applied)

- **H1 — deep-dive guard must not retry the expensive pro+video call.** `generateDeepDiveCombined` (`gemini.ts:374`) uploads the full video to `gemini-2.5-pro` — the costliest call; ▶-miss was only demonstrated on the flash-summary path, and write-doc's combined→transcript→video cascade already absorbs a tokenless string without throwing. → Guard scope narrowed: **retry** only `generateSummary` (flash) and `generateDeepDiveFromTranscript` (`:322`, pro but **no video upload**). `generateDeepDiveCombined` gets **warn-only** (logs `[timestamp-miss]` for observability, no retry — no doubled video upload). Cost rationale stated in the spec.

- **H2 — absent `docVersion`/`deepDiveVersion` is optional** (`types/index.ts`); a naive `.major` read throws, and absent+no-▶ is "would-regen" (major 1 < current), not stuck. → Audit defaults both to `{major:1,minor:0}` (mirrors `ensure.ts` `PRE_FEATURE`); a fixture for the absent-version case is required.

- **H3 — `generateSummary` retry wrapping pinned.** The retry must re-call `generateJson` (tokens come from `parsed.summary`; re-resolving the same parse is pointless), so the **whole** `generateJson → resolveTranscriptTokens → build-return` block (incl. `trimToWords`) sits inside the ≤2-attempt loop and the returned object is internally consistent. `summary.includes('▶')` is the correct all-or-nothing proxy (marker is literally `'▶'` U+25B6; `resolveTranscriptTokens` degrades all-or-nothing) — stated so a reviewer doesn't "fix" it into a count check.

## Medium (applied)

- **M1 — deterministic-miss class acknowledged.** Zero ▶ with segments is not always stochastic (non-monotonic/out-of-range indices degrade deterministically). 1-retry cap kept; warn message is neutral (`<N> segments but 0 timestamps after <k> attempt(s)`), no "transient" claim.
- **M2 — `resolveTranscriptTokens` never throws.** Guard semantics: `generateJson` throw → propagate (no ▶-retry, preserves error handling); success + 0 ▶ with segments>0 → one ▶-retry. Stated explicitly.
- **M3 — audit ▶ detection and file set.** Detect **line-leading** `▶` (`/^▶/m`), not bare `includes('▶')` (avoids fenced-prose false positives, matches the renderer). Split summaries (`summaryMd`) vs deep-dives (`deepDiveMd`) via the index, not the `-deep-dive.md` suffix scan. Version/stuck classification from the index entry; ▶-presence from the `.md` on disk; a `summaryMd`/`deepDiveMd` set but missing-on-disk → distinct `md-missing` category (not counted "has ▶").
- **M4 — captionless deep-dives.** A genuinely transcript-less deep-dive legitimately has 0 ▶ and cannot be distinguished from a bug-stuck one by ▶-count alone. Stated as a known audit limitation. Repair does NOT loop (each doc is regenerated once); a captionless doc logs `0 → 0` and the batch continues.

## Low (applied)

- **L1 — exit code.** Counts always printed. Default non-zero exit gated on **summary** stuck>0 only (summaries always get a transcript via the PR-#15 cascade); deep-dive stuck is informational (per M4, can't be cleanly gated). Avoids permanent CI failure on captionless docs.
- **L2 — empty `OUTPUT_FOLDER`.** Scripts error clearly if neither `--folder` nor a non-empty `OUTPUT_FOLDER` is set (guard before `assertOutputFolder`).
- **L3 — line drift fixed.** `generateDeepDiveCombined` is `gemini.ts:374` (was `:330`); `generateDeepDiveFromTranscript` `:322`; `generateSummary` `:147` (block `183-190`).
- **L4 — serialization source.** Corrected: the sequential `for` loop in `repairTimestamps` serializes, not the lib. Note added: do not run repair while the dev server processes the same folder (both read-modify-write `playlist-index.json`).

## Verified-correct (reviewer)
`▶` marker is literally U+25B6 (`transcript-timestamps.ts:31`); `resolveTranscriptTokens` degrades all-or-nothing and never throws; `ensure.ts:63` unconditional stamp is the real freeze mechanism; `needsResummarize`/`needsRegenerate` are major-only; the guard's re-roll premise (intermittent ▶-miss on flash) is sound. Out-of-scope `generateDeepDive` (video-only, no segments) correctly excluded.
