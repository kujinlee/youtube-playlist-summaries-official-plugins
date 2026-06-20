# Final Review — Summary + Deep-Dive Quality Pass

**Date:** 2026-06-19 · **Branch:** feat/summary-deepdive-quality (stacked on PR #2 / `feat/resummarize-timestamps`)
**Range:** `5a99391..HEAD` (8 code commits) · **Reviewers:** per-task spec + code-quality (subagents); whole-feature integration pass (Opus).
**Gates:** `npm test` → **839 pass / 70 suites, 0 fail**. `npx tsc --noEmit` → only the 2 pre-existing `theme.test.ts` unused-`@ts-expect-error` baseline errors. Playwright `darkmode-html.spec.ts` 10/10.

**Final verdict: Ready to merge** (pending Task 9 manual verification on the running app).

## Execution
Subagent-driven TDD, 8 tasks, one commit each, two-stage review (spec then quality) between tasks, plus a Codex adversarial review at both the spec and plan gates (`docs/reviews/spec-…-codex.md`, `docs/reviews/plan-…-codex.md`).

| Task | Commit | Notes |
|---|---|---|
| 1 — fence-aware `padDividers` | `1fa806f` | pure module, 12 tests incl. fence/CRLF/idempotency |
| 2 — wire into `writeSummaryDoc` + prompt belt | `a75bd5b` | pads Gemini body only; quick-view ordering preserved |
| 3 — fuller magazine bullets | `89496ac` | full faithful sentences + anti-hallucination guard |
| 4 — `CURRENT_DOC_VERSION {3,0}` + cache test | `277525e` | intent-preserving fixture updates; cache-deletion acceptance test |
| 5 — `buildDeepDivePrompt(lang,mode)` | `769fe1a` | comprehensive/structured/grounded; drops editorializing; ASCII rules preserved verbatim |
| 6 — `generateDeepDiveCombined` + shape test | `168b016` | transcript+video in one request; request-shape covered |
| 7 — transcript-primary cascade | `a9957b4` | combined→transcript→video, all-errors reporting, `mode` surfaced in progress; 6 routing rows |
| 8 — deep-dive magazine skin | `c4f74f2` | palette + STRUCTURAL_CSS migration; body untouched; dark E2E per-element |

## Integration seams (Opus final pass — all hold)
- **Rollout coherence:** a `{2,0}` doc clicked → `ensureHtmlDoc` `needsResummarize` → `writeSummaryDoc` (padDividers, fix 1) → delete `models/<base>.json` → `runHtmlDoc` → `generateMagazineModel` under the fuller-bullet prompt (fix 2). Both summary fixes reach existing docs through the one path.
- **Deep-dive cascade:** calls the three generators with correct args; each uses `buildDeepDivePrompt` with the matching mode; `<transcript>` appended exactly once per transcript-bearing path (no double-wrap).
- **Skin = CSS only:** `md.render(body)` faithful body path byte-identical; only palette + STRUCTURAL_CSS changed.
- **No cross-fix interference:** padDividers is fence-aware + idempotent; `parse.ts` drops `-{3,}` dividers regardless of blanks, so section splitting is unchanged.
- **Consistency:** `mode` union, `buildDeepDivePrompt` signature, `CURRENT_DOC_VERSION` single source — all consistent. No dead code / orphaned old prompts.

## For Task 9 (manual verification) — must-knows
- **Existing deep-dives do NOT auto-upgrade to the new skin.** The serve route returns the cached `htmls/<base>-deep-dive.html` when present; there is no docVersion for deep-dives (by design — regen is the rollout). **Regenerate the deep-dive** (which deletes the cached HTML) — verifying on a stale cached HTML shows the OLD skin and looks like a false failure.
- **SDK acceptance gate (deferred from Task 6):** the live `@google/generative-ai` acceptance of `fileData(video)+text(transcript)` is validated HERE, on the first real combined deep-dive. Confirm the progress shows `mode: combined`. If the SDK rejects the shape, the fallback cascade (transcript-only → video-only) still produces a deep-dive; apply the documented SDK fallback only if combined never succeeds.
- **Fixes 1/2/4 are LLM/visual** — regenerate a real video end-to-end and eyeball: `.md` section bodies render as paragraphs (not bold) in Obsidian (fix 1); magazine bullets are full + specific (fix 2); deep-dive HTML matches `prototype-darkmode/deepdive-magazine-skin.html` in light + dark, full prose/lists/diagrams intact (fix 4).
- **PDF intentionally left stale** on summary re-summarize (not a regression).

## Owed / follow-ups (non-blocking)
- Pre-existing repo-wide limitation: `padDividers` and `parse.ts` treat a closing fence with an info string (```` ```python ````) as a valid closer — coordinated fix deferred.
- Optional: extract a shared `BASE_PALETTE` if a third renderer appears (palette now duplicated across `render.ts` / `render-deep-dive.ts`).
- Branch must merge AFTER PR #1 and PR #2 (stacked); `{3,0}` and `ensureHtmlDoc` depend on Feature 2.
