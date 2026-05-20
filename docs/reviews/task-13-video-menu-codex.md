# Task 13: Video Menu Component — Codex Adversarial Review

---

## Critical

None.

---

## High

**1. Disabled deep-dive links remain keyboard-focusable**
- File: `components/VideoMenu.tsx:37`, `components/VideoMenu.tsx:46`
- Why: `aria-disabled="true"` does not remove `<a href="#">` from tab order. Keyboard and AT users can still reach and activate "disabled" actions.
- Fix: Add `tabIndex={-1}` to disabled links, and ensure `e.preventDefault()` stays in place.

---

## Medium

**2. No Escape / outside-click close handling**
- File: `components/VideoRow.tsx:35`, `components/VideoMenu.tsx`
- Why: Standard UX expectation for dropdown menus. Menu has no way to close except re-clicking the toggle.
- Fix: Add `keydown` handler for Escape on the button/window, close on Escape; optionally close on outside click.

**3. `role="menu"` used without ARIA menu keyboard behavior; `role="menuitem"` on `<li>` wrappers instead of interactive elements**
- File: `components/VideoMenu.tsx:21-58`
- Why: ARIA menu pattern requires Arrow/Home/End/Escape keyboard navigation and roving tabindex. Using `role="menuitem"` on `<li>` is incorrect — it should be on the `<a>`/`<button>` elements.
- Fix (pragmatic): Move `role="menuitem"` to interactive elements (`<a>` and `<button>`). Full Arrow-key keyboard navigation is a future enhancement.

**4. "View Deep Dive PDF" active when `deepDivePdf` is null**
- File: `components/VideoMenu.tsx:17`, `components/VideoMenu.tsx:43-44`
- Why: `hasDeepDive` uses only `deepDiveMd !== null`. If `deepDivePdf` is null, the link serves a missing PDF.
- Fix: Gate "View Deep Dive PDF" on `video.deepDivePdf !== null`.

---

## Low

**5. `deepDiveMd !== null` treats empty string as generated**
- File: `components/VideoMenu.tsx:17`
- Why: Malformed runtime data (empty string) enables deep-dive actions with no usable path.
- Fix: Use truthy check: `!!video.deepDiveMd`.

**6. Disabled-action tests don't assert non-tabbability**
- File: `tests/components/VideoRow.test.tsx:153-181`
- Why: Tests assert `aria-disabled` only; they pass even if disabled links remain focusable.
- Fix: Add assertions for `tabIndex={-1}` on disabled links after fixing item #1.

---

## Actions

- High #1 (tabIndex=-1): **Fix**
- Medium #2 (Escape close): **Fix**
- Medium #3 (menuitem role placement): **Fix partially** — move role to interactive elements; full keyboard navigation is a future enhancement
- Medium #4 (deepDivePdf null check): **Fix**
- Low #5 (truthy check): **Fix**
- Low #6 (tabIndex test): **Fix** alongside #1
