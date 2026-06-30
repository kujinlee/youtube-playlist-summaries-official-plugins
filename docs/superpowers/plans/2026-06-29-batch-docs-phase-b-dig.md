# Batch docs — Phase B (Summary + Dig-deeper mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Add a `Summary + Dig-deeper` mode to the batch action: for each selected video, generate its summary HTML (if needed) AND dig every missing/stale section — additive on the merged Phase A.

**Architecture:** Extract the per-section dig pipeline (`runDigPipeline`, currently inside the dig route) into a reusable `lib/dig/dig-section.ts#digSection`; the route calls it (no behavior change) and `runBatchDocs` loops it. `runBatchDocs` becomes work-item based (summary items + dig items) with an async pre-pass that enumerates missing/stale sections (no Gemini). The UI adds a mode toggle + a cost-confirm dialog.

**Tech Stack:** TypeScript, Next.js route handlers, React client components, jest + ts-jest (SWC; `tsc --noEmit` is the type gate), @testing-library/react, Playwright.

## Global Constraints

- **`digSection(videoId, sectionId, outputFolder, signal, emit)`** in `lib/dig/dig-section.ts` is the EXACT body of the current `runDigPipeline` (`app/api/videos/[id]/dig/[sectionId]/route.ts:82-177`). The route imports and calls it — **no behavior change**; the existing dig route tests MUST stay green.
- **Dig eligibility (missing/stale):** a video's dig-eligible sections = `parseSummaryMarkdown(md).sections.filter(s => s.timeRange)`, each `sectionId = s.timeRange.startSec`. A section needs dig if it is absent from the companion doc OR its `genVersion < DIG_GENERATOR_VERSION`. Read the companion doc via `parseDugSections(fileContent)` (returns `DugSection[]` with `genVersion`); missing file → `[]`.
- **Backend-authoritative skip:** the pre-pass is the source of truth; over-selection is harmless.
- **Best-effort:** dig failure → non-fatal `{type:'error', videoId}` (carries `videoId` so it stays non-fatal in the stream), continue.
- **Progress isolation:** pass a no-op `() => {}` to `digSection`/`ensureHtmlDoc` so their sub-steps don't reach the batch stream.
- **Cost guard:** mode `summary-dig` shows a confirm dialog (≈$0.05 + ≈30 s per section) before launching; mode `summary` launches immediately.
- **Phase A unchanged:** mode `summary` keeps producing summary-only work. No `ProgressEvent` schema change, no version bump.

---

## File Structure

| File | New/Mod | Responsibility |
|---|---|---|
| `lib/dig/dig-section.ts` | new | `digSection(...)` — extracted dig pipeline |
| `app/api/videos/[id]/dig/[sectionId]/route.ts` | mod | call `digSection` instead of the inline `runDigPipeline` |
| `lib/html-doc/batch.ts` | mod | work-item model + dig pre-pass + dig loop branch (mode `summary-dig`) |
| `app/api/videos/batch-docs/route.ts` | mod | remove the `mode!=='summary'` 400 (accept `summary-dig`) |
| `components/BulkActionBar.tsx` | mod | mode toggle (radio) + cost-confirm on Generate when `summary-dig` |
| `components/BatchDocStatusBar.tsx` | mod | handle `start` to seed `total` (Phase-A Low) |
| `app/page.tsx` | mod | `batchMode` state; pass `mode` to POST + to `BulkActionBar` |

---

## Task B1: Extract `digSection` to `lib/dig/dig-section.ts`; route calls it

**Files:**
- Create: `lib/dig/dig-section.ts`
- Modify: `app/api/videos/[id]/dig/[sectionId]/route.ts`
- Test: existing dig route tests (must stay green) + a new direct unit test `tests/lib/dig/dig-section.test.ts`

**Interfaces:**
- Produces: `digSection(videoId: string, sectionId: number, outputFolder: string, signal: AbortSignal | undefined, emit: (e: ProgressEvent) => void): Promise<void>`.

- [ ] **Step 1: Write a direct unit test for `digSection`** (mock the heavy deps)

Create `tests/lib/dig/dig-section.test.ts`:

```typescript
jest.mock('../../../lib/index-store');
jest.mock('../../../lib/html-doc/parse');
jest.mock('../../../lib/transcript-source');
jest.mock('../../../lib/dig/section-window');
jest.mock('../../../lib/dig/generate');
jest.mock('../../../lib/transcript-timestamps');
jest.mock('../../../lib/dig/slides');
jest.mock('../../../lib/dig/companion-doc');
jest.mock('node:fs/promises');

import * as indexStore from '../../../lib/index-store';
import * as parseMod from '../../../lib/html-doc/parse';
import * as tsource from '../../../lib/transcript-source';
import * as win from '../../../lib/dig/section-window';
import * as gen from '../../../lib/dig/generate';
import * as tts from '../../../lib/transcript-timestamps';
import * as slides from '../../../lib/dig/slides';
import * as companion from '../../../lib/dig/companion-doc';
import fs from 'node:fs/promises';
import { digSection } from '../../../lib/dig/dig-section';
import type { ProgressEvent } from '../../../types';

const OF = '/out';
const video = { id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/v', durationSeconds: 600, language: 'en', summaryMd: 'v.md' };

beforeEach(() => {
  jest.mocked(indexStore.readIndex).mockReturnValue({ playlistUrl: '', outputFolder: OF, videos: [video] } as any);
  jest.mocked(indexStore.updateVideoFields).mockImplementation(() => {});
  jest.mocked(fs.readFile).mockResolvedValue('md' as any);
  jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [{ title: 'S', timeRange: { startSec: 60 } }] } as any);
  jest.mocked(tsource.resolveTranscriptSegments).mockResolvedValue({ segments: [] } as any);
  jest.mocked(win.windowForSection).mockReturnValue({ startSec: 60, endSec: 120 } as any);
  jest.mocked(gen.generateDig).mockResolvedValue('raw' as any);
  jest.mocked(tts.resolveTranscriptTokens).mockReturnValue('withts' as any);
  jest.mocked(slides.resolveSlideTokens).mockResolvedValue({ markdown: 'final', slides: [] } as any);
  jest.mocked(companion.upsertDugSection).mockResolvedValue(undefined as any);
  (gen as any).DIG_GENERATOR_VERSION = 9;
});
afterEach(() => jest.clearAllMocks());

it('digs a section end to end and emits done', async () => {
  const events: ProgressEvent[] = [];
  await digSection('v', 60, OF, undefined, (e) => events.push(e));
  expect(jest.mocked(companion.upsertDugSection)).toHaveBeenCalled();
  expect(jest.mocked(indexStore.updateVideoFields)).toHaveBeenCalledWith(OF, 'v', { digDeeperMd: 'v-dig-deeper.md' });
  expect(events[events.length - 1]).toEqual({ type: 'done' });
});

it('emits error (not throw) when the section is not found', async () => {
  jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [] } as any);
  const events: ProgressEvent[] = [];
  await digSection('v', 60, OF, undefined, (e) => events.push(e));
  expect(events.some((e) => e.type === 'error')).toBe(true);
  expect(jest.mocked(companion.upsertDugSection)).not.toHaveBeenCalled();
});

it('skips the write when aborted before write', async () => {
  const controller = new AbortController(); controller.abort();
  const events: ProgressEvent[] = [];
  await digSection('v', 60, OF, controller.signal, (e) => events.push(e));
  expect(jest.mocked(companion.upsertDugSection)).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — verify fail** → `npx jest dig-section.test` FAIL (module not found).

- [ ] **Step 3: Create `lib/dig/dig-section.ts`** — move the EXACT current `runDigPipeline` body (route.ts:82-177), exported as `digSection`, with its imports. Use `@/lib/...` import aliases (the route already uses them):

```typescript
import path from 'path';
import fs from 'node:fs/promises';
import { readIndex, updateVideoFields } from '@/lib/index-store';
import { parseSummaryMarkdown } from '@/lib/html-doc/parse';
import { resolveTranscriptSegments } from '@/lib/transcript-source';
import { windowForSection } from '@/lib/dig/section-window';
import { generateDig, DIG_GENERATOR_VERSION } from '@/lib/dig/generate';
import { resolveTranscriptTokens } from '@/lib/transcript-timestamps';
import { resolveSlideTokens } from '@/lib/dig/slides';
import { upsertDugSection } from '@/lib/dig/companion-doc';
import type { ProgressEvent } from '@/types';

export async function digSection(
  videoId: string,
  sectionIdInt: number,
  outputFolder: string,
  signal: AbortSignal | undefined,
  emit: (event: ProgressEvent) => void,
): Promise<void> {
  // ... EXACT body of runDigPipeline from route.ts:89-176 (Steps 1-11), unchanged ...
}
```
(Copy lines 89-176 of the current route verbatim into the body.)

- [ ] **Step 4: Refactor the route to call `digSection`**

In `app/api/videos/[id]/dig/[sectionId]/route.ts`: delete the local `runDigPipeline` function (lines 82-177); add `import { digSection } from '@/lib/dig/dig-section';`; change the call site `runDigPipeline(videoId, sectionIdInt, outputFolder, signal, …)` → `digSection(videoId, sectionIdInt, outputFolder, signal, …)`. Remove now-unused imports from the route (path, fs, parseSummaryMarkdown, resolveTranscriptSegments, windowForSection, generateDig, DIG_GENERATOR_VERSION, resolveTranscriptTokens, resolveSlideTokens, upsertDugSection, readIndex, updateVideoFields) — keep only what the POST handler still uses (crypto, NextResponse, assertOutputFolder, assertVideoId, job-registry fns, logError/errorSummary, ProgressEvent).

- [ ] **Step 5: Run — verify pass + no regressions**

Run: `npx jest dig-section.test` → PASS (3).
Run: `npx jest dig` → existing dig route + companion tests still green.
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**
```bash
git add lib/dig/dig-section.ts app/api/videos/[id]/dig/[sectionId]/route.ts tests/lib/dig/dig-section.test.ts
git commit -m "refactor(dig): extract runDigPipeline → lib/dig/dig-section.ts (digSection)"
```

---

## Task B2: `runBatchDocs` dig branch + accept `summary-dig`

**Files:**
- Modify: `lib/html-doc/batch.ts`, `app/api/videos/batch-docs/route.ts`
- Test: `tests/lib/html-doc/batch.test.ts` (add dig cases)

**Interfaces:**
- Consumes: `digSection` (B1); `parseSummaryMarkdown` (`lib/html-doc/parse`); `parseDugSections` + `DIG_GENERATOR_VERSION` (`lib/dig/companion-doc` / `lib/dig/generate`); `node:fs/promises`.
- Produces: `runBatchDocs` mode `summary-dig` emits, per video: a summary `step` (if needed) then one `step` per missing/stale section (`step: 'Digging "<title>"…'`), with a flat 1..total counter over ALL work items.

- [ ] **Step 1: Write the dig tests** (add to `tests/lib/html-doc/batch.test.ts`)

Add mocks at top: `jest.mock('../../../lib/dig/dig-section'); jest.mock('../../../lib/html-doc/parse'); jest.mock('../../../lib/dig/companion-doc');` and (if not present) `jest.mock('node:fs/promises');`. Import them + `import { DIG_GENERATOR_VERSION } from '../../../lib/dig/generate';` (real). Add:

```typescript
import * as digMod from '../../../lib/dig/dig-section';
import * as parseMod from '../../../lib/html-doc/parse';
import * as companion from '../../../lib/dig/companion-doc';
import fs from 'node:fs/promises';
const mockDig = jest.mocked(digMod.digSection);

function digReady() {
  mockDig.mockResolvedValue(undefined);
  jest.mocked(fs.readFile).mockResolvedValue('md' as any);
  jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({
    sections: [
      { title: 'A', timeRange: { startSec: 10 } },
      { title: 'B', timeRange: { startSec: 20 } },
    ],
  } as any);
  jest.mocked(companion.parseDugSections).mockReturnValue([]); // nothing dug yet
}

describe('runBatchDocs (mode summary-dig)', () => {
  beforeEach(digReady);

  it('LB3: per video, summary (if needed) then each missing section dug, flat counter', async () => {
    indexWith([v('x', { summaryHtml: null, summaryMd: 'x.md', digDeeperMd: null })]);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    // total = 1 summary + 2 sections = 3
    expect(events[0]).toMatchObject({ type: 'start', total: 3 });
    expect(mockDig.mock.calls.map((c) => c[1])).toEqual([10, 20]); // both sections dug
    expect(events.filter((e) => e.type === 'step').map((e: any) => e.step)).toEqual([
      'Generating HTML doc…', 'Digging "A"…', 'Digging "B"…',
    ]);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 3, failed: 0 });
  });

  it('LB2: skips sections already dug at the current version', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md', digDeeperMd: 'x-dig-deeper.md' })]);
    jest.mocked(companion.parseDugSections).mockReturnValue([
      { sectionId: 10, startSec: 10, title: 'A', bodyMarkdown: '', generatedAt: '', genVersion: DIG_GENERATOR_VERSION }, // current → skip
    ] as any);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'start', total: 1 }); // summary current (skipped); only section 20 needs dig
    expect(mockDig.mock.calls.map((c) => c[1])).toEqual([20]);
  });

  it('LB4: dig best-effort — one section fails, rest continue', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md', digDeeperMd: null })]);
    mockDig.mockRejectedValueOnce(new Error('yt-dlp boom'));
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events.some((e) => e.type === 'error' && 'videoId' in e && e.videoId === 'x')).toBe(true);
    expect(mockDig).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toMatchObject({ type: 'done', succeeded: 1, failed: 1 });
  });

  it('LB5: a video with no timestamped sections contributes 0 dig items', async () => {
    indexWith([v('x', { summaryHtml: 'x.html', docVersion: { major: 3, minor: 3 }, summaryMd: 'x.md' })]);
    jest.mocked(parseMod.parseSummaryMarkdown).mockReturnValue({ sections: [{ title: 'A', timeRange: null }] } as any);
    const events: ProgressEvent[] = [];
    await runBatchDocs(['x'], 'summary-dig', OF, (e) => events.push(e));
    expect(events[0]).toMatchObject({ type: 'start', total: 0 });
    expect(mockDig).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify fail** → `npx jest batch.test -t "summary-dig"` FAIL.

- [ ] **Step 3: Rewrite `lib/html-doc/batch.ts` with the work-item model**

```typescript
import path from 'path';
import fs from 'node:fs/promises';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { ensureHtmlDoc } from './ensure';
import { summaryNeedsWork } from './eligibility';
import { parseSummaryMarkdown } from './parse';
import { parseDugSections } from '../dig/companion-doc';
import { digSection } from '../dig/dig-section';
import { DIG_GENERATOR_VERSION } from '../dig/generate';
import type { ProgressEvent, Video } from '../../types';

export type BatchMode = 'summary' | 'summary-dig';

type WorkItem =
  | { kind: 'summary'; videoId: string; title?: string }
  | { kind: 'dig'; videoId: string; title?: string; sectionId: number; sectionTitle: string };

/** Dig-eligible sections (have a timeRange) that are missing or stale in the companion doc. */
async function missingDigSections(video: Video, outputFolder: string): Promise<{ sectionId: number; title: string }[]> {
  if (!video.summaryMd) return [];
  let md: string;
  try { md = await fs.readFile(path.join(outputFolder, video.summaryMd), 'utf8'); } catch { return []; }
  const eligible = parseSummaryMarkdown(md).sections
    .filter((s) => s.timeRange)
    .map((s) => ({ sectionId: s.timeRange!.startSec, title: s.title }));
  if (eligible.length === 0) return [];
  const base = path.basename(video.summaryMd, '.md');
  let dug: { sectionId: number; genVersion: number }[] = [];
  try {
    const content = await fs.readFile(path.join(outputFolder, `${base}-dig-deeper.md`), 'utf8');
    dug = parseDugSections(content).map((s) => ({ sectionId: s.sectionId, genVersion: s.genVersion }));
  } catch { /* no companion yet → all eligible are missing */ }
  const versionById = new Map(dug.map((s) => [s.sectionId, s.genVersion]));
  return eligible.filter((s) => {
    const gv = versionById.get(s.sectionId);
    return gv === undefined || gv < DIG_GENERATOR_VERSION;
  });
}

export async function runBatchDocs(
  videoIds: string[],
  mode: BatchMode,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  assertOutputFolder(outputFolder);
  const index = readIndex(outputFolder);
  const byId = new Map(index.videos.map((v) => [v.id, v]));

  // PRE-PASS (no Gemini): build a flat work list, skipping current items.
  const work: WorkItem[] = [];
  for (const id of videoIds) {
    const v = byId.get(id);
    if (!v) continue;
    if (summaryNeedsWork(v)) work.push({ kind: 'summary', videoId: id, title: v.title });
    if (mode === 'summary-dig') {
      for (const s of await missingDigSections(v, outputFolder)) {
        work.push({ kind: 'dig', videoId: id, title: v.title, sectionId: s.sectionId, sectionTitle: s.title });
      }
    }
  }

  onProgress({ type: 'start', total: work.length });

  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < work.length; i++) {
    if (signal?.aborted) { onProgress({ type: 'cancelled' }); return; }
    const item = work[i];
    assertVideoId(item.videoId);
    const stepText = item.kind === 'summary' ? 'Generating HTML doc…' : `Digging "${item.sectionTitle}"…`;
    onProgress({ type: 'step', videoId: item.videoId, title: item.title, step: stepText, current: i + 1, total: work.length });
    try {
      if (item.kind === 'summary') {
        await ensureHtmlDoc(item.videoId, outputFolder, () => {});
      } else {
        await digSection(item.videoId, item.sectionId, outputFolder, signal, () => {});
      }
      succeeded++;
    } catch (err) {
      failed++;
      // eslint-disable-next-line no-console
      console.warn(`[batch-docs] ${item.videoId} (${item.kind}) failed: ${err instanceof Error ? err.message : String(err)}`);
      onProgress({ type: 'error', videoId: item.videoId, title: item.title, log: err instanceof Error ? err.message : String(err) });
    }
  }

  onProgress({ type: 'done', succeeded, failed, total: work.length });
}
```

- [ ] **Step 4: Accept `summary-dig` in the route** — in `app/api/videos/batch-docs/route.ts`, DELETE the block that returns 400 for `mode !== 'summary'` (the `if (mode !== 'summary') return … 400`). Keep `mode` validated as one of the two literals: replace with `if (mode !== 'summary' && mode !== 'summary-dig') return NextResponse.json({ error: 'invalid mode' }, { status: 400 });`.

- [ ] **Step 5: Run — verify pass + no regression**

Run: `npx jest batch.test` → PASS (Phase A LA* still green + new LB*).
Run: `npx jest batch-docs.test` → the Phase A route test that asserted 409/jobId still green; if a test asserted `summary-dig` → 400, UPDATE it to expect 200 (it now starts a job). Search: `grep -n "summary-dig" tests/api/batch-docs.test.ts`.
Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**
```bash
git add lib/html-doc/batch.ts app/api/videos/batch-docs/route.ts tests/lib/html-doc/batch.test.ts tests/api/batch-docs.test.ts
git commit -m "feat(batch-docs): summary-dig mode — dig missing/stale sections in runBatchDocs"
```

---

## Task B3: `BulkActionBar` mode toggle + cost-confirm

**Files:**
- Modify: `components/BulkActionBar.tsx`
- Test: `tests/components/BulkActionBar.test.tsx`

**Interfaces:**
- Produces: `BulkActionBar` gains props `mode: BatchMode`, `onModeChange: (m: BatchMode) => void`. Generate in `summary-dig` mode calls `window.confirm(...)` and only fires `onGenerate` if confirmed.

- [ ] **Step 1: Add tests** to `tests/components/BulkActionBar.test.tsx`:

```typescript
it('renders a mode toggle and calls onModeChange', () => {
  const onModeChange = jest.fn();
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} mode="summary" onModeChange={onModeChange} />);
  fireEvent.click(screen.getByLabelText(/Summary \+ Dig-deeper/));
  expect(onModeChange).toHaveBeenCalledWith('summary-dig');
});

it('summary-dig Generate asks for confirmation; only fires onGenerate when confirmed', () => {
  const onGenerate = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} mode="summary-dig" onModeChange={() => {}} onGenerate={onGenerate} />);
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
  expect(confirmSpy).toHaveBeenCalled();
  expect(onGenerate).not.toHaveBeenCalled();
  confirmSpy.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
  expect(onGenerate).toHaveBeenCalled();
  confirmSpy.mockRestore();
});

it('summary mode Generate does not confirm', () => {
  const onGenerate = jest.fn();
  const confirmSpy = jest.spyOn(window, 'confirm');
  render(<BulkActionBar {...base} selectedCount={2} willGenerateCount={2} mode="summary" onModeChange={() => {}} onGenerate={onGenerate} />);
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(onGenerate).toHaveBeenCalled();
  confirmSpy.mockRestore();
});
```

Update the shared `base` object in this test file to include `mode: 'summary' as const, onModeChange: () => {}`. Import `BatchMode`: `import type { BatchMode } from '@/lib/html-doc/batch';`.

- [ ] **Step 2: Run — verify fail** → `npx jest BulkActionBar` FAIL.

- [ ] **Step 3: Implement** — update `components/BulkActionBar.tsx`:

```tsx
'use client';
import type { BatchMode } from '@/lib/html-doc/batch';

interface BulkActionBarProps {
  selectedCount: number;
  willGenerateCount: number;
  skipCount: number;
  mode: BatchMode;
  onModeChange: (m: BatchMode) => void;
  onGenerate: () => void;
  onClear: () => void;
}

const DIG_CONFIRM =
  'Summary + Dig-deeper digs every missing/stale section of the selected videos. ' +
  'Each section runs a Gemini call plus a short video download (~$0.05 and ~30s each), ' +
  'so a large batch can take several minutes and cost a few dollars. Continue?';

export default function BulkActionBar({ selectedCount, willGenerateCount, skipCount, mode, onModeChange, onGenerate, onClear }: BulkActionBarProps) {
  if (selectedCount === 0) return null;
  const handleGenerate = () => {
    if (mode === 'summary-dig' && !window.confirm(DIG_CONFIRM)) return;
    onGenerate();
  };
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2 mb-2 rounded bg-zinc-900 border border-zinc-800 text-sm">
      <fieldset className="flex items-center gap-3" aria-label="Doc mode">
        <label className="flex items-center gap-1">
          <input type="radio" name="batch-mode" checked={mode === 'summary'} onChange={() => onModeChange('summary')} />
          Summary HTML
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="batch-mode" checked={mode === 'summary-dig'} onChange={() => onModeChange('summary-dig')} />
          Summary + Dig-deeper
        </label>
      </fieldset>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={willGenerateCount === 0}
        className="px-3 py-1 rounded bg-amber-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Generate {mode === 'summary-dig' ? 'docs' : 'HTML doc'} — {willGenerateCount} videos
      </button>
      <button type="button" onClick={onClear} className="px-2 py-1 rounded text-zinc-300 hover:text-white">Clear</button>
      {skipCount > 0 && <span className="text-zinc-500">({skipCount} summaries already current)</span>}
    </div>
  );
}
```

> Note: the existing Phase A test `/Generate HTML doc — 3 videos/` still matches in `summary` mode (button reads "Generate HTML doc — N videos"). In `summary-dig` the label is "Generate docs — N videos"; the new tests use `/Generate/` so both match.

- [ ] **Step 4: Run — verify pass + commit**

Run: `npx jest BulkActionBar` → PASS. `npx tsc --noEmit` → 0.
```bash
git add components/BulkActionBar.tsx tests/components/BulkActionBar.test.tsx
git commit -m "feat(batch-docs): BulkActionBar mode toggle + dig cost-confirm"
```

---

## Task B4: page mode wiring + `start`-event seed + E2E

**Files:**
- Modify: `app/page.tsx`, `components/BatchDocStatusBar.tsx`
- Test: `tests/e2e/batch-docs.spec.ts` (add a summary-dig case)

**Interfaces:**
- Consumes: `BatchMode` (`@/lib/html-doc/batch`); `BulkActionBar` (B3).

- [ ] **Step 1: Add the E2E summary-dig case** to `tests/e2e/batch-docs.spec.ts`:

```typescript
test('summary-dig mode posts mode:summary-dig after confirm', async ({ page }) => {
  await page.route('**/api/settings', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputFolder: OUTPUT_FOLDER }) }));
  await page.route('**/api/videos**', (route) => {
    if (route.request().method() !== 'GET' || route.request().url().includes('/api/videos/')) return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [v('a')] }) });
  });
  let postedBody: any = null;
  await page.route('**/api/videos/batch-docs', (route) => {
    if (route.request().url().includes('/stream') || route.request().url().includes('/cancel')) return route.continue();
    postedBody = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'jd1' }) });
  });
  await page.route('**/api/videos/batch-docs/stream**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ type: 'done', succeeded: 1, failed: 0 })}\n\n` }));

  page.on('dialog', (d) => d.accept()); // accept the cost-confirm
  await page.goto('/');
  await page.getByLabel('Select all needing generation').check();
  await page.getByLabel(/Summary \+ Dig-deeper/).check();
  await page.getByRole('button', { name: /Generate/ }).click();
  await expect(page.getByText(/generated/)).toBeVisible();
  expect(postedBody).toMatchObject({ mode: 'summary-dig', videoIds: ['a'] });
});
```

- [ ] **Step 2: Run — verify fail** → `npx playwright test batch-docs` FAIL (no mode toggle wired).

- [ ] **Step 3: Wire mode into `app/page.tsx`**

(a) Import the type: `import type { BatchMode } from '@/lib/html-doc/batch';` (alongside the existing `ProgressEvent` import).
(b) State (near `selected`): `const [batchMode, setBatchMode] = useState<BatchMode>('summary');`.
(c) In `handleBatchGenerate`, change the POST body mode to the state: `body: JSON.stringify({ outputFolder, videoIds: ids, mode: batchMode })`. Add `batchMode` to its `useCallback` deps.
(d) Pass to `BulkActionBar`: add `mode={batchMode}` and `onModeChange={setBatchMode}`.

- [ ] **Step 4: Seed `total` from `start` in `BatchDocStatusBar`** (Phase-A Low)

In `components/BatchDocStatusBar.tsx`'s `onmessage`, add a branch BEFORE the `step` branch:
```typescript
      if (data.type === 'start') {
        setState({ status: 'running', current: 0, total: data.total ?? 0, failed: failedRef.current, step: '' });
      } else if (data.type === 'step') {
```
(So the bar shows the right denominator immediately.)

- [ ] **Step 5: Run — verify pass + full suite**

Run: `npx playwright test batch-docs` → PASS (both cases).
Run: `npx tsc --noEmit` → 0.
Run: `npm test` → jest green (pdf flake: re-run `npx jest pdf` isolated if it fails under load).
Run: `npx playwright test` → E2E green (the 5 known pre-existing failures excepted).

- [ ] **Step 6: Commit**
```bash
git add app/page.tsx components/BatchDocStatusBar.tsx tests/e2e/batch-docs.spec.ts
git commit -m "feat(batch-docs): wire summary-dig mode into the page + seed total from start event"
```

---

## Self-Review

**Spec coverage (Phase B rows):** LB1 (digSection extraction, route green) → B1; LB2 (skip dug-current) + LB3 (summary-dig order/counter) + LB4 (dig best-effort) + LB5 (no-timestamp video) → B2; CB1 (mode toggle recompute) → B3+B4; CB2 (cost-confirm shown for dig, not summary) → B3; CB3 (E2E summary-dig posts mode) → B4. Cost guard, two-level→flat progress, backend-authoritative dig skip → B2/B3. Phase-A Low (start-event) folded into B4.

**Placeholder scan:** B1 Step 3 says "copy lines 89-176 verbatim" — that is a precise instruction, not a placeholder; the implementer has the source file. All other code blocks are complete.

**Type consistency:** `digSection(videoId, sectionId, outputFolder, signal, emit)` identical in B1/B2. `BatchMode` from `lib/html-doc/batch` used in B2/B3/B4. `WorkItem` internal to batch.ts. `BulkActionBar` new props (`mode`, `onModeChange`) defined B3, supplied by page B4. `parseDugSections`/`DIG_GENERATOR_VERSION`/`parseSummaryMarkdown` signatures match the real modules (verified in the merged code).
