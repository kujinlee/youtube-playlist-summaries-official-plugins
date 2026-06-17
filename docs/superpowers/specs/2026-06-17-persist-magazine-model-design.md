# Persist Magazine Model (3a) — Design Spec

**Date:** 2026-06-17
**Status:** Draft — pending user review
**Scope:** Persist the Gemini-derived magazine model alongside each summary HTML so future style changes can re-render every summary **offline, deterministically, with no Gemini calls**.

---

## 1. Problem

A summary HTML is a derived artifact baked from three inputs: the summary `.md` (on disk,
deterministic), the **magazine model** (Gemini transform — expensive, non-deterministic), and
the renderer (`lib/html-doc/render.ts`). Today `runHtmlDoc` (generate.ts:38) calls Gemini on
every run and **discards the model** — only the HTML is written. So any change to the renderer
(a style adjustment) invalidates every stored summary HTML, and the only way to refresh them is
to call Gemini again. With the dark-mode change this already happened: 3 existing summaries went
stale and can't be refreshed without re-running Gemini.

This feature caches the one expensive, non-deterministic step (the model) so the cheap
deterministic step (render) can be replayed for free whenever the style changes.

## 2. Goal & Non-Goals

**Goal:** After a renderer/style change, re-render all summaries that have a cached model with a
single offline command — no Gemini, deterministic output.

**Non-goals (explicitly out of scope):**
- Schema-version fields, content-hash invalidation, auto-rebuild daemons, or any
  staleness-tracking apparatus. (Overengineering for the current ~3-file scale.)
- Changing the summary serve route to live-render (that is option "3b" — deferred).
- Any UI / API surface — re-render is a **CLI script only**.
- Recovering models for already-generated summaries (impossible — the model was never saved;
  they are onboarded by one regeneration, see §7).

## 3. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Re-render input | **Re-parse current `.md` + cached model**, guarded by **section-title** equality (not just count — see §4.2) |
| D2 | Trigger surface | **CLI/script**, offline batch |
| D3 | Model JSON shape | **Thin envelope**: `{ sourceMd, generatedAt, sourceSections, model }` |
| D4 | Model file location | **By convention**: `models/<base>.json`, existence-checked; no index field, no migration |
| D5 | Code structure | **Lib function** (`rerender.ts`) does the work; **thin CLI script** loops the index |
| D6 | Re-render scope | Only summaries that **already have `summaryHtml`** (it refreshes an existing doc) |

> **Drift guard — why titles, not counts (adversarial review H1).** The renderer zips
> `model.sections[i]` with `parsed.sections[i]` **by index**. A count-only guard misses a `.md`
> edit that reorders or replaces a section while keeping the count — the cached lead/bullets would
> render under the wrong heading. Only section *titles*/numerals and the model lead/bullets are
> rendered (section *prose* is not), so verifying the section-title array fully protects alignment
> while still letting non-title edits (TL;DR, channel, takeaways) flow through. The envelope therefore
> stores `sourceSections` (the section titles the model was built against), and re-render skips on any
> title mismatch.

## 4. Architecture

### 4.1 Write the model — `lib/html-doc/generate.ts`
In `runHtmlDoc`, after `generateMagazineModel(...)` returns the model and **before** rendering
HTML, persist the envelope:
- Path: `<outputFolder>/models/<base>.json`, where `base = video.summaryMd` with the trailing
  `.md` removed (same base used for `htmls/<base>.html`).
- Envelope fields: `sourceMd`, `generatedAt`, `sourceSections` (= `parsed.sections.map(s => s.title)`,
  the titles the model was transformed against), and `model`.
- Atomic write: temp file → `rename` (mirrors the existing HTML/index write pattern).
- **Validated on write** (`ModelEnvelopeSchema.parse`) so an invalid model fails loud rather than
  producing a file the reader would silently reject (adversarial review B1).
- `mkdirSync(models/, { recursive: true })`.
- Orphan handling: if a later step fails, an orphan `models/<base>.json` may remain. It is harmless
  because re-render is gated on `summaryHtml` (D6) — an orphan model whose summary never finished
  generating (`summaryHtml` still null) is simply ignored until a successful regeneration overwrites it.

### 4.2 Re-render library — `lib/html-doc/rerender.ts` (new)
```ts
type ReRenderResult =
  | { status: 'rerendered'; htmlPath: string }
  | { status: 'skipped-no-model' }      // no summaryMd / no summaryHtml / no model file / unknown id
  | { status: 'skipped-no-md' }         // model present but .md gone from disk
  | { status: 'skipped-unparseable' }   // .md present but parseSummaryMarkdown threw
  | { status: 'skipped-drift'; mdSections: string[]; modelSections: string[] };

export function reRenderSummaryHtml(videoId: string, outputFolder: string): ReRenderResult;
```
Steps:
1. Resolve the video from the index. No video / no `summaryMd` / **no `summaryHtml`** (D6 — nothing
   existing to refresh) → `skipped-no-model`. Derive `base` from `video.summaryMd`.
2. Read `models/<base>.json`. Absent / unparseable / schema-invalid → `skipped-no-model`
   (a `console.warn` is logged when a present file fails validation).
3. Read the current `.md`; missing → `skipped-no-md`.
4. `parsed = parseSummaryMarkdown(md)` wrapped in try/catch; a throw (e.g. zero sections) →
   `skipped-unparseable`. Set `parsed.sourceMd = video.summaryMd`.
5. **Drift guard (title equality):** if `parsed.sections.map(s => s.title)` is not deep-equal to
   `envelope.sourceSections` → `skipped-drift` (carry both title arrays for reporting). Do **not**
   render — the section content moved; the doc needs a Gemini regeneration.
6. `html = renderMagazineHtml(parsed, envelope.model)`; atomic-write `htmls/<base>.html`.
   No Gemini call. No index mutation (`summaryHtml` is already set, per D6).

Total function: returns a defined status for every data condition and throws only on an HTML
**write** I/O failure. Pure given the two files; unit-testable with the Gemini boundary never touched.

### 4.3 CLI script — `scripts/rerender-html.ts` (new)
- Read the playlist index for a given `outputFolder` (arg or settings).
- For each video, call `reRenderSummaryHtml`; tally results.
- Print a summary line plus an itemized list of skipped docs with reasons, e.g.:
  ```
  re-rendered 12, skipped 3
    skipped-no-model: the-abcs-of-agent-building (regenerate once to enable)
    skipped-drift:    deep-dive-into-llms (md sections 7 ≠ model 6 — regenerate)
  ```
- Exit 0 (skips are informational, not failures).

## 5. Output File Format

**Filename convention:** `<outputFolder>/models/<base>.json`, where `<base>` is the summary
note filename without `.md`. One model file per summary, 1:1 with `htmls/<base>.html`.

Example: summary `full-ai-prompting-course-with-andrew-ng.md`
→ model `models/full-ai-prompting-course-with-andrew-ng.json`
→ html `htmls/full-ai-prompting-course-with-andrew-ng.html`

**Required fields:**
| Field | Type | Meaning |
|-------|------|---------|
| `sourceMd` | string | The summary note filename this model was derived from (provenance). |
| `generatedAt` | string (ISO 8601) | When the model was produced by Gemini. |
| `sourceSections` | string[] | The section titles the model was transformed against (drift guard, §4.2). Same length & order as `model.sections`. |
| `model` | `MagazineModel` | The transform output: `{ sections: [{ lead, bullets: [{ label, text }] }] }`. |

**Annotated sample** (`models/full-ai-prompting-course-with-andrew-ng.json`):
```json
{
  "sourceMd": "full-ai-prompting-course-with-andrew-ng.md",
  "generatedAt": "2026-06-17T10:30:00.000Z",
  "sourceSections": ["The Foundations of Prompting"],
  "model": {
    "sections": [
      {
        "lead": "Prompting is the new programming interface for LLMs.",
        "bullets": [
          { "label": "Clarity", "text": "Specific instructions beat clever phrasing." },
          { "label": "Context", "text": "Give the model the data it needs in-prompt." },
          { "label": "Iteration", "text": "Treat prompts like code: test and refine." }
        ]
      }
    ]
  }
}
```
`model` conforms to `MagazineModelSchema` (`lib/html-doc/types.ts`): `sections` ≥ 1, each with a
non-empty `lead` and 3–7 bullets of `{ label, text }`. The envelope is **validated on both write
and read** (`ModelEnvelopeSchema`): write fails loud on an invalid model; a malformed/invalid file
on read is logged (`console.warn`) and treated as `skipped-no-model` (never crashes the batch).

**Path safety (accepted-low):** `base` is derived from `video.summaryMd`, a bare slug filename;
the index is locally trusted. This mirrors the pre-existing `htmls/<base>.html` path handling — no
new validation added.

## 6. Error Handling

| Condition | Behavior |
|-----------|----------|
| Video missing / no `summaryMd` / no `summaryHtml` | `skipped-no-model` (nothing existing to refresh) |
| Model file absent | `skipped-no-model` |
| Model file present but unparseable / fails schema | `skipped-no-model` + `console.warn` |
| `.md` missing on disk | `skipped-no-md` |
| `.md` present but unparseable (e.g. zero sections) | `skipped-unparseable` (no throw out of the single-call) |
| `parsed` section titles ≠ `sourceSections` | `skipped-drift` (flag for regeneration) |
| HTML write failure | atomic temp cleanup, throw (batch reports it as `error` and continues) |
| Invalid model at `writeModelEnvelope` | throw (fails the generation; no unreadable file written) |
| Model write failure in `runHtmlDoc` | throw before HTML render |

## 7. Onboarding Existing Summaries

The 3 current summaries have HTML but no model (the model predates this feature and can't be
recovered). They report `skipped-no-model` until regenerated once via the app
(`POST /api/videos/[id]/html-doc`), which now also writes `models/<base>.json`. Thereafter every
restyle is a free re-render. Documented as a one-time manual step; no automated backfill.

## 8. Testing

- `tests/lib/html-doc/generate.test.ts` (extend): asserts `runHtmlDoc` writes
  `models/<base>.json` with the envelope (`sourceMd`, `generatedAt`, `model`) and correct content;
  Gemini mocked at the lib boundary.
- `tests/lib/html-doc/rerender.test.ts` (new): happy re-render writes `htmls/<base>.html` and
  **never calls Gemini**; `skipped-no-model`, `skipped-no-md`, and `skipped-drift` (section-count
  mismatch) each covered; malformed model file → `skipped-no-model`.
- Script: thin wrapper; one smoke/integration test that runs it against a temp fixture folder
  with a model present, a model absent, and a drift case, asserting the tally.

## 9. File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/html-doc/generate.ts` | Also persist the model envelope before rendering. | Modify |
| `lib/html-doc/rerender.ts` | Offline re-render of one summary from cached model + current `.md`. | Create |
| `scripts/rerender-html.ts` | Batch CLI over the index; tally + report skips. | Create |
| `tests/lib/html-doc/generate.test.ts` | Model-write assertions. | Modify |
| `tests/lib/html-doc/rerender.test.ts` | Re-render + skip-path coverage. | Create |
