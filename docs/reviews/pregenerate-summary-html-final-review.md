# Pre-generate summary HTML at ingestion — Final whole-branch review (opus)

**Scope:** branch `feat/pregen-summary-html`, merge-base `4998c8b`..`9bea8c8` (2 code commits + 3 doc commits). **Verdict: READY TO MERGE.** 0 Blocking/High/Medium. Full suite 1516/1516, tsc clean.

## Mandate areas — all CLEAN
1. **Best-effort integrity** — catch wraps only `runHtmlDoc`, inside the per-video `try`, before `'Saved'`. `upsertVideo` + `alreadyIndexed.add` run before the block → a pre-gen failure can't un-index or corrupt the `.md`. `runHtmlDoc` is internally atomic (temp→rename; unlinks HTML on index-update failure → at worst an orphaned model JSON; re-render gated on `summaryHtml` set only on full success). Failed pre-gen leaves `summaryHtml` unset → menu falls back to generate button. No corruption path.
2. **Loop semantics undisturbed** — `signal.aborted` (top), already-indexed `continue`, `nextSerial`, within-run dedup all precede the block; the outer per-video `catch` still only fires for genuine ingestion failures (inner catch absorbs pre-gen rejections → no spurious `{type:'error'}`).
3. **Progress/SSE correct** — no-op adapter swallows runHtmlDoc's native start/step1-3/done; single coarse `'Generating HTML doc…'` carries the neighbors' `{current,total}`; `'Saved'` terminal. Leak test triple-locks (call-count + distinct-callback + sentinel absence).
4. **Performance/cost acceptable** — one extra serial flash call per NEW video (already-indexed skip); no unbounded loop/memory; `PREGEN_SUMMARY_HTML=off` covers bulk re-ingest.
5. **Test quality strong** — all 5 tests falsifiable, no false-green (the original isolation false-green was fixed pre-impl in `3e52244`). Artifact production (#2) soundly delegated to `generate.test.ts`; #8/#10 covered by existing guards. All 10 enumerated behaviors map to coverage.
6. **Spec/plan fidelity exact** — `runHtmlDoc` not `ensureHtmlDoc` (circular-import avoidance verified); no version bump; no scope creep; insertion point as specified.
7. **Other clean** — comment accurate; `'off'` idiom matches `DIG_CROP`; step strings consistent with `'Generating summary…'` (U+2026 byte-verified).

## Findings
- **L1 (FIXED post-review, commit pending):** bare `catch {}` discarded the error with no videoId-correlated diagnostic. Applied the reviewer's one-line fix — `catch (err) { console.warn('[pregen-html] deferred for ${videoId}: …'); … }` — so the deferred SSE step is correlatable to a cause. Re-verified: tsc clean, 5/5 pre-gen tests still pass (warn emits no SSE event, so the best-effort no-error-event assertion holds). Aligns with the project's dev-logger observability culture.
- **L2 (accept as-is):** the leak-test sentinel uses `total:3` cosmetically to mimic runHtmlDoc's shape; the test only checks step-string non-leak. Fine.

## Process trail
- Codex (gpt-5.5) **plan** review pre-impl: found a false-green isolation test (H) + artifact-scope note (M), both fixed in `3e52244` before any code.
- Per-task reviews (sonnet): Task 1 SPEC ✅/QUALITY approved (mis-nested describe Minor → fixed in Task 2); Task 2 SPEC PASS/QUALITY approved.
- This final whole-branch adversarial review (opus) serves the code-level gate. The code commits were not independently re-run through Codex, but are mechanically faithful to the Codex-cleared plan.
