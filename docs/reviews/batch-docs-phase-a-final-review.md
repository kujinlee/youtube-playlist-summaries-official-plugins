# Batch docs Phase A — Final whole-branch review (opus)

**Scope:** branch `feat/batch-html-doc`, merge-base `c3e1d94`..`67ab837` (4 doc + 6 code commits). **Verdict: READY TO MERGE.** 0 Blocking/High/Medium. Full jest 1546/1546, tsc clean; 5 E2E failures confirmed pre-existing (unmodified routes).

## High-risk cross-cutting paths — all CONFIRMED CORRECT
1. **Lock never stuck:** `runBatchDocs` emits exactly one terminal event on every path (`cancelled` at loop-top abort check, or `done` at loop end). Per-video failures always carry `videoId` → non-fatal, never close stream/lock. Synchronous throws (`assertOutputFolder`/`readIndex`) caught by `route.ts` `.catch` → fatal `error` (no videoId) → `onTerminal`; `finished` guard prevents double-release. No path holds `${folder}::batch-docs` lock.
2. **Cancellation end-to-end:** ✕ → fire-and-forget POST /cancel → `cancelJob` aborts the registry AbortController → loop's `signal?.aborted` → `cancelled` → stream closes → `releaseJobLock` + deferred `deleteJob`. Cancel-after-finish and cancel-during-last-item races both benign; lock released exactly once.
3. **Concurrency:** keys disjoint (batch `::batch-docs`, single `::videoId`, ingest raw folder). A batch + single-regen of the same video can co-run; `writeIndex` is atomic (temp+rename) so the index never tears; last-writer-wins converges to the same current version. Matches the codebase's pre-existing single-job posture; not a regression.
4. **Refresh storm bounded:** `handleBatchProgress` fetches per step/error; `fetchSeqRef` monotonic guard commits only the latest GET → no thrash/stale overwrite. Mirrors ingestion's incremental refresh.

## Spec fidelity — confirmed
- All Phase A spec rows: selection-ops table, async non-blocking + all 4 dismissal paths, URL contracts (POST/stream + the /cancel added per plan-review H1).
- No Phase-B leakage: no mode toggle/cost-confirm/dig; `mode:'summary-dig'` → 400. No ProgressEvent schema change, no version bump.
- a11y: all checkboxes labeled; bar ✕ has aria-label; disabled checkbox tooltip present.

## Low (cosmetic — deferred to Phase B, which touches BatchDocStatusBar)
- `start` event not handled by the bar → "step 0 of 0" for the sub-second gap before item 1 (seed `total` from `start`).
- Empty-batch "✓ 0 generated" flash only via became-current race (UI guards normally prevent it).
- `onSelectAllNeeding(needing)` vs plan's `(visible)` — identical result (page re-filters); cosmetic.
- `TextEncoder` per-event alloc in stream/route (hoist).
- `handleClose` reads `onClose` directly not `onCloseRef` — correct (recreated each render); asymmetry only.

## Process trail
Codex plan review (gpt-5.5) pre-impl: 3 High (cancel/incremental-refresh/active-busy) + 2 Medium, all fixed before code. Per-task reviews T1-T6 (sonnet): all SPEC-pass/QUALITY-approved. This final whole-branch (opus) serves the code-level gate. AFK: review substitutes for user approval.
