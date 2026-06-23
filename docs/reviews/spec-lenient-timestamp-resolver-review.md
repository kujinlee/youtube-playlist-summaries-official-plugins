# Adversarial Spec Review — lenient-timestamp-resolver

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback. Re-attempt the Codex-specific pass before merge if access returns.**

Verdict: **needs-rework** → all Blocking/High applied; Medium/Low folded in; LIS algorithm verified correct/deterministic by the reviewer. Now sound-to-plan.

## Blocking (applied)

- **B1 — rebuild contract undefined (positional `tokenK` would desync after filtering).** The old Pass 2 carried one `tokenK` indexing the parallel `tokenLines`/`indices` arrays; with a *kept* subsequence that no longer maps. → Spec now mandates: Pass 1 records `{ lineIndex, parsedIndex }` per own-line non-fenced token; compute the resolvable candidates and the LIS-kept set, then build `keptMap: Map<lineIndex, {start,end}>` BEFORE Pass 2; Pass 2 is `tokenSet.has(i) ? (keptMap.has(i) ? timestampLine(start,end,videoId) : null) : stripInline(line)`. No positional counter through Pass 2.

## High (applied)

- **H1/H2 — warn-count order & branch exclusivity.** → §6 rewritten as a numbered sequence: (1) Pass 1 counts `N` (own-line non-fenced tokens) regardless of preconditions; (2) `N===0` → no-op, silent; (3) global precondition fails (no videoId / no segments / non-finite videoDuration) → `M=0`, drop all, warn "dropped all N"; (4) else per-token filter + LIS → `M`, warn partial (`0<M<N`) / silent (`M===N`). Branch ladder explicitly entered only when `N>0`.

- **H3 — incomplete test enumeration.** → Spec now lists every existing test that changes, by name + new expectation (5 flip degrade→one-▶: out-of-range `:115`, non-increasing-index `:122`, negative-index `:143`, non-monotonic-offset `:163`, embedded-`]` `:174`; 3 survive as no-▶: float-index `:150`, non-finite-last-segment `:186`, null-videoId/empty-segs `:129`; 6 unchanged happy/fence/inline).

- **H4 — all-decreasing single-survivor pinned.** → Spec pins the deterministic earliest-peak reconstruction: for fully-decreasing offsets the FIRST document token survives; added a test. (Any single survivor is arbitrary for reverse-ordered input; determinism is the requirement.)

## New correctness finding (surfaced while resolving H3/H4) — INVERTED RANGE

Tracing existing test `:163` (segments `[off 100, off 90]`, tokens `[[TS:0]],[[TS:1]]`) exposed a bug the original spec would have shipped: the single kept token's `end = videoDuration = floor(90+5) = 95`, but its `start = floor(100) = 100` → **`▶ [1:40–1:35]`**, an inverted/garbage range. → Spec adds a candidate pre-filter: a token is resolvable only if `floor(segments[index].offset) < videoDuration` (in addition to in-range index + finite offset). This guarantees every kept token (last included, whose end is `videoDuration`) has `start < end`; non-last kept tokens use the next-kept offset (`> start` by LIS strict-increase). Noted minor caveat: a sub-1-second FINAL segment could see its own token excluded (its `floor(offset) == videoDuration`); negligible for real transcripts.

## Medium / Low (applied)

- **M1** — `videoDuration` prose corrected: it is needed by the *last kept* token's end (not "the last token"); the global non-finite-last-segment gate is retained and now also justified by the inverted-range filter.
- **M2** — duplicate-offset survivor pinned: strict `<` drops the *later-in-document* duplicate (e.g. offsets `[1,2,2,3]` → keep doc-positions `[0,1,3]`); added a test. Index-decreasing-offset-increasing confirmed harmless (ranges use offsets only) + test added.
- **M3** — CRLF: spec states input is assumed LF (Gemini JSON); `\s` in the token/fence regexes already tolerates a trailing `\r`; full CRLF normalization out of scope.
- **L1** — guard-interaction wording softened: leniency reduces guard retries but the *all-invalid* case still yields 0 ▶ and still triggers one retry + `[timestamp-miss]`; leniency does not eliminate it.
- **L2 / security** — no injection risk (videoId is `[A-Za-z0-9_-]{11}` from the API; lenient path changes only the *quantity* of ▶ lines, not their construction). No action.

## Added test cases (beyond the original list)
NaN-offset at an in-range index (candidate-removed, still counted in `N`); a malformed token INSIDE a fence is not counted in `N`; a single kept token renders `start..videoDuration`; all-decreasing keeps exactly one (pinned survivor); duplicate-offset survivor pinned.

## Verified-correct (reviewer)
LIS (offset-only selection, smallest-predecessor tie-break, earliest-peak reconstruction) is correct and deterministic — traced on `[5,1,2,3,4]`, `[1,2,2,3]`, `[3,1,2]`, `[1,3,2,4]`, `[5,4,3,2,1]`, `[2,1,4,3,6,5]`; every reconstructed chain strictly increases. Offset-vs-index reasoning holds (no negative/duplicate range from index ordering). `parse.ts`/`render-deep-dive.ts` consume each rendered ▶ line independently → emitting more ▶ lines is compatible.
