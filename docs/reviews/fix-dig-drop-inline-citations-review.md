# Code Review — Fix: drop dig inline citations + strip malformed echoes (v8)

**Reviewer:** Claude code-review subagent (fresh, full file access)
**Date:** 2026-06-28
**Branch:** `fix/dig-drop-inline-citations`

**Verdict: The fix is sound. No Critical or Important findings.** Option B is the right call — the inline citations had no rendering path anyway (`resolveTranscriptTokens` only renders OWN-LINE `[[TS:i]]` and strips inline ones). The regex is narrow and well-targeted, the version bump is correctly wired, and the tests genuinely prove the behavior.

## Correctness — verified
- **Prompt** (`lib/dig/generate.ts`): `[[TS:i]]` citation bullet fully removed; only `[[SLIDE:...]]` remains. Docstring accurately explains why.
- **Strip** (`lib/transcript-timestamps.ts`): `STRAY_CITATION` applied in Pass 2 alongside `ANY_TOKEN`, only on non-fenced, non-own-line-token lines — matches existing strip semantics.
- **Version → stale**: `DIG_GENERATOR_VERSION = 8` flows to `dig-merge.ts:104,154` via `genVersion < DIG_GENERATOR_VERSION`. v7 docs correctly show `isStale → ↻ outdated`.

## Shared summary-path regression — none
Both summary (`gemini.ts:195,356,425`) and dig (`route.ts:131`) call the same resolver. The strip is strictly additive — removes only `[[<digits> @<clock>]]`, a shape genuine summary content never contains. The summary path *also* uses `buildIndexedTranscript` + `[[TS:i]]`, so it shares the same echo failure mode — the strip now hardens it too, at zero cost. Net positive.

## Regex safety — verified empirically
`/\[\[\d+\s*@\s*[\d:]+\]\]/g`:
- Matches: `[[0 @1:09]]`, `[[12 @1:09:23]]`, `[[3@5:30]]`, `[[3 @ 5:30]]`.
- Does NOT match: `[[Some Note]]`, `[[2024 Roadmap]]`, `[[2024]]`, `[[GPT-4 @scale]]`, `[[v2 @1:00]]`.
- The `\[\[\d+` anchor requires the wikilink to begin with digits; only theoretical false positive is a note titled literally `123 @45:67` — not realistic.

## Test quality — non-vacuous
- Inline strip test asserts both `not.toMatch(/\[\[/)` and exact surrounding text (double space where token was) — proves removal without collateral damage.
- Wikilink-preservation test guards the false-positive boundary.
- Own-line malformed test also asserts a valid `[[TS:0]]` still resolves to `▶ [0:00–10:30]`.

## Minor findings (none actionable)
1. `slides.ts` uses lazy `.*?`; `STRAY_CITATION` uses tighter `[\d:]+` — divergence is *correct* (citation interior is strictly digits/colons). No action.
2. An own-line malformed token strips to `''` (blank line kept, not removed) — cosmetically harmless (markdown collapses). Docstring "line removed" applies only to real `[[TS:i]]` tokens.
3. No test for a malformed token *inside* a fenced block (left verbatim, consistent with `[[TS:...]]` handling). Intended behavior; very low value to add.

**Ships as-is.**
