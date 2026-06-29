# Task 1 (dig slide size control) — Codex Adversarial Review

**Diff:** b73579c..2dcd00f. Model: frontier (--fresh). Completed cleanly (no fallback).

## Findings
| # | Severity | Location | Finding | Decision |
|---|---|---|---|---|
| 1 | High | render-dig-deeper.ts print block | Print CSS overrides the two var consumers but does NOT reset `--dig-slide-scale` to `1` at root → any future print-time consumer of the var stays scaled. Violates "reset to base" intent. | ~~FIX — add `:root{--dig-slide-scale:1}`~~ **LATER REVERSED in Task 2** — the `:root` @media rule is defeated by the size script's inline style on documentElement (CSS specificity). It was dead/misleading; dropped. Print correctness is enforced by the two element-level consumer overrides, which ARE the only var consumers. See `task-dig-slide-size-control-t2-codex.md` M3. |
| 2 | Medium | sanitizer `DIG_SLIDE_SANITIZE_JS` | Whitespace-only stored value (`' '`) bypasses `raw===''` guard; `Number(' ')===0` → clamps to 50 instead of 100. | **FIX** — add `if(typeof raw==='string'&&raw.trim()===''){return 100;}` after the null short-circuit (preserves PB1 null-first ordering). |

**No XSS/injection** — sanitized numerics to setProperty/value/textContent/localStorage only; no innerHTML/eval.
**No FOUC** — head script before `<style>` confirmed.
**No localStorage failure gap** — read/write both try/catch with 100 fallback / silent skip.

## Test gaps (Codex)
- Sanitizer branches (null/''/whitespace/non-finite/clamp/snap) untested directly → **add unit test via Function() on exported const** (also proves H2).
- Print block var-reset not asserted → folded into Claude Important #1 (full print-block literal assertion).
- Interactive controls / var-mapping / blocked-storage / pre-paint-with-stored-value → **owned by Task 2 E2E (S1–S7)**, not Task 1 unit; do not duplicate.

## Adjudication (AFK-autonomous)
Plan locked the sanitizer + print CSS verbatim; H1/H2 deviate additively and better satisfy the stated contract ("reset to base", "bad/missing → 100"). Included. Whitespace case added to E2E S5 table in Task 2.
