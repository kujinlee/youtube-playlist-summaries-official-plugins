# Task 2 (dig slide size control E2E) — Codex Adversarial Review

**Diff:** 8ade914..0917f4c (single new file `tests/e2e/dig-slide-size.spec.ts`). Model: frontier (--fresh). Completed cleanly (no fallback). All findings test-only — no renderer change.

## Findings
| # | Severity | Location | Finding | Decision |
|---|---|---|---|---|
| H1 | High | S3 :58–72 | Pre-paint proof relies on `hasControl===false`; `readyState` captured but never asserted. (Controller note: `hasControl===false` IS sound here — body script always runs after the control markup — but hardening is cheap.) | **FIX** — also track `.dg-size`, assert both absent at first write; assert `readyState==='loading'`. |
| H2 | High | S7 :130–132 | Measures `figure.dig-slide-crop` width without first asserting it exists → would fail as locator error, not a clear vacuity guard. | **FIX** — `await expect(fig).toHaveCount(1)` before measuring. |
| M1 | Medium | S1/S2/S4/S5/S6 | One-shot `expect(await scale()).toBe(...)` can race async style application. | **FIX** — convert to `await expect.poll(() => scale(page)).toBe(...)`. |
| M2 | Medium | S5 table | No pure snap-to-10 case (44→50 is snap+clamp). | **FIX** — add `['73','0.7']`. |
| M3 | Medium | S7 :133–136 | Print test never asserts the var itself resets to `1` (the Task-1 Codex-H1 fix). | **FIX** — `await expect.poll(() => scale(page)).toBe('1')` after print emulate. |
| Low | Low | S3 :62,72 | Tracks only `.dg-size-range`, not `.dg-size`. | **FIX** — folded into H1. |

**Summary verdict (Codex):** "Stronger than a purely tautological CSS-variable suite" — S3 instruments setProperty, S7 measures real width, S5 covers null/missing/empty/whitespace/non-numeric/clamp/percent-mapping. Gaps are the hardenings above.

## Decision (AFK-autonomous)
H1/H2/M1/M2 + Low: applied as test-only hardening (commit fb14aaa).

**M3 — REVERSED after empirical finding.** Implementing M3 (assert var resets to '1' in print) REVEALED that the Task-1 Codex-H1 fix (`:root{--dig-slide-scale:1}` in `@media print`) is INEFFECTIVE: the size script sets an INLINE style on `documentElement`, which outranks any `@media` stylesheet rule (CSS specificity). So the var never resets in print when JS has run. Print output is nonetheless correct because the two element-level consumer overrides (`max-height:300px` / `width:min(100%,540px)`) win at the element level — and those two rules are the ONLY consumers of the var.
- **Resolution:** dropped the dead/misleading `:root{--dig-slide-scale:1}` print rule (reverses Task-1 H1), dropped the impossible E2E var assertion, kept the working consumer overrides + the S7 layout assertion (width≤541). Rejected the alternative (JS `onbeforeprint`/`onafterprint`) as overbuild — `emulateMedia` can't fire those events, and no print consumer reads the var. This returns to the EXACT locked contract ("print resets both slide RULES to base size"). See `task-dig-slide-size-control-t1-codex.md` H1 note.
