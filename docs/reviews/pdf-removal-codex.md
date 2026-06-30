# Codex Adversarial Review — PDF Removal

**Date:** 2026-06-30
**Branch:** `feat/remove-pdf-generation` (commits 0446a0c, 48e314a, d5a8c9d)
**Reviewer:** Codex (fresh thread), frontier model
**Scope:** Full removal of server-side PDF generation + summaryPdf/deepDivePdf schema fields.

---

## BLOCKING
None found.

## HIGH
None found.

## MEDIUM

- **[MEDIUM] `lib/index-store.ts:47` — stale keys persist in existing data files.**
  The plan asserts old `summaryPdf`/`deepDivePdf` keys "are dropped on next write," but the
  store does `JSON.parse` + cast without Zod validation, and the partial-update path (line 101)
  preserves unknown keys. Stale PDF fields persist indefinitely unless a whole video object is
  replaced. Low risk if current data is all-null, but external/user folders can retain the keys.

- **[MEDIUM] `jest.config.ts:7` — forceExit removal unverified in Codex's environment.**
  Codex's env hit EPERM writing Jest's cache, so it could not run the suite. Static scan found
  SSE/job timers use `.unref()`. Must run `npm test -- --runInBand --detectOpenHandles` in a
  writable env to confirm clean exit.
  **→ RESOLVED in dev environment:** full suite ran twice without forceExit (the `--no-forceExit`
  probe and the committed-config `npm test`), both exited cleanly with exit 0. Confirmed.

## LOW

- **[LOW] `README.md:3,11,25,71,73,82,84,109,122`** — still advertises `md-to-pdf`,
  `View Summary PDF`, `/api/pdf/[id]`, `lib/pdf.ts`, PDF export. Stale, no runtime impact.
- **[LOW] `docs/design-spec.md:5,18,61,63,80,82,84,118,120,159,180,181,210,213,265,279,297,300,301`**
  — original design spec still describes PDF fields, route, md-to-pdf, PDF menu. Historical artifact.
- **[LOW] `tests/components/DeepDiveStatusBar.test.tsx:125`, `tests/components/DeepDiveOverlay.test.tsx:102`**
  — synthetic SSE test events use the string `Writing PDF…`. No production path emits it; leftover wording.

## Verification performed
- `git diff master...HEAD` scanned.
- Live search across `app/`, `components/`, `lib/`, `scripts/`, `types/` for `summaryPdf`,
  `deepDivePdf`, `/api/pdf`, `md-to-pdf`, `generatePdf` → **no live production references**.
- `npx tsc --noEmit` passes clean.

## Verdict
Conditional merge. No confirmed build/runtime blocker or stale production PDF call path.
Two items before merge: (1) confirm suite exits without forceExit — **done in dev env**;
(2) decide whether stale PDF keys in existing data files need a one-time scrub (low risk, not a blocker).

## Resolution (this session)
- MEDIUM-2 (forceExit): already verified clean in dev env — no action.
- LOW README + "Writing PDF…" test strings + residual production comments: cleaned up (residual-removal mandate).
- MEDIUM-1 (stale data keys) + LOW design-spec rewrite: presented to user as decisions.
