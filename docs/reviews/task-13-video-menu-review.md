# Task 13: Video Menu Component — Claude Code Review

**All 163 tests pass, TypeScript compiles cleanly.**

---

## Strengths

- **Plan alignment solid.** All 6 menu actions present in correct order. Disabled states gate on `deepDiveMd !== null` as specified. Archive/Unarchive label toggle and `onArchive` callback are correct.
- **Obsidian URI construction correct.** `obsidianHref` matches spec exactly — `vault` = `outputFolder`, `file` = videoId or `{videoId}-deep-dive`, both encoded with `encodeURIComponent`.
- **Disabled link pattern correct.** `href="#"` + `aria-disabled="true"` + `e.preventDefault()` preserves link ARIA role (plain `<a>` without `href` loses the role).
- **Test suite thorough.** 25 tests cover row display, menu visibility toggle, all 6 actions, both disabled/enabled branches, both archive label variants, and callback invocations.
- **Clean separation of concerns.** VideoRow owns toggle state only. VideoMenu is a pure-render component.

---

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

**1. "View Summary PDF" doesn't guard against `summaryPdf: null`**
- File: `components/VideoMenu.tsx:26`
- Why: `summaryPdf` is `string | null` in the type. A row can render before PDF generation completes. The link hits the API with no file to serve. Apply the same disabled-link pattern used for deep-dive items when `summaryPdf === null`.

**2. Missing `aria-expanded` and `aria-haspopup="menu"` on toggle button**
- File: `components/VideoRow.tsx:27-33`
- Why: Screen readers announce the button as a plain button with no indication it controls a menu or its current open/closed state. Required for ARIA disclosure button conformance.
- Fix: Add `aria-haspopup="menu"` and `aria-expanded={menuOpen}` to the button.

**3. "Deep Dive" disabled-state discrepancy between plan and design spec (resolved: design spec wins)**
- `docs/implementation-plan.md` text says "Deep Dive + Open Deep Dive + View Deep Dive PDF disabled when deepDiveMd is null" — but this contradicts the design spec, which marks only "Open Deep Dive in Obsidian" and "View Deep Dive PDF" as "(disabled if not generated)".
- The design spec is the authoritative UI source. "Deep Dive" is the generation trigger and must be always-enabled. Implementation is correct. Plan text was imprecise.
- **No code change needed.** The existing test `'is enabled regardless of deepDiveMd value'` correctly captures the intended behavior.

### Minor (Nice to Have)

**4. `hasDeepDive` ignores `deepDivePdf`**
- If `deepDiveMd` is set but `deepDivePdf` is null (pathological state), "View Deep Dive PDF" renders as an active broken link. Low-risk in practice since the pipeline writes both atomically.

**5. No test for Obsidian URI with special-character `outputFolder`**
- `OUTPUT_FOLDER = '/Users/test/vault'` has no characters `encodeURIComponent` actually transforms. Add a test with a path containing spaces or `&`.

---

## Recommendations

1. Fix `aria-expanded` and `aria-haspopup` — add corresponding test asserting `aria-expanded` reflects open/closed state.
2. Add disabled-link guard for `summaryPdf === null` in VideoMenu — add test for this case.
3. Add Obsidian URI encoding test with `outputFolder` containing special characters.

---

## Assessment

**Ready to merge:** With fixes — items 1 and 2 are required.

**Reasoning:** Core contract met — all 6 actions, correct Obsidian URIs, correct disabled states — but the unguarded `summaryPdf: null` path and missing `aria-expanded` are straightforward to fix before marking done.
