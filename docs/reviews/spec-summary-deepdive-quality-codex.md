# Codex Adversarial Review — Summary + Deep-Dive Quality Pass (Spec)

**Date:** 2026-06-18 · **Tool:** `codex:rescue --fresh` · **Branch:** feat/summary-deepdive-quality
**Target:** `docs/superpowers/specs/2026-06-18-summary-deepdive-quality-pass-design.md`

---

## Blocking
- **Fix 4 normalizer is underspecified and can corrupt fenced code.** §6 says "every line that is exactly `---`" gets padded, but only exempts frontmatter, not fences. `parse.ts` is already fence-aware for dividers (`lib/html-doc/parse.ts:42-80`); the normalizer must be too. Otherwise a YAML/code sample with `---` inside a fence is mangled. Fix: line scanner tracking ``` and ~~~ fences, normalize only outside fences; tests for exact `---` inside fence, `-----` inside fence, unterminated fence, CRLF, idempotency.

## High
- **Fix 2 fallback ordering loses a viable recovery path.** §4a: transcript success → combined fail → transcript-only, with no video-only fallback. If combined fails due to size/limit, transcript-only may fail the same way while video-only could still work. Fix: distinguish failure classes or add a final video-only fallback after transcript-only failure, reporting all errors.
- **Fix 2 progress/logging contract is stale.** Current deep-dive hardcodes total `3` and URL-first (`lib/deep-dive.ts:32-44`, line 112). Tests assert "does not fetch transcript" on happy path and total `3` (`tests/lib/deep-dive.test.ts:102-115,126-134,190-196`). Fix: define new steps/totals (transcript fetch, combined gen, fallback gen, PDF, mode logging) and update tests to assert `combined|transcript|video`.
- **Combined Gemini support is plausible but not validated against this SDK.** Repo uses `@google/generative-ai`; current Gemini docs use `@google/genai`; JS YouTube examples omit `mimeType` while code includes it (`lib/gemini.ts:206-219`). Fix: add an integration/manual verification task for `fileData(youtubeUrl)+text(transcript)` with the installed SDK; unit-test request shape.
- **Fix 3 palette swap can silently break existing CSS vars.** Current deep-dive CSS uses `--h1,--h2,--hr,--strong` (`render-deep-dive.ts:21-51`); proposed palette replaces these with `--rule,--gold,--li` etc. Partial change → invalid var resolution. Fix: update every var reference or add compatibility aliases; update palette tests (`tests/lib/html-doc/render-deep-dive.test.ts:92-117`, `tests/e2e/darkmode-html.spec.ts:134-150`).
- **Version bump under-specified for the stacked Feature 2 branch.** Depends on Feature 2's `ensureHtmlDoc` major path + model deletion (`ensure.ts:38-50`); stacking can merge `{2,0}`/`{3,0}` out of order or leave fixtures stale. Fix: state this branch must land after Feature 2, document rebase handling for `CURRENT_DOC_VERSION`, update `{2,0}` expectations (`tests/lib/doc-version.test.ts:4-16`, `tests/lib/html-doc/ensure.test.ts:33-63`).

## Medium
- **Quick-view insertion safe only if normalizer scoped exactly as promised.** `insertQuickViewCallout` searches first literal `\n\n---\n` (`pipeline.ts:240-242`). Normalize `summary` before assembly, not `baseContent`; add regression test that quick-view still lands before the first summary `##`.
- **Magazine parser likely tolerates padded dividers, but require a test.** `parse.ts:77-80` drops dash dividers outside fences regardless of blank lines; existing tests don't cover fenced exact `---` or padded summary dividers. Add both.
- **Fix 1 "preserve concrete specifics" can incentivize invented specifics.** Re-phrase: "preserve only concrete specifics present verbatim or directly paraphrased in the input; if absent, do not add examples."
- **Cache concern for Fix 1 mostly handled — cite the mechanism.** `ensureHtmlDoc` deletes `models/<base>.json` before `runHtmlDoc` (`ensure.ts:48-50`). Add acceptance test: stale `{2,0}` with cached model deletes model and calls `generateMagazineModel`.
- **Fix 3 `h2 + p` lead fails when first block is a list/`h3`/blockquote/code.** Either require prompts to emit an opening paragraph after every `##`, or accept paragraph-led-only leads; test both.
- **Fix 3 prototype conflicts with "no markup change."** Prototype uses `.doc-title`/`.doc-meta`; renderer emits plain `<h1>` + paragraph metadata inside `.dd` (`render-deep-dive.ts:60-79`). Either style `.dd > h1:first-child` + first metadata paragraph, or explicitly allow minimal wrapper/class markup.

## Low
- **Ghost numerals need layout constraints.** `.dd h2::before` at `right:0` can overlap long/multiline headings. Add `padding-right`, `z-index`, mobile rules; screenshot/DOM test with a long heading.
- **Counter scoping may decorate unintended `h2`s.** Document that every H2 is a numbered deep-dive section, or scope it.
- **Spec has an orphan code fence at the end.** Remove it so tooling doesn't treat the tail as fenced code.
