# Pre-generate summary HTML doc at ingestion — design

**Date:** 2026-06-29
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** Sub-project 1 (Backend / ingestion pipeline)

---

## Goal

When a video is ingested, build its **summary HTML doc** as part of ingestion, so it is ready
to open immediately — instead of being generated on-demand (with a multi-second Gemini wait)
the first time the user clicks the "HTML doc" menu option.

Motivating workflow: the user opens a video's summary and goes straight to **HTML doc** rather
than Obsidian, so the on-demand generation step fires for nearly every video, every time.

---

## Current behavior (baseline)

| Stage | Work | Cost | When (today) |
|---|---|---|---|
| 1. Summarize | transcript → summary `.md` | Gemini call | **at ingestion** (`writeSummaryDoc`, `lib/pipeline.ts:44`) |
| 2. Model transform | section prose → `{lead, bullets}` magazine model → `models/<base>.json` | **Gemini call** | on first "HTML doc" click (`runHtmlDoc`, `lib/html-doc/generate.ts:39`) |
| 3. Render | model + parsed `.md` → HTML → `htmls/<base>.html` | **~0.085 ms (CPU)** — measured | on first "HTML doc" click |

At ingestion only the `.md` is written; the model JSON and HTML are deferred. The first "HTML doc"
open pays **stage 2 + stage 3**, and stage 2 (a `gemini-2.5-flash` transform) is the entire felt
delay (~3–8 s typical). The render (stage 3) is negligible.

The "HTML doc" menu (`components/VideoMenu.tsx:70`) shows a **direct link** when `video.summaryHtml`
is set and the doc version is current, otherwise a **generate button**.

---

## Decision

**Pre-generate the full summary HTML at ingestion** (stages 2 + 3), writing `models/<base>.json`,
`htmls/<base>.html`, and setting `video.summaryHtml` — so the menu becomes a direct link and opening
is instant.

### Why full pre-gen (and not "warm the model only")

Both options pay the **expensive** stage-2 Gemini transform at ingest; they differ only on the
**free** stage-3 render (0.085 ms) + an ~11 KB file write:

- **Same** open delay (sub-second), **same** Gemini cost, **same** style-change refresh behavior
  (the serve route re-renders stale HTML from the cached model — `app/api/html/[id]/route.ts:90` —
  gated on `GENERATOR_VERSION`, no Gemini).
- Warm-model defers only the *free* half while keeping the *expensive* half eager — backwards.
- Warm-model would also require changing `ensureHtmlDoc`'s tested fresh-build branch
  (`!summaryHtml → runHtmlDoc`, which **re-calls Gemini** rather than reusing a cached model),
  buying nothing.
- Full pre-gen reuses the existing build path untouched and yields the cleaner link-based menu.

→ Full pre-gen strictly dominates warm-model. (See conversation analysis for full reasoning.)

### Why pre-gen at all (gain vs cost)

The stage-2 Gemini call is **one flash call per video either way** — pre-gen *relocates* it from
"interactive, mid-reading" to "the background ingestion batch the user already runs unattended."
Net gain: instant, click-free opens; docs arrive read-ready; no per-doc status-bar interruption.
Net cost: the transform runs for docs the user may never open. Acceptable because the user opens
nearly all docs as HTML, ingestion processes **only new videos** (already-indexed videos are
skipped — `lib/pipeline.ts:303`), and flash cost is a fraction of a cent per video. An opt-out flag
covers the bulk-re-ingest edge case.

---

## Design (Approach A — in-loop, synchronous, best-effort)

### Where

In `runIngestion`'s per-video loop (`lib/pipeline.ts`), immediately **after** `upsertVideo(...)`
(line 354) and the `'Saved'` step — at which point the video is in the index with `summaryMd` set,
which `runHtmlDoc` requires.

### What

Call **`runHtmlDoc(videoId, outputFolder, onProgress)`** (`lib/html-doc/generate.ts:11`) directly.

Rationale — **not** `ensureHtmlDoc`: `lib/html-doc/ensure.ts:4` imports `writeSummaryDoc` from
`../pipeline`, so `pipeline.ts → ensure.ts → pipeline.ts` would be a **circular import**.
`generate.ts` (which exports `runHtmlDoc`) does not import `pipeline.ts` — no cycle. And the version
logic in `ensureHtmlDoc` is a **no-op at ingest** anyway: a freshly-ingested video (`summaryMd` set,
no `summaryHtml`, `docVersion === CURRENT_DOC_VERSION`) deterministically takes `ensureHtmlDoc`'s
Path B → `runHtmlDoc`. So calling `runHtmlDoc` directly does the identical work — performs the
stage-2 transform, writes the model envelope + HTML, sets `summaryHtml` — with no cycle and no
dynamic-import workaround. (`docVersion` is already current, so the docVersion update `ensureHtmlDoc`
would do is itself a no-op.)

### How (control flow)

The pre-gen block is **inserted between** `upsertVideo(...)`/`alreadyIndexed.add(...)` (current
`lib/pipeline.ts:354–356`) and the existing `'Saved'` step emit (current `:358`) — so `'Saved'`
stays the terminal per-video step:

```
// after upsertVideo(...) and alreadyIndexed.add(...), BEFORE the existing 'Saved' emit:
if (process.env.PREGEN_SUMMARY_HTML !== 'off') {
  onProgress({ type: 'step', videoId, title, step: 'Generating HTML doc…',
               current: newIndex, total: newTotal });
  try {
    await runHtmlDoc(meta.videoId, outputFolder, () => {});  // no-op adapter — swallow its
                                                             // own start/step/done events
  } catch (err) {
    // best-effort: .md already saved + video already upserted; leave summaryHtml unset so the
    // menu falls back to on-demand generation. Surface a non-fatal note, never fail the video.
    onProgress({ type: 'step', videoId, title, step: 'HTML doc deferred (will generate on open)',
                 current: newIndex, total: newTotal });
  }
}
// existing line, now reached after the pre-gen attempt:
onProgress({ type: 'step', videoId, title, step: 'Saved', current: newIndex, total: newTotal });
```

Notes:
- The **no-op adapter** (`() => {}`) is required: `runHtmlDoc` emits its own
  progress shape (`{type:'start'}`, `current:1,total:3`) which would corrupt the ingest stream's
  "video N of M" counter. The ingest stream surfaces a single coarse `'Generating HTML doc…'` step.

### Progress / SSE

One new per-video step string on the existing ingest stream (`/api/ingest/stream`):
`'Generating HTML doc…'`, with the same `{current: newIndex, total: newTotal}` video counter as the
surrounding steps. On best-effort failure, a `'HTML doc deferred …'` step (non-fatal). No new event
*types* — reuses `{type:'step'}`.

### Error handling (best-effort, non-negotiable)

Pre-gen is wrapped in `try/catch`. A stage-2 Gemini failure (e.g., the documented intermittent
invalid-JSON case after retries) must **never**:
- fail the video's ingestion (the `.md` is already written and the video already upserted), nor
- abort the batch.

On failure, `summaryHtml` stays unset → `VideoMenu` shows the generate button → on-demand path
(today's behavior) takes over. Pre-gen is a pure accelerator, never a new failure surface.

### Opt-out flag

`PREGEN_SUMMARY_HTML` — disabled when set to `'off'` (mirrors the `DIG_CROP === 'off'` idiom,
`lib/dig/slide-crop-map.ts:28`). Default **on**. Lets a large bulk re-ingest skip pre-gen and fall
back to fully on-demand HTML generation.

---

## Out of scope

- **Deep-dive HTML** and **dig-deeper** docs — stay fully on-demand (heavier generation).
- **Warm-model variant** — rejected (see Decision).
- **Bulk-re-ingest special handling** beyond the opt-out flag — not built; the flag covers it.
- **No new output file format** — pre-gen writes the *existing* `models/<base>.json` and
  `htmls/<base>.html` artifacts, just earlier. No format/serve-route changes.
- **No `docVersion` / `GENERATOR_VERSION` bump** — behavior of existing docs is unchanged; this only
  changes *when* new videos' HTML is built.

---

## Testing strategy (TDD)

Unit/integration at the pipeline boundary, mocking Gemini at the lib boundary (`lib/gemini.ts`)
per project mocking policy. Enumerated behaviors (contract for the plan's test list):

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Pre-gen runs for a new video | ingest a new video, flag unset/on | `runHtmlDoc` invoked once with that videoId + outputFolder (its own tests cover artifact production + `summaryHtml`) |
| 2 | Model + HTML artifacts produced | new video ingested | `models/<base>.json` and `htmls/<base>.html` exist on disk |
| 3 | Coarse SSE step emitted | new video ingested | a `{type:'step', step:'Generating HTML doc…', current, total}` event on the ingest stream with the video counter intact |
| 4 | `runHtmlDoc` internal progress does not leak | new video ingested | a sentinel event emitted by the mocked `runHtmlDoc`'s `onProgress` arg never appears on the ingest stream (proves the no-op adapter, not the real `onProgress`, was passed) |
| 5 | Best-effort on Gemini failure | stage-2 transform throws | video still ingested (`.md` present, video in index), batch continues, `summaryHtml` unset, non-fatal `'HTML doc deferred…'` step emitted |
| 6 | Failure does not abort batch | first new video's pre-gen throws, second succeeds | second video fully ingested + pre-genned |
| 7 | Opt-out disables pre-gen | `PREGEN_SUMMARY_HTML='off'`, ingest new video | `runHtmlDoc` NOT invoked; `.md` written; no `'Generating HTML doc…'` step |
| 8 | Already-indexed videos skipped | re-ingest a playlist with existing videos | no pre-gen for already-indexed videos (loop `continue` at :303 still short-circuits) |
| 9 | Order: Saved is terminal | new video ingested | `'Generating HTML doc…'` precedes `'Saved'` for that video |
| 10 | Cancellation respected | abort signal mid-batch | no pre-gen after cancellation (existing `signal.aborted` check at :294 still governs the loop) |

Edge cases folded in above: Gemini failure (5,6), flag off (7), duplicate/already-indexed (8),
cancellation (10), progress-shape isolation (4).

---

## Files touched (anticipated)

- `lib/pipeline.ts` — the pre-gen call + flag + SSE step in `runIngestion`'s loop (the only
  production change).
- `tests/lib/pipeline.*test.ts` (or the ingestion integration test) — behaviors 1–10.
- No changes to `ensureHtmlDoc`, `runHtmlDoc`, `render.ts`, the serve route, or `VideoMenu`.
