# Plan Adversarial Review — doc-timestamp-gold-url

**NOTE: Codex was unavailable (usage limit until Jul 18, 2026). This is a Claude adversarial review
in Codex's place, per the `docs/plugins.md` fallback policy. A Codex pass should be re-attempted
before merge if access is restored.**

Reviewed: plan `docs/superpowers/plans/2026-06-21-doc-timestamp-gold-url.md` against the spec and the
actual code in `lib/html-doc/{render,render-deep-dive,parse,theme}.ts`.

## Findings

### B-1 (Blocking) — No exhaustive LIGHT palette test after `meta` insertion
The existing deep-dive test pins the DARK palette's exact serialized key order (insertion-order
sensitive via `Object.entries`), but there is no equivalent LIGHT test. Adding `meta` to the LIGHT
palette in the wrong slot (or forgetting it) would silently break `.dd .ts`'s `var(--meta)` color with
no red test. **Action:** add a LIGHT palette exhaustive assertion in Task 3 mirroring the DARK one.

### H-1 (High) — `extractTimestamp` divergence from `parse.ts` is untested/undocumented
The render helper's `TS_LINE_RE` accepts a well-formed `▶ [label](https url)` even when the URL has no
`?t=` param, returning a `.ts` link anyway (correct for rendering — the link still works). `parse.ts`
additionally rejects when `startSec` is NaN. This intentional divergence is undocumented and untested.
**Action:** add an `extractTimestamp` test for a `▶` URL without `?t=`; note the divergence in the plan.

### M-2 (Medium) — `linkifyHeaderUrl` runs before the fence-aware split
Non-global replace → only the first `**URL:** <url>` is linkified, which is the header in well-formed
output. Safe in practice; add a code comment noting the header-comes-first assumption.

### M-1 / M-3 / L-1..L-5 (Medium/Low)
- M-1: Korean fullwidth period `．` (U+FF0E) not in the sentence-split regex — very low frequency; accept.
- M-3: same root as B-1 (fixed by the LIGHT palette test).
- L-1: Task 1 null-URL test depends on fixture `channel`/`duration` values (verified: `Andrej Karpathy` / `3:31:24`).
- L-2: no `BLOCK_START_RE` tests for `>` (blockquote) / `|` (table) — add one cheap case.
- L-4: no negative test for `**URL:**` mid-sentence — optional.
- L-5: `md.render('')` / `md.render('\n')` return `''` — safe, untested.

## Disposition
- **B-1, H-1:** addressed in the plan (LIGHT palette test added to Task 3; `extractTimestamp` no-`?t=`
  test + divergence note added to Task 2).
- **M-2, L-2:** folded in (code comment + one extra helper test).
- **M-1, L-1, L-4, L-5:** accepted as-is (documented limitations / already safe).

Gate satisfied for proceeding (Claude adversarial review in place of Codex).
