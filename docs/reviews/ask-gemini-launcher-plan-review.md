# Adversarial Review — Ask Gemini Launcher (Plan + Spec)

**Reviewer:** Claude Opus 4.8 fallback (Codex rate-limited until 2026-07-03, per `docs/plugins.md`).
**Date:** 2026-06-09
**Subjects:**
- `docs/superpowers/specs/2026-06-09-ask-gemini-launcher-design.md`
- `docs/superpowers/plans/2026-06-09-ask-gemini-launcher.md`

**Verdict:** CHANGES-REQUIRED → all Blocking + High addressed in plan/spec (see Resolution below).

---

## Findings

### BLOCKING

**B1 — Fallback state should be `role="alert"`, not `role="status"`.**
The codebase pairs `role="status"` (success) with `role="alert"` (error/degraded) across
`BackfillOverlay`, `DeepDiveOverlay`, `DeepDiveStatusBar`, `HtmlDocStatusBar`,
`CorrectionsPanel`, `NoteCell`. The fallback ("Could not copy automatically") is a degraded
path → should be `role="alert"`. Lets the success test keep an unambiguous `getByRole('status')`.

**B2 — Hand-counted `await Promise.resolve()` microtask flushes are brittle and off-convention.**
The reject path (`.then().catch()`) settles a tick later than the resolve path; the plan used
one flush for resolve, two for reject. House style (`Header.test.tsx`) pumps the queue with
`await act(async () => { await jest.advanceTimersByTimeAsync(0); })` rather than counting.

**B3 — State-mutating click fired outside `act`.**
Bare `fireEvent.click` then a later `act`-wrapped flush invites React 19 `act()` warnings; the
rest of the suite wraps the interaction in `act`.

### HIGH

**H1 — Fallback `<textarea>` is tab-reachable inside `role="menu"`.** Add `tabIndex={-1}`.

**H2 — Clipboard-*unavailable* branch (spec-mandated) is untested.** The `else` branch (no
`navigator.clipboard`) has no fixture — also violates the dev-process null/non-null fixture rule.
Add a test that removes `navigator.clipboard` and asserts the fallback + that `window.open` fired.

**H3 — "Gemini still opened on clipboard failure" invariant claimed but not asserted.** The
reject test never asserts `window.open` was called. Add the `open` assertion to the reject and
unavailable tests.

### MEDIUM

**M1 — Stale "popup-blocked" reference in the plan's File Structure table** (de-scoped). Remove.
**M2 — Hard-coded test counts** will drift once H2/H3 add tests. Update.
**M3 — Consistency check PASSES.** EN/KO strings match byte-for-byte across spec, Task 1 impl,
Task 1 tests, Task 2 tests; `EXPECTED_URL` matches `buildGeminiUrl` output exactly.
**M4 — Task 3 insertion point is accurate** (verified against real `VideoMenu.tsx`: WatchYT `<li>`
closes line 59, Obsidian `<li>` opens line 60).

### LOW

**L1 — `itemClass` duplicated** from `VideoMenu.tsx` (drift smell; acceptable for this size).
**L2 — `⌘V` is Mac-centric** (spec-mandated string). Generalized to `⌘V / Ctrl+V`.
**L3 — `Object.defineProperty(navigator,'clipboard')` not restored** by `restoreAllMocks`; the
unavailable test must explicitly delete the override to avoid leak.
**L4 — minor a11y** (visible text differs between states; sufficient).

### Process / compliance
- TDD red→green→commit ordering: compliant.
- Spec typo: Testing Strategy said "#6–#11" but behaviors top out at #10 → fixed.
- Behaviors-table adversarial pass (dev-process wants one for >8 behaviors + multiple error
  paths): satisfied by this plan-level adversarial review, which examined the behaviors table
  and acceptance criteria directly.

---

## Resolution (applied to plan + spec)

| Finding | Action |
|---|---|
| B1 | Fallback → `role="alert"`; success test keeps `getByRole('status')`. |
| B2 | All async flushes → `await act(async () => { await jest.advanceTimersByTimeAsync(0) })`; auto-close via `advanceTimersByTimeAsync(2500)`. |
| B3 | Click wrapped in async `act` for the async cases. |
| H1 | `tabIndex={-1}` on the fallback textarea. |
| H2 | Added clipboard-unavailable test (deletes `navigator.clipboard`). |
| H3 | Added `expect(open).toHaveBeenCalledWith(...)` to reject + unavailable tests. |
| M1 | Removed "popup-blocked" from File Structure description. |
| M2 | Updated Task 2 count to 5 tests. |
| L2 | Success string → `paste (⌘V / Ctrl+V)`. |
| L3 | Unavailable test deletes the clipboard override explicitly. |
| Spec typo | "#6–#11" → "#6–#10". |
| L1, L4 | Acknowledged; no change (out-of-scope DRY / sufficient a11y). |
