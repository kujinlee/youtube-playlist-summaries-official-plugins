# Plan adversarial review — pre-generate summary HTML at ingestion (Codex)

**Model:** gpt-5.5 (Codex online, no fallback). **Target:** `docs/superpowers/plans/2026-06-29-pregenerate-summary-html.md` + spec + `lib/pipeline.ts` + `lib/html-doc/{generate,ensure}.ts` + `tests/lib/pipeline.test.ts`.

**Verdict: 0 Blocking, 1 High, 1 Medium — both addressed. Cleared to implement.**

## Findings

### HIGH — progress-isolation test could false-green — FIXED
The Q4 progress-isolation test (Task 1 Step 2, third test) asserted only the *absence* of a
`{type:'start',total:3}` sentinel, so it would pass even if `runHtmlDoc` were never called.
**Fix applied:** rewrote the test to (1) `expect(mockRunHtmlDoc).toHaveBeenCalledTimes(1)`,
(2) capture the `onProgress` the pipeline passed and assert `received !== outer` (proves a distinct
no-op callback, not the ingest stream's callback), (3) assert a `'__SENTINEL__'` step never leaks.
Triple-locked; no false green.

### MEDIUM — artifact-production coverage (spec behavior #2) left implicit — FIXED
The plan mocks `runHtmlDoc`, so it never re-asserts `models/<base>.json` / `htmls/<base>.html` are
written. **Fix applied:** added an explicit "Artifact-production scope" note to the plan stating that
behavior #2 is intentionally covered by the existing `tests/lib/html-doc/generate.test.ts` suite
(verified: `generate.test.ts:76` — "transforms, writes htmls/<base>.html, and records summaryHtml";
`:91` asserts the index `summaryHtml` field), not by a new pipeline test against the mock boundary.

## Verified CLEAN by Codex (independently)
- **Q1 no circular import** — `generate.ts` imports `fs/path/crypto/index-store/gemini/parse/render/model-store/types` only; the sole `../pipeline` import under `lib/html-doc/` is `ensure.ts`. `pipeline → generate` does not transitively reach `pipeline`. (Matches my own dep-chain scan.)
- **Q2 runHtmlDoc preconditions** — `upsertVideo` runs before the insertion point; `runHtmlDoc` needs only fields present on the freshly-built `Video` (`language`, `summaryMd`, `deepDiveMd`).
- **Q3 best-effort atomicity** — `generate.ts` writes the model first, atomically renames the HTML, then `updateVideoFields`; on index-update failure it removes the HTML, leaving only a harmless orphaned model. No index corruption / no half-written artifact that breaks later on-demand gen.
- **Q5 test-harness fit** — `pipeline.test.ts` already mocks `gemini` + `index-store`; adding `jest.mock('../../lib/html-doc/generate')` is consistent; `mockResolvedValue(undefined)` default correct; `delete process.env.PREGEN_SUMMARY_HTML` in `afterEach` prevents env leakage.
- **Q7 serial/dedup** — `alreadyIndexed` skip and `nextSerial` both precede the pre-gen block; serial assignment + within-run dedup unaffected.

## Cross-check with my own pre-review
My independent checks (no-cycle dep scan; progress-isolation false-green risk) agree with Codex. The High was the one I had pre-flagged in the dispatch prompt; now fixed in the plan.
