# Adversarial Review — Fix: drop dig inline citations + strip malformed echoes (v8)

**Reviewer:** Claude adversarial subagent (fresh, full file access, explicit break-it mandate)
**Date:** 2026-06-28
**Codex gap:** Codex CLI at usage limit; this Claude adversarial review satisfies the gate (per docs/plugins.md). Re-attempt before merge if access returns.

**Verdict: Mergeable.** No ReDoS (linear pattern), version bump correctly wired through `dig-merge.ts:104,154`, genuine wikilinks spared. One item fixed before merge (H1); M1/M2 documented as accepted.

## High
- **H1 — under-match: whitespace right after `[[` let the leak through.** `[[ 0 @ 1:09 ]]` (padded wrapper, a plausible LLM echo) was NOT stripped because the pattern required `\d` immediately after `[[`. This directly undermined the strip's purpose. → **FIXED:** regex widened to `/\[\[\s*\d+\s*@\s*[\d:]+\s*\]\]/g` (whitespace tolerated everywhere inside the wrapper; `\d+ … @ … clock` skeleton still required, so wikilinks remain untouched). New test: "strips a malformed citation token padded with whitespace inside the wrapper" (RED→GREEN).

## Medium (accepted — documented, not changed)
- **M1 — over-match on the shared summary path.** A literal `[[<digits> @<clock>]]` abutting prose (e.g. a transcript quote `"meet at [[3 @5:30]]"`) would be silently scrubbed from a summary. Probability is vanishingly low (requires double brackets + digits-then-`@` skeleton in genuine content; single-bracket display echoes `[3 @5:30]` are safe). Accepted: the strip is intentionally aggressive on the shared path; the shape it targets is itself a defect.
- **M2 — inline strip leaves a double space.** This is the *established* behavior of the sibling `ANY_TOKEN` strip (existing test at `transcript-timestamps.test.ts:97` codifies the same double space). Collapsing it only for `STRAY_CITATION` would make the two strips inconsistent. Markdown-it collapses it in render. Accepted for consistency.

## Low (no action)
- **L1 — own-line malformed token becomes a blank line, not a removed line.** Not an `OWN_LINE_TOKEN` (that regex is `[[TS:...]]`-specific), so it strips to `''`. In markdown this is a paragraph separator; harmless.
- **L2 — fenced malformed tokens left verbatim.** Consistent with existing `[[TS:…]]` fence handling; the new prompt tells Gemini not to transcribe code into fences, so odds are low. Defensible as-is.
- **L3 — existing leaked `.md` files self-heal only on re-dig.** Matches the documented version-gated refresh design (`↻ outdated`); dig-merge wiring verified correct. No batch backfill by design.

## Non-findings (verified clean)
ReDoS-safe; genuine wikilinks (`[[Some Note]]`, `[[2024 Roadmap]]`, `[[Note#^block]]`, `![[Note]]`) untouched; no dead code (the remaining `[[TS:` in dig is an explanatory comment; summary/deep-dive still legitimately use `[[TS:i]]`); version bump wired in both match passes; no vacuous tests.
