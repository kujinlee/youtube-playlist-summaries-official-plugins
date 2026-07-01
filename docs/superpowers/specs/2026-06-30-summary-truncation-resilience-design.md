# Summary Truncation Resilience — Design Spec

**Date:** 2026-06-30
**Status:** v2 — Codex-reviewed (3 Blocking + HIGH addressed); awaiting user approval
**Branch (Stage 1):** builds on `fix/summary-truncation-guard`

## Problem

12 summary `.md` docs (all agentic-ai vault) were persisted **truncated** — ending mid-sentence, often a single section spanning the whole video. Investigation:

- The stored `.md` is truncated at the source (not a render bug); the writer interpolates the summary verbatim.
- A fresh replay of an affected video produces a **complete** summary — the input is fine; the failure is transient/stochastic.
- **Two distinct failure classes:**
  1. **Length truncation** — `finishReason = MAX_TOKENS` (thinking-model budget). Already handled by the shipped `assertNotTruncated()` guard, which re-rolls via the existing retry loop.
  2. **Content truncation at STOP** — the model returns `finishReason = STOP` with a summary cut mid-sentence. Replaying video 280 four times: **2/4 truncated with `finishReason STOP`**, token totals nowhere near any limit. The finishReason guard structurally cannot catch this class.

Remediation of the 12 through the guarded path fixed 9; **3 re-truncated at STOP** — proving class 2 is real and needs a content-level check.

## Fingerprint (the detection contract)

A completed prose summary always ends its final section on **sentence-terminating punctuation**. Truncation ends on a bare word, space, comma, or a dangling `:`/`(`.

**Terminal punctuation set (explicit, tested):** a line is "clean" if, after trimming trailing whitespace, it ends with one of `. ! ? …` or CJK `。 ！ ？`, **optionally** followed by a single closing quote/bracket `) ] " ” ’ 」 »`. Deliberately **excluded** as terminal-on-their-own: bare `)` (a parenthetical/link close is not a sentence end), bare `:` (promises a list that a truncation cut off), `—`, `,`, `;`. (Codex BLOCKING/HIGH: no bare `)`; explicit set.)

**Structural-ending guards** — the *final non-empty line* is considered complete WITHOUT terminal punctuation **only** when it is unambiguously structural, matched by precise rules (Codex HIGH — "bare list/heading" was too broad):
- inside an open/closed fenced code block (``` / ~~~), incl. indented fences
- a full horizontal rule line: `^\s*(-{3,}|\*{3,}|_{3,})\s*$` (this is what false-positived doc **236** — a trailing `-----` after a complete sentence)
- a Markdown table row: `^\s*\|.*\|\s*$`
- a line that is *entirely* a URL or a Markdown link `[..](..)`
A line that is prose cut off inside a list item / heading is **NOT** exempt (that is the observed "single section" truncation). Adversarial structural-only endings (fake table row, open fence) are flagged with a **lower-confidence** reason rather than blindly passed.

**Corroborating (raise confidence, not sole triggers):** `< 3` `## ` sections; no `## Conclusion`-equivalent; an unresolved trailing `[[TS:i]]` token; body abnormally short vs. transcript length.

**Language note:** generated summaries are required to end on punctuation in every language; an unpunctuated Korean/CJK syllable ending is treated as suspicious-but-possible (LOW). The detector **fails closed** — on any internal error it reports "suspicious" rather than throwing.

The detector is **high-confidence, not infallible** — hence the staged design (warn/audit before auto-action, manual override always available).

## Architecture — one detector, three consumers

Single source of truth: `lib/summary-completeness.ts`

```ts
export interface CompletenessResult {
  complete: boolean;
  reason?: string;                       // e.g. 'ends mid-sentence', 'zero sections'
  confidence?: 'high' | 'low';           // 'low' for structural-only endings (possible adversarial mask)
}
/** Inspect a summary .md body (full doc — tolerant of frontmatter). Never throws (fails closed). */
export function checkSummaryCompleteness(markdown: string): CompletenessResult;
```

### Stage 1 — Detect (warn + audit)  ← first PR, on the guard branch

1. `checkSummaryCompleteness()` + unit tests (the contract above, incl. every false-positive guard).
2. **Generation-time warning** in `writeSummaryDoc` (`lib/pipeline.ts`): after building the summary, if `!complete`, `console.warn('[summary-suspicious] <videoId>: <reason>')`. Never blocks or fails.
3. **Audit sweep**: `scripts/audit-summaries.ts` + `npm run audit-summaries` mirroring `audit-timestamps` — read-only. Iterates the videos in `playlist-index.json` (serial/videoId resolved from the index, NOT filename parsing — Codex LOW), reads each `summaryMd`, prints suspects (`videoId | serial | reason | confidence`). A malformed/missing file is reported as a suspect, never throws. Exit 0 always (report tool).

### Stage 2 — Auto-retry  ← second PR (stacked)

**Bounded retry budget (Codex BLOCKING).** Two nested levels, explicitly capped — no silent multiplication:
- **Inner (unchanged):** each `generateJson` call keeps its own `retries = 2` for *malformed JSON / schema / finishReason(non-STOP) / transient error*. These are hard failures — the call throws if all 3 fail.
- **Outer (new):** `generateSummary` performs up to `MAX_SUMMARY_ATTEMPTS = 4` *successful* parsed attempts, re-rolling only for **soft** quality misses: `!complete` (truncation) OR the existing timestamp-miss. The timestamp re-roll is folded INTO this single loop (it no longer adds a separate attempt). So worst case = 4 parsed summaries, each having possibly used up to 3 inner Gemini calls.

**Keep-best + warn on exhaustion (user-approved) — never throws for truncation.** Each attempt yields a full immutable `GeminiSummaryResponse`; the selected one is persisted **wholesale** (its ratings/tldr/takeaways/tags, not just the summary string). Selection ordering (Codex HIGH — explicit, deterministic):
1. `complete === true` beats incomplete
2. then more `## ` sections
3. then has a Conclusion-equivalent
4. then no unresolved `[[TS:i]]`
5. then longer resolved summary
On exhaustion without a `complete` winner, persist the best-scored attempt and warn.

`MAX_SUMMARY_ATTEMPTS` is a named constant, test-injectable (LOW). At the observed ~50% per-attempt truncation rate, 4 attempts ≈ 6% residual all-fail — acceptable given the audit + manual menu backstops.

**Standardized warning (all stages):** `console.warn('[summary-suspicious] <videoId> attempt=<n>/<N> selected=<n> reason=<r> complete=<bool> len=<n> sections=<n>')`.

### Stage 3 — Manual re-summarize menu  ← third PR (stacked)

Per-video **"Re-summarize"** action in `VideoMenu` for on-demand regeneration of a doc that looks off.

- **API (Codex BLOCKING — matches sibling-route convention):** `POST /api/videos/[id]/resummarize` with JSON body `{ outputFolder }` → returns `{ jobId }`; runs `ensureHtmlDoc(id, folder, onProgress, CURRENT_DOC_VERSION, force=true)`. Progress via SSE on a stream route scoped by `jobId`. Path-containment + `assertVideoId` + `assertOutputFolder` as in sibling routes.
- **Auth:** none — trusted single-user local app (explicit decision, consistent with all existing routes).
- **Concurrency (Codex HIGH):** one active job per `(outputFolder, videoId)`; a duplicate POST returns the in-flight `jobId` (idempotent). The menu action is disabled while its job is busy (reuses the existing per-row busy-state pattern).
- **UI:** non-blocking status bar following **`HtmlDocStatusBar`** precedent (NOT `BatchDocStatusBar`) — no full-screen overlay.

#### URL Contracts (Stage 3)
| Component | Link text | Full URL |
|---|---|---|
| VideoMenu | Re-summarize | `POST /api/videos/[id]/resummarize`  body `{ outputFolder }` → `{ jobId }` |
| ResummarizeStatusBar | (SSE subscribe) | `GET /api/videos/[id]/resummarize/stream?jobId=<uuid>` |

#### Overlay Dismissal (Stage 3)
| Component | Mechanism | Expected result |
|---|---|---|
| Re-summarize status bar | auto-close on `done` | bar disappears, row refreshes |
| Re-summarize status bar | ✕ button | bar dismissed; **operation continues server-side** (HtmlDocStatusBar semantics, not cancel) |
| Re-summarize status bar | Escape / backdrop | N/A — status bar is not a modal overlay |

## Already shipped (context)
`assertNotTruncated()` in `lib/gemini.ts` (finishReason guard at all 3 SDK call sites) — reviewed (Claude + Codex, no Blocking). This spec's Stage 2 complements it; the guard is not removed.

## Out of scope / follow-up
- **Read-time detection (Codex HIGH — explicit decision): OUT OF SCOPE.** The app will not badge suspicious summaries at list/render time; the on-demand `audit-summaries` sweep covers detection of already-stored docs. Revisit only if the audit proves insufficient.
- `lib/dig/generate.ts` raw-REST path doesn't read `finishReason` (both reviews flagged; pre-existing). Could adopt `checkSummaryCompleteness` for dig content later.
- Root-cause reduction (maxOutputTokens tuning, gemini-2.5-pro for long videos) — not pursued now; resilience via retry preferred over model change.

## Testing
- Unit: `checkSummaryCompleteness` — complete doc; mid-sentence; mid-word; comma/`;`/dangling-`:`/dangling-`(` end; bare `)` end (must FLAG); trailing horizontal rule `-----` (must PASS — the doc-236 case); table-row end; URL-only / link-only end; ellipsis `…` end; fenced-code end; indented list prose cut-off (must FLAG); trailing whitespace / multiple blank lines; zero sections; empty string; structural-only ending → lower-confidence reason.
- Unit (Stage 2): truncated-then-complete → asserts re-roll + best selection + exact call count (`MAX_SUMMARY_ATTEMPTS`); all-truncated → keep-best + warn (no throw); verifies full response object persisted (ratings/tldr from selected attempt); timestamp-miss and completeness share one attempt budget (no multiplication).
- Component/E2E (Stage 3): menu item present + disabled-while-busy; API happy path; body-missing-`outputFolder` 400; path-traversal 400; duplicate POST returns same `jobId`; status-bar auto-close + ✕ (continues server-side) dismissal paths.
