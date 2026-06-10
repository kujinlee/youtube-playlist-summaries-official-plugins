# Claude Review — Ask Gemini Launcher (implementation)

**Branch:** `feat/ask-gemini-launcher`
**Date:** 2026-06-09
**Files:** `lib/ask-gemini.ts`, `components/AskGeminiMenuItem.tsx`, `components/VideoMenu.tsx`, and their tests.
**Result before fixes:** 710/710 tests, `tsc --noEmit` clean.

---

## Stage 1 — Spec compliance

**Verdict: SPEC-COMPLIANT.** All Enumerated Behaviors (#1–#10) verified MATCH with file:line
evidence. EN/KO prompt strings byte-for-byte; `buildGeminiUrl` exact (`prompt` then
`autosubmit=false`, only the prompt value encoded); `window.open(...,'_blank','noopener,noreferrer')`
return value ignored (no popup-blocked branch); success = `role="status"` + auto-close 2.5s,
fallback = `role="alert"` + textarea + no auto-close; clipboard-unavailable also routes to
fallback; menu item always enabled, placed after "Watch on YouTube". No scope creep, no gaps.

## Stage 2 — Code quality

No High-severity issues. The clipboard feature-detection (`write && typeof write.then === 'function'`),
`noopener,noreferrer`, and `encodeURIComponent` prompt-injection handling are all correct. Tests
are solid (fixtures cover en/ko/reject/unavailable/unmount; correct per-file cleanup of the
`defineProperty` clipboard override).

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | Medium | Re-entrant clicks orphan the auto-close timer (`AskGeminiMenuItem.tsx`): each success click assigns a fresh `setTimeout` to `timerRef.current` without clearing a pending one → leaked timer + possible double `onClose`. | **Fixed** — clear any pending timer at the top of `handleClick`; added a re-entrant-click test asserting `onClose` fires once. |
| 2 | Low | Direct `onClose` capture in the timer diverges from the codebase's `onCloseRef` pattern (`HtmlDocStatusBar.tsx`), risking a stale closure for a future consumer. | **Fixed** — adopted the `onCloseRef` ref pattern. |
| 3 | Low | Success color `emerald-400` deviates from the codebase's `green-400` success convention (`DeepDiveOverlay`, `BackfillOverlay`, `DeepDiveStatusBar`). | **Fixed** — `green-400`. |

### Notes (no action)
- `{ kind: 'idle' }` union member is intentionally never rendered (initial button-only state).
- `buildGeminiPrompt` implicit English fallback is correct given the closed `'en' | 'ko'` enum.

---

**Adversarial (Codex) pass owed** once quota resets 2026-07-03 — the plan-level adversarial
review (Claude-Opus fallback) is recorded in `ask-gemini-launcher-plan-review.md`.
