# Codex Adversarial Review — Summary Truncation Resilience Spec

**Date:** 2026-06-30
**Verdict:** Not ready for Phase-1 gate until 3 Blocking resolved. Spec revised to address Blocking + HIGH.

## BLOCKING
1. **Retry budget undefined** — generateJson retries (2) + timestamp re-roll + new completeness re-roll could multiply silently. → Define one bounded budget.
2. **Terminal punctuation set inconsistent/incomplete** — bare `)` shouldn't be terminal; `:`/`—` questionable. → Explicit, conservative, tested set.
3. **Stage 3 POST contract** conflicts with repo convention (`outputFolder` in body, not query) and omits the SSE stream row. → Align + complete URL Contracts.

## HIGH
- bare `)` terminal → drop.
- "bare list/heading" guard too broad → precise structural rules; only exempt genuinely-structural final blocks.
- N ambiguity → name `MAX_SUMMARY_ATTEMPTS`, state exact total.
- keep-best scoring underspecified → explicit ordering + log selected attempt.
- URL Contracts missing SSE row + POST `{jobId}` response.
- Double-submit concurrency unspecified → one active job per (outputFolder, videoId).
- Read-time detection omitted → decide explicitly (marked out of scope; audit covers it).

## MEDIUM (addressed or noted)
- More detector fixtures (URL, link, ellipsis, colon, em-dash, inline code, parenthetical, indented/HTML/blockquote/setext).
- Adversarial structural-only endings → flag as lower-confidence, not blindly complete.
- N configurable; ~12.5% all-fail at N=3/50% noted.
- Retry candidate = full immutable GeminiSummaryResponse; selected persisted wholesale.
- Auth: explicit "local-only, no auth" decision.
- Standardized `[summary-suspicious]` payload (videoId, attempt, selected, reason, complete, length, sections).
- Detector/audit fail-closed (report, never throw).
- Overlay Dismissal: Escape/backdrop rows marked N/A (status bar, not overlay); ✕ follows HtmlDocStatusBar (continue server-side), not BatchDocStatusBar (cancel).

## LOW
- Korean unpunctuated endings: require punctuation in generated summaries; flag as suspicious-but-possible.
- Audit resolves serial/videoId via playlist-index.json, not filename parsing alone.
- Test trailing-whitespace/blank-line endings.

## Resolution
Spec v2 incorporates all Blocking + HIGH + most MEDIUM. Real-world validation: the ad-hoc scan false-positived on doc 236 (trailing `-----` horizontal rule after a complete sentence) — confirms the structural-ending guard is essential.
