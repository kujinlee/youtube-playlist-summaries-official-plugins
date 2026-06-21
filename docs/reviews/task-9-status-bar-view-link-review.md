# Task 9 Review — DeepDiveStatusBar "View Deep Dive doc" link on done

**Commit:** `66ecde0` — feat(deep-dive): status bar shows 'View Deep Dive doc' link on done
**Reviewer:** Claude (controller). Adversarial pass: **Claude fallback** — Codex is usage-limited until ~2026-07-18 per `docs/plugins.md`. Re-run the Codex-specific pass pre-merge if access returns.
**Date:** 2026-06-21

## Scope
Bring `DeepDiveStatusBar` to parity with `HtmlDocStatusBar`: add a required `viewUrl` prop, render a "View Deep Dive doc ↗" link on `done` (replacing the `✓ Done` span), align auto-close to 4000ms, and wire `viewUrl` from `app/page.tsx`.

## Files
- `components/DeepDiveStatusBar.tsx` — `viewUrl: string` prop; done-state link mirrors HtmlDocStatusBar (`target="_blank"`, `rel="noopener noreferrer"`, `className="text-xs text-amber-400 underline flex-shrink-0"`); `setTimeout` 3000→4000; `viewUrl` added to effect deps.
- `app/page.tsx` — `deepDive` state type gains `viewUrl: string`; built in `handleDeepDive` as `/api/html/${enc(videoId)}?outputFolder=${enc(outputFolder)}&type=deep-dive` (mirrors `handleGenerateHtml`); passed `viewUrl={deepDive.viewUrl}` at the render site.
- `tests/components/DeepDiveStatusBar.test.tsx` — `renderBar()` passes `viewUrl`; +5 link tests; done-state ✓-assertions and 3000/2999 timings updated to the link / 4000/3999.

## Spec compliance — PASS
Matches plan Task 9 and the design spec §6 (UI parity). Mirrors the sibling component's data flow (viewUrl stored in job state, not constructed inline) for consistency.

## Test coverage — PASS
- Link renders on done; full `href` equality; `type=deep-dive` param; `outputFolder` truthy; `target`/`rel` safe attrs (link-assertion rule: ALL params asserted).
- Dismissal paths: ✕ button (running/done/error), auto-close at 4000ms, not before 3999ms, unmount cancels timer.
- Regression guards: old `✓ Done` span gone; jobId-change resets to progressbar 0 with link absent.
- RED→GREEN confirmed (9 fail → 38 pass in-file).

## Verification (controller-run, not trusted from implementer)
- **Full `npx jest`: 904/904 pass, 75 suites.** No regressions.
- **`npx tsc --noEmit`:** only the 2 known pre-existing baseline errors in `tests/lib/html-doc/theme.test.ts` (unused `@ts-expect-error`). No new errors.
- Commit touches exactly the 3 intended files; working tree otherwise clean.

## Adversarial findings
- **F1 (Low / informational, PRE-EXISTING — not introduced by T9):** `app/page.tsx` contains two raw NUL bytes (0x00) at lines 79 and 143, used as the separator in path-pair comparison keys (`` `${base}\x00${folder}` ``). Both sides use the same separator, so the comparison is correct; NUL is a deliberate collision-proof delimiter (filesystem paths can't contain NUL, unlike a space). **Cost:** git/`file` classify `page.tsx` as binary, so it gets no line-level diffs in review (the T9 diff had to be forced with `git diff --text`). **Recommended fix (separate commit, out of T9 scope):** replace the raw 0x00 byte with the source escape `\0` (`` `${base}\0${folder}` ``) — identical runtime string, but the file becomes plain text and regains git diffs. Present in `8028db7` and earlier; flagged for user decision.
- **F2 (none):** `viewUrl` staleness — captured at POST time like `htmlJob.viewUrl`; serve route (`type=deep-dive`, added T6) consumes the same captured `outputFolder`. Consistent, no issue.
- **F3 (none):** `viewUrl` is required; the only consumer is `app/page.tsx` (wired) plus tests. No unguarded call sites.

## Disposition
T9 approved. No blocking issues. F1 is pre-existing and tracked separately.
