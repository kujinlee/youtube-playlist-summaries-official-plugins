# Batch docs Phase B (Summary + Dig-deeper) — Final whole-branch review (opus)

**Scope:** branch `feat/batch-docs-dig`, merge-base `c376c32`..`dc819df` (3 doc + 4 code commits). **Verdict: READY TO MERGE.** 0 Blocking/High/Medium. Full jest 1560/1560, tsc clean.

## Mandate areas — all CLEAN
1. **Dig failure chain provably leak-free:** `digSection` emits `{type:'error'}`+returns for 4 soft-failures (real exceptions reject). `runBatchDocs` dig branch captures into `digErr` + rethrows → `failed++` + non-fatal `{type:'error', videoId}`; the ONLY path to `succeeded++` is after `if (digErr) throw`. Route + stream classify error-with-videoId non-fatal → stream stays open → loop continues. A dig failure can never be (a) a false success, (b) close the stream, (c) abort the batch.
2. **Extraction/concurrency:** `upsertDugSection` serializes per-`digDeeperPath` (promise-chain mutex); batch digs are sequential anyway. digSection body byte-faithful to the deleted `runDigPipeline`; dig-route tests stay green (LB1, 381 dig tests).
3. **Pre-pass throw-safe:** `missingDigSections` wraps `parseSummaryMarkdown` (only real throw source) + both `fs.readFile`; `parseDugSections` is regex/state-machine with no throw path → malformed companion can't escape. LB7 codifies it.
4. **Mode-aware eligibility:** `videoNeedsBatchWork(summary-dig) = summaryNeedsWork || (summaryMd && !digDeeperMd)`. Known gap (dug-but-version-stale not client-flagged) is explicitly documented in spec (Eligibility "Coarse on dig" + Out-of-scope); reachable by manual checkbox; backend-authoritative skip keeps it consistent.
4b. **Count divergence bounded:** client coarse predicate can only OVER-select (never under-post a never-dug video); cost-confirm covers "button says 3, digs 40 sections."
5. **Cancellation next-section granularity:** yt-dlp/ffmpeg don't honor the signal; only digSection's pre-write guard checks abort. In-flight download finishes, then next-iter check emits `cancelled` (or pre-write abort → captured → failed, discarded not double-counted). Matches spec.
6. **Route mode validation:** both literals accepted, others 400, mode threaded through.
7. **Spec fidelity:** all Phase-B rows (LB1-5, CB1-3, cost-confirm, flat progress via accurate pre-pass total). Phase A summary mode fully preserved (VideoList/route default 'summary'). Phase-A-Low start-seed fixed. No schema/version/format change.

## Findings — 3 Low, none gating (deferred)
- **L1:** summary-current/never-dug video with no timestamped sections → posted, backend `total:0` → bar flashes `✓ 0 generated`. Cosmetic; consistent with backend-authoritative over-selection.
- **L2:** `assertVideoId` outside the try (batch.ts) — identical placement in merged Phase A (not a regression); only reachable for an index-resident id failing the regex (validated upstream).
- **L3:** mode `<fieldset>` uses `aria-label` not `<legend>` (a11y minor, carry from plan).

## Process trail
Codex plan review (gpt-5.5) pre-impl: 1 Blocking (digSection emit-not-throw → capture+rethrow) + 2 High (mode-aware client eligibility; parse-throw) + 2 Med + 1 Low — all fixed before code. Per-task reviews B1-B4 (sonnet) all spec-pass/quality-approved. This final whole-branch (opus) serves the code gate. AFK: review substitutes for user approval.
