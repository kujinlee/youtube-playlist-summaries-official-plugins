# Adversarial Spec Review — deep-dive-transcript-fallback

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: needs-rework → all Blocking/High/Medium applied; now sound-to-plan.

## Blocking
- **B1** Test plan self-contradicted (mock `resolveTranscriptSegments` vs "real cascade") and chose the wrong boundary. → §Testing rewritten: mock `lib/youtube` + `lib/gemini` (incl. a `transcribeViaGemini` handle), run the REAL resolver — matching `pipeline.test.ts` and the dev-process Mocking-Boundaries table. Mocking the resolver would leave the cascade (the whole fix) untested.

## High
- **H1** Empty-captions floor silently changed: today `[]`→video-only; after the swap `[]` triggers `transcribeViaGemini`. → Cost table + Behavior now own this; "graceful floor" applies only when BOTH sources throw/empty.
- **H2** Double video upload dismissed without analysis. → Decided + justified: net-new cost is only the flash transcribe (the pro **video** upload already happened on the gated video-only path); combined preserves the visual grounding that is the deep-dive's value. `generateDeepDiveFromTranscript` (no video upload, also resolves ▶) noted as a future optimization.
- **H3** Test breakage understated (said 2, actually 4). → Enumerated all four (`:103`, `:116`, `:168`, `:180`) in a table with before/after, plus a new explicit floor test; `:70` combined assertion handled.

## Medium / Low (applied)
- **M1** Cost-table row 1 → "captions return ≥1 segment" (empty `[]` does trigger Gemini).
- **M2** "unchanged tiering tests" reason corrected — they pass because captions succeed in `beforeEach`, not because fetch-mocking is irrelevant.
- **M3** Existing broken docs not abandoned: verification regenerates the identified docs (`v4F1gFy-hqg`, `bC9BaY18b0o`) to repair the visible symptom; corpus-wide repair script surfaced as an explicit user decision (not built in-branch, not defaulted to "no").
- **M4** `durationSeconds===0` noted (coverage warning guarded by `>0`; no crash).
- **L1** grep-confirmed: `write-doc.ts` is the last direct `fetchTranscriptSegments` caller → fix closes the gap completely.
- **L2/L3** wording; no behavioral impact.

## Cross-cutting answer captured in spec
"Why tests missed it": `write-doc.test.ts:103`/`:116` assert "captions fail/empty → video-only → no ▶" — they codify the design gap as correct; mocks hide real caption gating. A spec/scope gap, not a logic defect.
