# Final Whole-Branch Review — Deep-Dive Transcript Fallback (`38b6f76..b2303cd`)

**Reviewer:** Claude (opus), whole-branch. **NOTE:** Both adversarial reviews (spec + plan) were Claude standing in for usage-limited Codex (until Jul 18 2026) per `docs/plugins.md`. Re-run Codex before merge if access returns — the Claude passes satisfy the gate.

## Verdict: READY TO MERGE

Correct, minimal, well-tested; scope decision coherent and documented. Full `npm test` 964 green; `npx tsc --noEmit` clean. Live verification: regenerated real gated doc `v4F1gFy-hqg`, ▶ went **0→5** via the combined path. No Critical/Important.

## Cross-cutting verification

1. **Integrated cascade** — gated path traced: `writeDeepDiveDoc` → `resolveTranscriptSegments` (captions throw/empty → `transcribeViaGemini`) → `segments.length>0` → `generateDeepDiveCombined` → `[[TS:i]]` → ▶. A previously-captioned video behaves **identically** (resolver returns captions first; combined gets the same segments; `:73`/`:80` lock in "no transcribe call").
2. **Floor preserved** — resolver THROWS when both fail (`transcript-source.ts:26,30`) → `write-doc` catch → `segments=null` → video-only, no ▶. Floor test `:133` proves it.
3. **Cost** — captioned (≥1 seg) → zero transcribe calls (asserted `:80`); only new cost is one flash transcribe on gated videos; no double-call.
4. **Test integrity** — flipped tests fail on revert (genuine RED); `ensure-integration.test.ts` default stub correct + sufficient. **Full-repo grep clean:** every suite running the real resolver/write-doc with `lib/gemini` mocked (`transcript-source.test.ts`, `write-doc.test.ts`, `ensure-integration.test.ts`) stubs `transcribeViaGemini`; `ensure.test.ts` mocks write-doc; `deep-dive-post.test.ts` mocks ensure; E2E mocks at the route. No `undefined.length` risk anywhere.
4b. **Import hygiene** — `fetchTranscriptSegments` cleanly removed from `write-doc.ts` (now last caller eliminated); `resolveTranscriptSegments` added; no stale/unused imports.
5. **Scope honesty** — no version bump / no mass regen is sound and documented; visible doc repaired in verification; corpus-wide repair surfaced as a tracked user decision.
6. **Orchestrator** — `ensureDeepDiveHtml` linear if/else; one `writeDeepDiveDoc` per invocation; version stamp prevents repeat; no loop/double-write.

## Minor (non-blocking)
- Codex-fallback note (above).
- Empty-`[]` captions now incur a flash transcribe (previously straight to video-only) — explicitly owned in the spec cost table, cents-level.

## Recommendation
Ship it. Open PR; stop for user merge.
