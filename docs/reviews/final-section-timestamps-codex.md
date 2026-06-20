# Codex Adversarial Review — Clickable Section Timestamps (final, code)

**Date:** 2026-06-18
**Tool:** `codex:rescue --fresh` (Codex available; the owed pass per `docs/plugins.md`).
**Range:** `f21af8f..HEAD` on `feat/section-timestamps`.
**Verdict (as received):** MUST FIX BEFORE MERGE — malformed Gemini tokens can leak into saved summaries as raw text, violating the all-or-nothing degradation contract.

---

## HIGH — malformed non-digit tokens leak raw (MUST FIX)
`lib/transcript-timestamps.ts` — `OWN_LINE_TOKEN = /^\s*\[\[TS:(\d+)\]\]\s*$/` and the final scrub
`ANY_TOKEN = /\[\[TS:\d+\]\]/g` both match **digits only**. A token like `[[TS:-1]]`, `[[TS:1.5]]`, or
`[[TS:abc]]` on its own line is therefore (a) not collected → does NOT trigger degradation (other
valid tokens still resolve), and (b) not scrubbed → remains raw in the saved `.md` and the rendered
HTML. Violates spec §8 ("no raw `[[TS:…]]` ever reaches the reader") and the all-or-nothing contract.
**Fix:** broaden both token regexes to match any `[[TS:<payload>]]`; let the existing integer
validation (`Number.isInteger(n) && 0 <= n < len`) reject the bad payload → degrade all; scrub any
remaining `[[TS:…]]` outside fences.

## MEDIUM — resolved-range monotonicity not enforced
`lib/transcript-timestamps.ts` — index monotonicity is validated, but resolved start/end seconds are
not. If transcript offsets were out of order (or two indices floor to the same second), a range could
be `end <= start`. Low real risk (youtube-transcript returns chronologically ordered segments) but the
resolver doesn't enforce the invariant it relies on.
**Fix:** also require resolved start/end to be finite and strictly increasing, else degrade.

## MEDIUM — transcript segment shape trusted at runtime
`lib/youtube.ts` — `fetchTranscriptSegments` maps `s.offset/1000`, `s.duration/1000` without checking
they are finite. A malformed library response feeds `NaN` into `buildIndexedTranscript`/`timestampLine`.
**Fix:** validate/repair each segment; keep only rows with finite numeric `offset`/`duration` and a
string `text`.

## LOW — malformed leading `▶` prose consumed
`lib/html-doc/parse.ts` — `extractTimeRange` consumes the first non-blank line if it starts with `▶`,
even when it isn't a valid timestamp line; a hand-authored section legitimately starting with `▶`
loses that prose. **This is the spec §8 documented behavior** ("malformed `▶` line → consume but
null"). Left as-is by decision.

## Handled correctly (Codex confirmed)
off-by-one end-time + `tokenK` advancement; single-token end=duration; fenced tokens incl. lang info
strings + unterminated fences (resolver↔parser consistent); blank lines before the `▶` line; magazine
model persistence + offline rerender repopulation; title drift guard; detectLanguage equivalence;
render escaping + `rel="noopener noreferrer"`; `fetchTranscriptSegments` error wrapping.

## Resolution
- HIGH + both MEDIUMs: fixed with TDD (commit `dd25d2b`).
- LOW: accepted (spec §8 behavior).

## Round 2 (Codex confirmation of `dd25d2b`)
Confirmed the round-1 fixes resolve the originals; surfaced two more edge cases — both fixed in
commit `cb781f9` with TDD:
- **MEDIUM — embedded-`]` token** (`[[TS:a]b]]`) evaded the `[^\]]*` char class → switched both
  recognizers to lazy `.*?` (still single-line; lazy stops at the first `]]`). The `/^\d+$/` guard
  still rejects the payload → degrade + scrub.
- **MEDIUM — unvalidated final segment**: `videoDuration` reads the last segment; added
  `Number.isFinite` checks on its `offset`/`duration` to the `valid` predicate.

Test count after both fix rounds: **802 passing**; `tsc --noEmit` clean (2 pre-existing only).

## Round 3 (Codex confirmation of `cb781f9`) — adjudicated, no further code change
Codex raised three more items. After review they are **rejected/accepted**, not fixed — escalating an
adversarial reviewer into ever-more-pathological territory is itself a failure mode, and one item
contradicts the spec and Codex's own round-1 approval:

- **"Blocking" — scrub `[[TS:…]]` inside fenced code blocks → REJECTED (design).** Fence-awareness is
  intentional and spec'd (§4.2: fenced tokens preserved verbatim) and was **explicitly approved by
  Codex in round 1**. A fenced `[[TS:…]]` is a legitimate code sample; scrubbing it would corrupt real
  content. Gemini is instructed to emit the token on its own line after a heading, never fenced. The
  "no raw token reaches the reader" contract is scoped to prose, not code blocks.
- **"Blocking" — videoDuration finite/positive → ACCEPTED (cosmetic).** Round 2 already prevents NaN
  (final segment must be finite). The residue: a zero-duration final segment yields a truthful
  `end == start` label on a still-working start-anchored link. The proposed fix (degrade the whole doc)
  is worse UX than a tight label. The "Infinity" sub-case needs a ~1e308-second video — not real.
- **"High" — floored equal labels → ACCEPTED (cosmetic).** Two section boundaries <1s apart floor to
  the same `m:ss`, rendering e.g. `10:00–10:00`. Truthful, link works, degrading over a 1-second
  cosmetic would be worse. Not a defect.

**Final stance:** all genuine contract violations (raw-token leak in prose, NaN labels, mis-resolved
numeric payloads, non-monotonic/non-finite offsets, bad segment shapes) are fixed and tested. Remaining
Codex items are a design disagreement (fences) and cosmetic degenerate labels on working links.
**Safe to merge.**
