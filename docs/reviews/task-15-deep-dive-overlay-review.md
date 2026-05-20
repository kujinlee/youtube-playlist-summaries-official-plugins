# Task 15: Deep Dive Overlay — Claude Code Review

## Strengths

- Discriminated union state machine (`running | done | error`) — exhaustive, type-narrowed, no impossible states.
- All 13 enumerated behaviors implemented and tested.
- Tests: 5 grouped describes, one assertion per test, `sendEvent`/`renderOverlay` helpers reduce repetition.
- EventSource mock is sound: `writable: true`, `lastInstance` reset per test, no bleed between tests.
- TypeScript clean. Convention alignment: `'use client'`, local interface, named default export.

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)

**[I1] `esRef` is dead code**
- `esRef` is assigned on mount, nulled in cleanup, but never read.
- Misleads future developers into thinking there is an imperative escape hatch.
- Fix: Remove `useRef`, `esRef.current = es`, and `esRef.current = null`.

**[I2] No `onerror` handler — network failures silently frozen in `running` state**
- If SSE connection fails (server restart, job TTL, CORS, 404), `EventSource` fires `onerror`.
- Without a handler, component stays in `running` indefinitely — no user feedback, no way to dismiss.
- Fix: `es.onerror = () => { setState({ status: 'error', message: 'Connection lost. Please try again.', log: '' }); es.close(); };`

**[I3] Progress can exceed 100% if `current > total`**
- `aria-valuenow > aria-valuemax` is invalid per ARIA spec; `<progress value={167} max={100}` emits console warning.
- Fix: `Math.min(100, Math.round((current / total) * 100))`

### Minor (Nice to Have)

**[M1] Button label doesn't change when logs panel open** — always "Show Logs"; should be "Hide Logs" when open.

**[M2] Empty `<p>` rendered in initial state** when `step = ''`. Guard with `state.step && <p>…</p>`.

**[M3] No `aria-live` region** for status changes — screen reader users not notified when done/error fires.

**[M4] Missing test: `onClose` callback fires when Close button clicked.**

**[M5] Missing test: initial `aria-valuenow` is `'0'`.**

**[M6] No Tailwind styling** — project-wide deferral, not a defect here.

## Recommendations

1. Remove `esRef` (2 min).
2. Add `es.onerror` handler (10 min) — closes a real failure mode.
3. Add `Math.min(100, …)` clamp (30 sec).
4. Defer M1–M6 to Task 6/polish pass.

## Assessment

**Ready to merge:** No — with fixes (I1–I3 before commit).

**Reasoning:** Core logic is correct, state machine is sound, all 13 behaviors implemented. Three blocking findings are straightforward fixes (dead code, onerror handler, progress clamp) that close real failure modes. No design changes required. Defer minor items to next task.
