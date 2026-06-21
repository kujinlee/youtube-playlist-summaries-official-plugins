# Task 10 Review — E2E (Playwright) deep-dive doc flow + stale-spec reconciliation

**Commit:** `90aaeac` — test(deep-dive): E2E flow, link params, dismissal, no-transcript, idempotency; migrate stale deep-dive E2E
**Reviewer:** Claude (controller). Adversarial pass: **Claude fallback** — Codex usage-limited until ~2026-07-18 per `docs/plugins.md`.
**Date:** 2026-06-21

## Scope (3 parts)
1. **New spec** `tests/e2e/deep-dive-doc.spec.ts` — 6 scenarios, 4 fixtures (stale {1,0} / current {2,0} / never-null / no-transcript).
2. **Reconcile stale E2E** broken by T7 (menu unify) + T9 (done-state link): deleted `deep-dive-html.spec.ts` (asserted removed `/view deep dive html/i`); fixed `playlist-viewer.spec.ts` two `'✓ Done'` assertions → View link, plus a `Dismiss`-selector ambiguity scope fix and a stale 3s→4s comment.
3. **Run + verify.**

## Verification (controller-run, not trusted from implementer)
- `npx playwright test tests/e2e/deep-dive-doc.spec.ts` → **6/6 pass.**
- `npx playwright test ... --grep "[Dd]eep [Dd]ive"` (migrated playlist-viewer deep-dive tests) → **6/6 pass.** Deep-dive E2E total **12/12**.
- `npx tsc --noEmit` → only the 2 known baseline errors in `theme.test.ts`. No new errors.
- Commit touches exactly the 3 intended e2e files; working tree otherwise clean.

## Test-quality audit (per project E2E rules) — PASS
- **Link assertions assert ALL params:** Scenario 2 asserts `pathname` + `outputFolder` + `type=deep-dive` (3 expects), not just one.
- **All dismissal paths covered:** ✕ button (Scenario 3) and auto-close-after-done (Scenario 4, 6s margin for the 4s timer).
- **Fixtures cover null AND non-null:** stale (deepDiveHtml set, {1,0}), current (set, {2,0}), never (null), no-transcript (null).
- **No-transcript path:** Scenario 5 fetches the served HTML and asserts absence of ▶ — a real content assertion, not a vacuous one.
- **Idempotency:** Scenario 6 spies on POST `/deep-dive` and asserts count 0 across two menu opens of a current doc.

## Concern raised by implementer — RESOLVED (pre-existing, proven)
Combined run showed 2 failures: `ingest: progress bar shown then video list populated on done` (line 129) and `archive: row gets opacity-50 class` (line 383, asserts `/opacity-40/` at line 418). **Proven pre-existing on master, NOT caused by Bundle B:**
- `components/VideoRow.tsx`, `VideoList.tsx`, `Header.tsx` are byte-identical to master (`git diff --stat master...HEAD` empty for them).
- The ingest (L129) and archive (L383) test bodies are untouched — the only `playlist-viewer.spec.ts` hunks are in the deep-dive region (@217/@304/@369).
- The entire `app/page.tsx` diff vs master is 4 deep-dive edits (viewUrl on deepDive state + handler; busyVideoId cross-disable; viewUrl prop) — none touch the ingest progress bar or archive opacity.
Therefore both failures reproduce identically on master. **Recommendation:** track as a separate follow-up (the archive test is internally inconsistent — title says "opacity-50" but asserts `/opacity-40/`; the ingest test is SSE-timing-sensitive). Out of scope for this branch.

## Adversarial findings
- **F1 (carried from T9, Low, PRE-EXISTING):** `app/page.tsx` has two raw NUL bytes (lines 79/143) → git treats it as binary. Recommend a pre-PR `\0`-escape cleanup. See `task-9-status-bar-view-link-review.md`.
- No new findings for the E2E work.

## Disposition
T10 approved. Deep-dive E2E 12/12 green. 2 pre-existing unrelated failures flagged for follow-up. Feature implementation (T1–T10) complete.
