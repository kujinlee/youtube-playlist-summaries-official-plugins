# PR1 (dig captions) Task 2 — Codex Adversarial Review

**Diff:** eeb9bf6..48f6e3e. Model: frontier (--fresh, Codex online). **Verdict: Ready to merge** — no correctness blocker.

## 6-check result
1. Default-on: CORRECT — `c(raw)= raw==='off'?'off':'on'` (exact-match); 'OFF'/' off '/null/''/garbage → shown; only exact 'off' hides.
2. FOUC: CORRECT — CAPTIONS_HEAD_SCRIPT in `<head>` before `<style>`; class added pre-paint.
3. Body sync/toggle: CORRECT — initial apply syncs aria-pressed+text; click toggles on current class (no re-read race).
4. Test quality: print assertion plain `toContain` (not cross-brace regex); C3 non-vacuous (patches DOMTokenList.add, asserts hasToggle=false + readyState=loading). C4 gap — see finding.
5. localStorage fail-safe: all 3 access points try/catch; blocked → shown, no uncaught error.
6. Render-only: confirmed (only render-dig-deeper.ts + 2 test files; no generate.ts, no version bump).

## Findings
| Sev | Location | Finding | Decision |
|---|---|---|---|
| Low | dig-slide-captions.spec.ts C4 (:74-81) | C4 doesn't prove the blocked-localStorage mock was actually exercised — could pass vacuously if override failed. | **FINAL-TRIAGE fix** — add a hit-counter in the throwing getItem/setItem mock and assert `>0` (mirrors the size-control S6 "prove actually blocked" pattern). Batched into final fix wave. |

No Blocking/High/Medium.
