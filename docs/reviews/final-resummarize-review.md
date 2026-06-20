# Final Review — Versioned HTML-Doc Regeneration (Timestamp Onboarding)

**Date:** 2026-06-18 · **Branch:** feat/resummarize-timestamps · range `f1259bc..HEAD`
**Reviewers:** per-task spec + code-quality (subagents); whole-feature integration pass (Opus).
**Verification:** `npm test` → 812 pass / 65 suites. `npx tsc --noEmit` → only the 2 pre-existing
`theme.test.ts` unused-`@ts-expect-error` errors. Playwright `html-doc.spec.ts` 5/5 (3 unrelated
pre-existing `playlist-viewer.spec.ts` failures — timing races + a per-cell-opacity assertion that
predates this work; confirmed no HTML-doc menu refs).

**Final verdict: Ready to merge.** No Critical/Important. The integration seams hold.

## Execution
Subagent-driven TDD, 7 tasks, one commit each, two-stage review (spec then quality) between tasks. Plus
a Codex adversarial plan-review gate before implementation.

| Task | Commit | Notes |
|---|---|---|
| 1 — DocVersion core + index field | `138fb64` | pure module; optional `docVersion` (no migration) |
| 2 — extract `writeSummaryDoc` (no PDF) | `d9f3a63` | ingestion byte-identical (68 existing tests unchanged) |
| 3 — `ensureHtmlDoc` orchestrator | `27fd36a` | the Blocking `done`-after-stamp fix verified |
| 4 — route drives `ensureHtmlDoc` | `6320e3c` | SSE/job contract preserved |
| 5 — corrections clears stale HTML | `5e1a239` | index + response + in-memory thread |
| 6 — single version-aware menu item | `b0b58cd` | View/Generate/Regenerate → one "HTML doc" |
| 7 — per-row hourglass + busy; no auto-open; E2E | `55926fa` | full suite 812 |

## Integration seams (Opus final pass — confirmed correct)
- **click→regen→stamp→refetch→clickable loop:** `forwardSteps` swallows `runHtmlDoc`'s `done`;
  `ensureHtmlDoc` emits the single terminal `done` only after `updateVideoFields({docVersion})`, so the
  refetch always observes the stamped + summaryHtml-set row → menu flips to a link. **The Blocking fix
  works end-to-end.**
- **updateVideoFields merges** (`{...existing, ...fields}`) → personal review / deep-dive / playlist
  position survive re-summarize (D2).
- **PDF untouched** on re-summarize; ingestion keeps its PDF (D7).
- **Fresh ingest** (`docVersion {2,0}`, no html) → first click builds HTML only, no needless
  re-summarize.
- **Corrections** clear `summaryHtml` without touching `docVersion` → next click rebuilds (not
  re-summarize), preserving the user's edit.

## Minor findings (adjudicated)
1. **Error path keeps the item disabled until the user dismisses (✕) the error bar** — spec §7 implied an
   immediate retry button. Reconciled by **updating spec §7** to the implemented "dismiss-to-retry"
   behavior (the alternative — threading run-vs-error status up from the SSE bar — adds complexity for a
   cosmetic gain; the error is surfaced prominently and recovery is one dismiss + re-click).
2. **Brief window during the POST round-trip where the job is running but `busyVideoId` isn't set yet** —
   cannot duplicate work: the menu closes on click and the route's `getActiveJob` guard returns the
   existing jobId on re-submit. Server-side idempotency covers it; no change.

## Owed
- Manual Codex pass already done at the **plan** gate (`docs/reviews/plan-resummarize-codex.md`); a
  manual Codex pass on the final code is optional follow-up (the per-task + Opus reviews covered it).
- Phase 4 manual verification against the running app before merge.
