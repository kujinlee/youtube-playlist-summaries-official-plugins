# Review (code + adversarial) — Ask-AI Sized Popup

**Reviewer:** Claude combined code+adversarial subagent (Codex at usage limit → stands in per governance). Re-run Codex before merge if access returns.
**Date:** 2026-06-28
**Branch:** `feat/ask-ai-sized-popup`

**Verdict: Ready to merge. No Critical/Important.** Change is correct, ES5-clean, gracefully degrades; the security trade-off is justified.

## Verified
- **Dropping `noopener` is safe here:** destination is `https://gemini.google.com/app` (trusted); the dig doc is a static localhost page with no auth/forms/sensitive DOM. Reverse-tabnabbing can at most navigate a throwaway local tab (cross-origin can't read the opener's DOM). `win.opener=null` (best-effort, try/catch correct) removes the back-ref where allowed. Residual risk: none material. Referrer leak = localhost origin only (prompt already rides in the URL query).
- **Correctness:** ES5-plain (var/concat/Math, `function(_e)` catch); `screen.availWidth/availHeight` always defined in a real browser; `popup=1` is the spec-blessed popup hint; math can't produce an unparseable features string.
- **Failure modes:** popup blocked → `window.open` returns null → `if(win)` guards the sever → no crash; clipboard+toast still run (graceful degradation). Mobile → opens as a tab, still subscription-backed.
- **Coexistence:** three independent document click listeners (nav `.dg`-scoped, zoom `.dig-slide`, ask-ai `.ask-ai`) isolated via `closest('.ask-ai')`; `preventDefault` only on `.ask-ai` hits. No cross-firing.
- **Tests meaningful:** A3 captures the features arg + asserts `popup=1`/`width=`/`height=`/`left=`/no-`noopener`; jest asserts the script contains the popup logic and the old full-tab call is gone (regression guard). Honest limit: the browser actually sizing the OS window is native behavior, untestable — correctly scoped out.

## Minor notes (both addressed in polish commit)
- **No `availWidth` guard** → on a degenerate (0/undefined `availWidth`) browser, `left` could be negative (browser clamps; no crash). → **Fixed:** `var sw=screen.availWidth||1280` used for both `w` and `left`.
- **A3 didn't co-assert the URL** (URL covered by A1/A2 separately). → **Fixed:** A3 now captures the URL arg too and asserts the same call opened the gemini url.

Post-polish: 1444 jest + A1–A3 E2E green, tsc clean.
