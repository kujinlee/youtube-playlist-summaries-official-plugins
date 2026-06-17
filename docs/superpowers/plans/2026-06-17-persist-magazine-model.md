# Persist Magazine Model (3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the Gemini-derived magazine model next to each summary so future renderer/style changes can re-render every summary offline, deterministically, with no Gemini calls.

**Architecture:** A new `model-store.ts` owns the model-envelope file format (atomic write + validated read of `models/<base>.json`). `generate.ts` writes the envelope right after the Gemini transform. A new `rerender.ts` re-renders one summary (or all) from the cached model + the current `.md`, guarded against section-count drift. A thin `scripts/rerender-html.ts` runs the batch.

**Tech Stack:** TypeScript, Zod (validation, already used by `types.ts`), Jest + ts-jest. `ts-node` for the CLI. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-17-persist-magazine-model-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/html-doc/model-store.ts` | Envelope type + Zod schema; atomic `writeModelEnvelope`; validated `readModelEnvelope` (null on absent/malformed). | **Create** |
| `tests/lib/html-doc/model-store.test.ts` | Round-trip + malformed/absent read. | **Create** |
| `lib/html-doc/generate.ts` | Also write the model envelope before rendering HTML. | **Modify** |
| `tests/lib/html-doc/generate.test.ts` | Assert envelope written; orphan-on-failure is benign. | **Modify** |
| `lib/html-doc/rerender.ts` | `reRenderSummaryHtml` (one) + `reRenderAll` (batch tally). | **Create** |
| `tests/lib/html-doc/rerender.test.ts` | Happy re-render (no Gemini), each skip path, drift guard, batch tally. | **Create** |
| `scripts/rerender-html.ts` | Thin CLI: call `reRenderAll` per folder, print tally + skips. | **Create** |

**Atomic writes:** the codebase repeats a temp-file→`rename` pattern inline (index-store, generate.ts, pdf caller). This plan follows that convention inline in `model-store.ts` and `rerender.ts` rather than introducing a shared helper — staying consistent and avoiding an unrelated refactor.

---

## Enumerated Behaviors

`# | Behavior | Trigger | Expected`

**model-store.ts**
1 | Round-trip write→read | valid envelope | `models/<base>.json` written (pretty JSON); `readModelEnvelope` returns the same object
2 | Atomic write | write | uses temp file + rename; no `.tmp` left behind on success
3 | mkdir models/ | write when dir absent | creates `models/` recursively
4 | Absent file read | no file | `readModelEnvelope` → `null`
5 | Malformed JSON read | file is not JSON | `null` (no throw)
6 | Schema-invalid read | JSON but wrong shape (e.g. bullets empty) | `null` (no throw)
7 | Temp cleanup on write failure | rename throws | temp file removed, error rethrown

**generate.ts**
8 | Writes envelope after transform | `runHtmlDoc` success | `models/<base>.json` exists with `{sourceMd, generatedAt, model}` matching the transform output
9 | Envelope before HTML | success | model file present alongside `htmls/<base>.html`
10 | No envelope when transform fails | Gemini rejects | no `models/<base>.json` (write never reached)
11 | Orphan model benign on index failure | index update throws | HTML cleaned up (existing behavior unchanged); model file may remain — acceptable, not an error

**rerender.ts — reRenderSummaryHtml**
12 | Happy re-render | model + md present, counts match | writes `htmls/<base>.html` via `renderMagazineHtml`; **Gemini never called**; returns `{status:'rerendered'}`
13 | No model | model file absent | `{status:'skipped-no-model'}`, no write
14 | No summaryMd | video.summaryMd null | `{status:'skipped-no-model'}`
15 | Missing .md | model present, .md gone | `{status:'skipped-no-md'}`, no write
16 | Section drift | parsed.sections ≠ model.sections | `{status:'skipped-drift', mdSections, modelSections}`, no write
17 | Atomic html write | re-render | temp+rename; temp cleaned on failure
18 | Video not in index | unknown id | `{status:'skipped-no-model'}`

**rerender.ts — reRenderAll**
19 | Tally across videos | mixed folder | counts rerendered / skipped-* / errors; details list per video
20 | Per-video error isolation | one video's .md unparseable | counted as `error`, loop continues to others

**scripts/rerender-html.ts**
21 | Usage guard | no args | prints usage, exits 1
22 | Batch print | folder arg | prints tally line + skip details; exits 0

---

## Task 1: `model-store.ts` — envelope format (unit TDD)

**Files:**
- Create: `lib/html-doc/model-store.ts`
- Test: `tests/lib/html-doc/model-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/html-doc/model-store.test.ts`:

```ts
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeModelEnvelope, readModelEnvelope, type ModelEnvelope } from '../../../lib/html-doc/model-store';

let dir: string;
const BASE = 'a-title';
const ENVELOPE: ModelEnvelope = {
  sourceMd: 'a-title.md',
  generatedAt: '2026-06-17T10:30:00.000Z',
  model: {
    sections: [
      { lead: 'Lead one.', bullets: [
        { label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' },
      ] },
    ],
  },
};

beforeEach(() => {
  dir = path.join(os.homedir(), `.tmp-modelstore-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('model-store', () => {
  it('writes models/<base>.json and reads it back (round-trip)', () => {
    writeModelEnvelope(dir, BASE, ENVELOPE);
    const p = path.join(dir, 'models', 'a-title.json');
    expect(fs.existsSync(p)).toBe(true);
    expect(readModelEnvelope(dir, BASE)).toEqual(ENVELOPE);
  });

  it('creates the models/ directory if absent and leaves no temp file', () => {
    writeModelEnvelope(dir, BASE, ENVELOPE);
    const files = fs.readdirSync(path.join(dir, 'models'));
    expect(files).toEqual(['a-title.json']); // no .tmp leftovers
  });

  it('returns null when the model file is absent', () => {
    expect(readModelEnvelope(dir, 'missing')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'models', 'bad.json'), '{ not json', 'utf-8');
    expect(readModelEnvelope(dir, 'bad')).toBeNull();
  });

  it('returns null when the envelope fails schema validation', () => {
    fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
    // bullets must be 3–7; empty array is invalid
    const bad = { sourceMd: 'x.md', generatedAt: 'now', model: { sections: [{ lead: 'l', bullets: [] }] } };
    fs.writeFileSync(path.join(dir, 'models', 'bad2.json'), JSON.stringify(bad), 'utf-8');
    expect(readModelEnvelope(dir, 'bad2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest model-store.test`
Expected: FAIL — `Cannot find module '../../../lib/html-doc/model-store'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/html-doc/model-store.ts`:

```ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { MagazineModelSchema } from './types';

/** The persisted summary-model file: the Gemini transform output plus provenance. */
export const ModelEnvelopeSchema = z
  .object({
    sourceMd: z.string().min(1),
    generatedAt: z.string().min(1),
    model: MagazineModelSchema,
  })
  .strict();

export type ModelEnvelope = z.infer<typeof ModelEnvelopeSchema>;

function modelPath(outputFolder: string, base: string): string {
  return path.join(outputFolder, 'models', `${base}.json`);
}

/** Atomically write the envelope to models/<base>.json (temp file → rename). */
export function writeModelEnvelope(outputFolder: string, base: string, envelope: ModelEnvelope): void {
  const dir = path.join(outputFolder, 'models');
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = modelPath(outputFolder, base);
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

/** Read + validate the envelope. Returns null if absent, unparseable, or schema-invalid. */
export function readModelEnvelope(outputFolder: string, base: string): ModelEnvelope | null {
  let raw: string;
  try {
    raw = fs.readFileSync(modelPath(outputFolder, base), 'utf-8');
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ModelEnvelopeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest model-store.test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/model-store.ts tests/lib/html-doc/model-store.test.ts
git commit -m "feat(html-doc): model-store — persisted magazine-model envelope"
```

---

## Task 2: Write the envelope in `generate.ts`

**Files:**
- Modify: `lib/html-doc/generate.ts`
- Test: `tests/lib/html-doc/generate.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/html-doc/generate.test.ts` (after the existing `it(...)` blocks, before the file's final close):

```ts
it('persists the magazine model envelope to models/<base>.json', async () => {
  const model = {
    sections: [
      { lead: 'Lead one.', bullets: [{ label: 'L', text: 't' }] },
      { lead: 'Lead two.', bullets: [{ label: 'M', text: 'u' }] },
    ],
  };
  mockTransform.mockResolvedValueOnce(model);
  await runHtmlDoc(VIDEO_ID, dir, () => {});

  const modelPath = path.join(dir, 'models', 'a-title.json');
  expect(fs.existsSync(modelPath)).toBe(true);
  const envelope = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
  expect(envelope.sourceMd).toBe('a-title.md');
  expect(typeof envelope.generatedAt).toBe('string');
  expect(envelope.model).toEqual(model);
});

it('does not write a model envelope when the transform fails', async () => {
  mockTransform.mockRejectedValueOnce(new Error('boom'));
  await expect(runHtmlDoc(VIDEO_ID, dir, () => {})).rejects.toThrow(/boom/);
  expect(fs.existsSync(path.join(dir, 'models', 'a-title.json'))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest generate.test -t "model envelope"`
Expected: FAIL — `models/a-title.json` does not exist (envelope not written yet).

- [ ] **Step 3: Write minimal implementation**

Edit `lib/html-doc/generate.ts`. Add the import alongside the existing imports:

```ts
import { writeModelEnvelope } from './model-store';
```

Then, in `runHtmlDoc`, immediately after the transform line `const model = await generateMagazineModel(...)` and BEFORE the `onProgress({ ... 'Rendering HTML…' ... })` line, insert:

```ts
  // Persist the model so future style changes can re-render offline (no Gemini). Written before
  // the HTML so a partial later failure leaves only a benign orphan the re-render path can consume.
  const base = video.summaryMd.replace(/\.md$/, '');
  writeModelEnvelope(outputFolder, base, {
    sourceMd: video.summaryMd,
    generatedAt: new Date().toISOString(),
    model,
  });
```

Then DELETE the later duplicate declaration `const base = video.summaryMd.replace(/\.md$/, '');` (it currently sits just before `const htmlFilename = ...`) and keep using the `base` declared above. The `htmlFilename`/write/index lines are otherwise unchanged.

- [ ] **Step 4: Run tests**

Run: `npx jest generate.test`
Expected: PASS — the 2 new tests AND all existing generate tests (transform→html→index, transform-fails-writes-nothing, missing summaryMd, orphan-HTML-cleanup) still green. The orphan-cleanup test still passes: it only asserts the HTML is gone; a leftover model file is acceptable per spec §4.1.

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/generate.ts tests/lib/html-doc/generate.test.ts
git commit -m "feat(html-doc): persist magazine model on generate"
```

---

## Task 3: `rerender.ts` — re-render one summary (unit TDD)

**Files:**
- Create: `lib/html-doc/rerender.ts`
- Test: `tests/lib/html-doc/rerender.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/html-doc/rerender.test.ts`:

```ts
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { reRenderSummaryHtml } from '../../../lib/html-doc/rerender';
import { writeModelEnvelope } from '../../../lib/html-doc/model-store';
import * as gemini from '../../../lib/gemini';

jest.mock('../../../lib/gemini');

const VIDEO_ID = 'vid12345';
const SUMMARY_MD = `---
video_id: "vid12345"
lang: EN
score: 4
---

# A Title

**Channel:** Chan | **Duration:** 1:00 | **URL:** https://youtu.be/x

> [!summary] Quick Reference
> **TL;DR:** Core idea.

---

## 1. First
First section prose.
---
## Conclusion
Wrap up.
`;

const MODEL = {
  sections: [
    { lead: 'Lead one.', bullets: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }] },
    { lead: 'Lead two.', bullets: [{ label: 'D', text: 'd' }, { label: 'E', text: 'e' }, { label: 'F', text: 'f' }] },
  ],
};

let dir: string;
function writeIndex(videos: unknown[]) {
  fs.writeFileSync(
    path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2),
  );
}
function baseVideo(overrides: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'A Title', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a-title.md', summaryPdf: null, deepDiveMd: null,
    deepDivePdf: null, summaryHtml: 'htmls/a-title.html', processedAt: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = path.join(os.homedir(), `.tmp-rerender-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a-title.md'), SUMMARY_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('reRenderSummaryHtml', () => {
  it('re-renders from the cached model without calling Gemini', () => {
    writeModelEnvelope(dir, 'a-title', { sourceMd: 'a-title.md', generatedAt: 'now', model: MODEL });
    const res = reRenderSummaryHtml(VIDEO_ID, dir);
    expect(res).toEqual({ status: 'rerendered', htmlPath: 'htmls/a-title.html' });
    const html = fs.readFileSync(path.join(dir, 'htmls', 'a-title.html'), 'utf-8');
    expect(html).toContain('Lead one.');
    expect(html).toContain('id="theme-toggle"'); // current renderer applied
    expect(gemini.generateMagazineModel as jest.Mock).not.toHaveBeenCalled();
  });

  it('skips when no model file exists', () => {
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-model' });
    expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  });

  it('skips when the video has no summaryMd', () => {
    writeIndex([baseVideo({ summaryMd: null })]);
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-model' });
  });

  it('skips when the .md is missing on disk', () => {
    writeModelEnvelope(dir, 'a-title', { sourceMd: 'a-title.md', generatedAt: 'now', model: MODEL });
    fs.rmSync(path.join(dir, 'a-title.md'));
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-no-md' });
  });

  it('skips on section-count drift between .md and model', () => {
    const oneSection = { sections: [MODEL.sections[0]] }; // md has 2 sections, model has 1
    writeModelEnvelope(dir, 'a-title', { sourceMd: 'a-title.md', generatedAt: 'now', model: oneSection });
    expect(reRenderSummaryHtml(VIDEO_ID, dir)).toEqual({ status: 'skipped-drift', mdSections: 2, modelSections: 1 });
    expect(fs.existsSync(path.join(dir, 'htmls', 'a-title.html'))).toBe(false);
  });

  it('skips an unknown video id', () => {
    expect(reRenderSummaryHtml('nope99', dir)).toEqual({ status: 'skipped-no-model' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest rerender.test`
Expected: FAIL — `Cannot find module '../../../lib/html-doc/rerender'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/html-doc/rerender.ts`:

```ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { parseSummaryMarkdown } from './parse';
import { renderMagazineHtml } from './render';
import { readModelEnvelope } from './model-store';

export type ReRenderResult =
  | { status: 'rerendered'; htmlPath: string }
  | { status: 'skipped-no-model' }
  | { status: 'skipped-no-md' }
  | { status: 'skipped-drift'; mdSections: number; modelSections: number };

/**
 * Re-render one summary's HTML from its cached model + the current .md — no Gemini.
 * Deterministic: same model + same .md → same HTML under the current renderer.
 */
export function reRenderSummaryHtml(videoId: string, outputFolder: string): ReRenderResult {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video || !video.summaryMd) return { status: 'skipped-no-model' };

  const base = video.summaryMd.replace(/\.md$/, '');
  const envelope = readModelEnvelope(outputFolder, base);
  if (!envelope) return { status: 'skipped-no-model' };

  let md: string;
  try {
    md = fs.readFileSync(path.join(outputFolder, video.summaryMd), 'utf-8');
  } catch {
    return { status: 'skipped-no-md' };
  }

  const parsed = parseSummaryMarkdown(md);
  parsed.sourceMd = video.summaryMd;

  if (parsed.sections.length !== envelope.model.sections.length) {
    return {
      status: 'skipped-drift',
      mdSections: parsed.sections.length,
      modelSections: envelope.model.sections.length,
    };
  }

  const html = renderMagazineHtml(parsed, envelope.model);
  const htmlRel = `htmls/${base}.html`;
  const finalPath = path.join(outputFolder, htmlRel);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  return { status: 'rerendered', htmlPath: htmlRel };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest rerender.test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/rerender.ts tests/lib/html-doc/rerender.test.ts
git commit -m "feat(html-doc): offline re-render of one summary from cached model"
```

---

## Task 4: `reRenderAll` batch + `scripts/rerender-html.ts` CLI

**Files:**
- Modify: `lib/html-doc/rerender.ts`
- Modify: `tests/lib/html-doc/rerender.test.ts`
- Create: `scripts/rerender-html.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/html-doc/rerender.test.ts` (after the existing `describe`):

```ts
import { reRenderAll } from '../../../lib/html-doc/rerender';

describe('reRenderAll', () => {
  it('tallies re-rendered, skipped, and per-video errors across the index', () => {
    // video A: has model → rerendered
    writeModelEnvelope(dir, 'a-title', { sourceMd: 'a-title.md', generatedAt: 'now', model: MODEL });
    // video B: summaryMd set but NO model → skipped-no-model
    fs.writeFileSync(path.join(dir, 'b-title.md'), SUMMARY_MD);
    const vidB = baseVideo({ id: 'vidB', summaryMd: 'b-title.md', summaryHtml: 'htmls/b-title.html' });
    writeIndex([baseVideo(), vidB]);

    const tally = reRenderAll(dir);
    expect(tally.rerendered).toBe(1);
    expect(tally.skippedNoModel).toBe(1);
    expect(tally.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ summaryMd: 'a-title.md', status: 'rerendered' }),
        expect.objectContaining({ summaryMd: 'b-title.md', status: 'skipped-no-model' }),
      ]),
    );
  });

  it('isolates a per-video error and keeps going', () => {
    writeModelEnvelope(dir, 'a-title', { sourceMd: 'a-title.md', generatedAt: 'now', model: MODEL });
    // video B: model present but .md content unparseable (no sections) → parseSummaryMarkdown throws
    fs.writeFileSync(path.join(dir, 'b-title.md'), '# Just a title, no sections\n');
    writeModelEnvelope(dir, 'b-title', { sourceMd: 'b-title.md', generatedAt: 'now', model: MODEL });
    writeIndex([baseVideo(), baseVideo({ id: 'vidB', summaryMd: 'b-title.md' })]);

    const tally = reRenderAll(dir);
    expect(tally.rerendered).toBe(1);   // A still succeeds
    expect(tally.errors).toBe(1);       // B isolated
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest rerender.test -t "reRenderAll"`
Expected: FAIL — `reRenderAll` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/html-doc/rerender.ts`:

```ts
export interface ReRenderDetail {
  summaryMd: string | null;
  status: ReRenderResult['status'] | 'error';
  message?: string;
  mdSections?: number;
  modelSections?: number;
}

export interface ReRenderTally {
  rerendered: number;
  skippedNoModel: number;
  skippedNoMd: number;
  skippedDrift: number;
  errors: number;
  details: ReRenderDetail[];
}

/** Re-render every summary in a playlist. Per-video errors are isolated, never abort the batch. */
export function reRenderAll(outputFolder: string): ReRenderTally {
  assertOutputFolder(outputFolder);
  const index = readIndex(outputFolder);
  const tally: ReRenderTally = {
    rerendered: 0, skippedNoModel: 0, skippedNoMd: 0, skippedDrift: 0, errors: 0, details: [],
  };
  for (const video of index.videos) {
    try {
      const res = reRenderSummaryHtml(video.id, outputFolder);
      switch (res.status) {
        case 'rerendered': tally.rerendered++; break;
        case 'skipped-no-model': tally.skippedNoModel++; break;
        case 'skipped-no-md': tally.skippedNoMd++; break;
        case 'skipped-drift': tally.skippedDrift++; break;
      }
      tally.details.push({
        summaryMd: video.summaryMd,
        status: res.status,
        ...(res.status === 'skipped-drift'
          ? { mdSections: res.mdSections, modelSections: res.modelSections }
          : {}),
      });
    } catch (err) {
      tally.errors++;
      tally.details.push({ summaryMd: video.summaryMd, status: 'error', message: (err as Error).message });
    }
  }
  return tally;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest rerender.test`
Expected: PASS (all 8 — the 6 single + 2 batch).

- [ ] **Step 5: Create the CLI script**

Create `scripts/rerender-html.ts`:

```ts
/**
 * rerender-html.ts
 *
 * Offline restyle of summary HTML from cached magazine models — NO Gemini calls.
 * Run this after changing the renderer (lib/html-doc/render.ts) to refresh every summary
 * whose model has been cached. Summaries with no cached model are reported (regenerate once
 * via the app to enable them); section-drifted summaries are flagged for regeneration.
 *
 * Usage:  npx ts-node scripts/rerender-html.ts <outputFolder> [<outputFolder2> ...]
 */
import { reRenderAll } from '../lib/html-doc/rerender';

function run(outputFolder: string): void {
  const t = reRenderAll(outputFolder);
  const skipped = t.skippedNoModel + t.skippedNoMd + t.skippedDrift;
  console.log(`[${outputFolder}] re-rendered ${t.rerendered}, skipped ${skipped}, errors ${t.errors}`);
  for (const d of t.details) {
    if (d.status === 'rerendered') continue;
    if (d.status === 'skipped-no-model' && !d.summaryMd) continue; // no summary at all → silent
    if (d.status === 'skipped-drift') {
      console.log(`  skipped-drift:    ${d.summaryMd} (md ${d.mdSections} ≠ model ${d.modelSections} — regenerate)`);
    } else if (d.status === 'skipped-no-model') {
      console.log(`  skipped-no-model: ${d.summaryMd} (regenerate once to enable)`);
    } else if (d.status === 'error') {
      console.log(`  error:            ${d.summaryMd} (${d.message})`);
    }
  }
}

const folders = process.argv.slice(2);
if (folders.length === 0) {
  console.error('Usage: npx ts-node scripts/rerender-html.ts <outputFolder> [<outputFolder2> ...]');
  process.exit(1);
}
for (const folder of folders) run(folder);
```

- [ ] **Step 6: Smoke-check the script compiles and shows usage**

Run: `npx ts-node scripts/rerender-html.ts`
Expected: prints the `Usage: …` line and exits non-zero (no folder arg).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all green, no regressions.

- [ ] **Step 8: Commit**

```bash
git add lib/html-doc/rerender.ts tests/lib/html-doc/rerender.test.ts scripts/rerender-html.ts
git commit -m "feat(html-doc): batch reRenderAll + rerender-html CLI"
```

---

## Review Gates (per docs/dev-process.md)

After each task: Claude code review (`superpowers:requesting-code-review`) → `docs/reviews/task-N-persist-model-<name>-review.md`; Codex adversarial (`codex:rescue --fresh`) → `docs/reviews/task-N-persist-model-<name>-codex.md`; address High/P1 before marking done. (Codex is usage-limited until 2026-07-03 — if still limited, use the Claude-fallback adversarial review per docs/plugins.md and flag the owed Codex pass.)

Phase 4 verification (real app): regenerate one summary via `POST /api/videos/[id]/html-doc`, confirm `models/<base>.json` appears with the envelope; then run `npx ts-node scripts/rerender-html.ts <outputFolder>` and confirm the summary's `htmls/<base>.html` is rewritten (timestamp changes, content matches the current renderer) with **no Gemini call** and the tally reports the others as `skipped-no-model`.

---

## Self-Review

**Spec coverage:** §4.1 model write → Task 2 ✓. §4.2 reRenderSummaryHtml + all skip/guard paths → Task 3 ✓. §4.3 CLI + tally → Task 4 ✓. §5 Output File Format (envelope, convention path, schema validation on read) → Task 1 (`model-store.ts` + schema) ✓. §6 error handling table → behaviors 4–7,13–18,20 across Tasks 1/3/4 ✓. §7 onboarding existing summaries → documented; re-render reports `skipped-no-model` (behavior 13) ✓. §8 testing layers → Tasks 1–4 tests ✓. §2 non-goals (no versioning, no 3b route, CLI-only) → nothing in the plan adds them ✓.

**Placeholder scan:** none — every code step is complete; every run step has a command + expected result.

**Type consistency:** `ModelEnvelope` defined in Task 1, imported in Tasks 2–3. `writeModelEnvelope`/`readModelEnvelope` named identically throughout. `reRenderSummaryHtml` returns `ReRenderResult` (Task 3), consumed by `reRenderAll`→`ReRenderTally`/`ReRenderDetail` (Task 4). `model` field is a `MagazineModel` (from `types.ts`) everywhere. `base = summaryMd.replace(/\.md$/,'')` identical in generate.ts, model-store path, and rerender.ts.
