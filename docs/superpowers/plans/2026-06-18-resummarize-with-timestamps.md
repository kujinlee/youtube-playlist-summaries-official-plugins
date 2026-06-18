# Versioned HTML-Doc Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One unified "HTML doc" action that brings a video's doc to the current `major.minor` version — re-summarizing (to gain `▶` timestamps) or re-rendering (style-only) as needed — so existing summaries get onboarded to timestamps on demand.

**Architecture:** A shared `DocVersion` (`{major,minor}`, current `{2,0}`) stored per video. `writeSummaryDoc` is extracted from `runIngestion` (single source of truth, no PDF). `ensureHtmlDoc` reads the stored version and does the minimum: major-stale → re-summarize + full HTML rebuild; minor-stale/no-HTML → re-render from cached model (or full build); current → nothing. The existing SSE `html-doc` route drives it; the menu collapses to one version-aware item with a per-row hourglass while busy.

**Tech Stack:** Next.js/TypeScript, Zod, Jest + ts-jest (SWC transform → `tsc --noEmit` is the real typecheck), @testing-library/react, Playwright. Gemini/YouTube mocked at the lib boundary.

**Scope:** Phase 1 (per-video). Bulk sweep is Phase 2 (deferred).

---

### Task 1: `DocVersion` core + index field

**Files:**
- Create: `lib/doc-version.ts`
- Modify: `types/index.ts` (add `DocVersionSchema`; add `docVersion` to `VideoSchema:41-69`)
- Test: `tests/lib/doc-version.test.ts`

- [ ] **Step 1: Write the failing test** — create `tests/lib/doc-version.test.ts`:

```ts
import { CURRENT_DOC_VERSION, isOlder, needsResummarize } from '../../lib/doc-version';

describe('doc-version', () => {
  it('CURRENT_DOC_VERSION is 2.0 (timestamps = first major bump)', () => {
    expect(CURRENT_DOC_VERSION).toEqual({ major: 2, minor: 0 });
  });
  it('isOlder compares major then minor', () => {
    expect(isOlder({ major: 1, minor: 0 }, { major: 2, minor: 0 })).toBe(true);   // pre-feature
    expect(isOlder({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(true);   // style bump
    expect(isOlder({ major: 2, minor: 0 }, { major: 2, minor: 0 })).toBe(false);  // current
    expect(isOlder({ major: 3, minor: 0 }, { major: 2, minor: 9 })).toBe(false);  // newer
  });
  it('needsResummarize is true only when the major advanced', () => {
    expect(needsResummarize({ major: 1, minor: 0 }, { major: 2, minor: 0 })).toBe(true);
    expect(needsResummarize({ major: 2, minor: 0 }, { major: 2, minor: 5 })).toBe(false); // minor only
    expect(needsResummarize({ major: 2, minor: 0 }, { major: 2, minor: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npx jest doc-version` → "Cannot find module '../../lib/doc-version'".

- [ ] **Step 3: Implement** — create `lib/doc-version.ts`:

```ts
/** Document output version. MAJOR = summary/.md format (bump ⇒ re-summarize). MINOR = HTML render/style (bump ⇒ re-render). */
export interface DocVersion {
  major: number;
  minor: number;
}

/** The version current code produces. major 2 = ▶ timestamps (the first major bump). Bump minor for style/template-only changes. */
export const CURRENT_DOC_VERSION: DocVersion = { major: 2, minor: 0 };

/** True when `a` is an older doc version than `b` (major dominates, then minor). */
export function isOlder(a: DocVersion, b: DocVersion): boolean {
  return a.major < b.major || (a.major === b.major && a.minor < b.minor);
}

/** True when reaching `current` from `stored` requires regenerating the .md (a summary-format / major advance). */
export function needsResummarize(stored: DocVersion, current: DocVersion): boolean {
  return stored.major < current.major;
}
```

- [ ] **Step 4: Add the schema + index field** in `types/index.ts`. Immediately before `export const VideoSchema` (line 41) add:

```ts
export const DocVersionSchema = z.object({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
});
```

Inside `VideoSchema`, after the `corrections` line (line 68), add:

```ts
  docVersion: DocVersionSchema.optional(), // absent ⇒ pre-feature {1,0}; stamped to CURRENT_DOC_VERSION on (re)generation
```

- [ ] **Step 5: Run — expect PASS** `npx jest doc-version` → green. Then `npx tsc --noEmit` → only the 2 pre-existing `theme.test.ts` errors (the structural `{major,minor}` of `DocVersion` and `z.infer<DocVersionSchema>` match).

- [ ] **Step 6: Commit**

```bash
git add lib/doc-version.ts types/index.ts tests/lib/doc-version.test.ts
git commit -m "feat(docversion): DocVersion core + Video.docVersion field"
```

---

### Task 2: Extract `writeSummaryDoc` (no PDF) from `runIngestion`

**Files:**
- Modify: `lib/pipeline.ts` (extract function; rewire loop at `244-334`; stamp `docVersion`)
- Test: `tests/lib/pipeline.test.ts` (writeSummaryDoc unit + ingestion regression)

The per-video summary work moves into a reusable function. **Ingestion output stays byte-identical**; only the code location moves, plus it now stamps `docVersion` on the new `Video`.

- [ ] **Step 1: Write the failing test** — append to `tests/lib/pipeline.test.ts` (it already `jest.mock`s `../../lib/youtube`, `../../lib/gemini`, `../../lib/pdf`):

```ts
import { writeSummaryDoc } from '../../lib/pipeline';
import * as fsReal from 'fs';

describe('writeSummaryDoc', () => {
  it('writes <baseName>.md with the generated summary and returns AI fields; writes NO pdf', async () => {
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 'hello world', offset: 0, duration: 5 }]);
    mockDetectLanguage.mockReturnValue('en');
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ summary: '## 1. A\n▶ [0:00–0:05](u)\nbody' }));

    const result = await writeSummaryDoc({
      videoId: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x',
      channel: 'Chan', durationSeconds: 5, outputFolder, baseName: 'my-base',
    });

    expect(result.summaryMd).toBe('my-base.md');
    expect(result.language).toBe('en');
    expect(result.ratings).toBeDefined();
    const md = fsReal.readFileSync(`${outputFolder}/my-base.md`, 'utf-8');
    expect(md).toContain('# T');
    expect(md).toContain('## 1. A');
    expect(md).toContain('▶ [0:00–0:05]');
    expect(mockGeneratePdf).not.toHaveBeenCalled(); // PDF is the caller's job now
    expect(mockGenerateSummary).toHaveBeenCalledWith(
      [{ text: 'hello world', offset: 0, duration: 5 }], 'en', 'vid11111111',
    );
  });
});
```

(If `makeSummaryResponse` doesn't accept an override arg, extend it to shallow-merge `{...base, ...override}`.)

- [ ] **Step 2: Run — expect FAIL** `npx jest pipeline.test -t writeSummaryDoc` → `writeSummaryDoc is not a function`.

- [ ] **Step 3: Implement** in `lib/pipeline.ts`. First, **fix the type import** — add `GeminiSummaryResponse` to the existing `import type { … } from '../types';` line (it currently imports `ProgressEvent, Video, VideoMeta, RatingValue, VideoType, Audience`). Add `import { CURRENT_DOC_VERSION } from './doc-version';`. Then add the input/result interfaces and the function (near the top, after imports):

```ts
export interface SummaryDocInput {
  videoId: string;
  title: string;
  youtubeUrl: string;
  channel?: string;
  durationSeconds: number;
  outputFolder: string;
  baseName: string;
}
export interface SummaryDocResult {
  language: 'en' | 'ko';
  ratings: GeminiSummaryResponse['ratings'];
  overallScore: number;
  videoType?: VideoType;
  audience?: Audience;
  tags?: string[];
  tldr?: string;
  takeaways?: string[];
  mdContent: string;
  summaryMd: string;
}

/**
 * Fetch transcript → generateSummary (emits ▶ timestamps) → build the summary .md → write it at
 * <baseName>.md. Shared by ingestion (new slug) and re-summarize (existing baseName). Does NOT write
 * the PDF — the caller owns that (ingestion keeps generating PDFs; re-summarize skips them).
 */
export async function writeSummaryDoc(input: SummaryDocInput): Promise<SummaryDocResult> {
  const { videoId, title, youtubeUrl, channel, durationSeconds, outputFolder, baseName } = input;
  const segments = await fetchTranscriptSegments(videoId);
  const transcript = segments.map((s) => s.text).join(' '); // plain text for language detection only
  const language = detectLanguage(transcript);
  const { summary, ratings, overallScore, videoType, audience, tags, tldr, takeaways } =
    await generateSummary(segments, language, videoId);

  const structuralTags = ['video-summary', language];
  const allTags = [...structuralTags, ...(tags ?? [])];
  const frontmatterLines = [
    '---', 'tags:', ...allTags.map((t) => `  - ${t}`),
    `video_id: "${videoId}"`,
    ...(channel ? [`channel: "${channel}"`] : []),
    `lang: ${language.toUpperCase()}`,
    ...(videoType ? [`type: ${videoType}`] : []),
    ...(audience ? [`audience: ${audience}`] : []),
    `score: ${overallScore}`, '---',
  ];
  const metaParts = [
    channel && `**Channel:** ${channel}`,
    `**Duration:** ${formatDuration(durationSeconds)}`,
    `**URL:** ${youtubeUrl}`,
  ].filter(Boolean).join(' | ');
  const baseContent = [frontmatterLines.join('\n'), '', `# ${title}`, '', metaParts, '', '---', '', summary].join('\n');
  const mdContent = (tldr && takeaways)
    ? insertQuickViewCallout(baseContent, tldr, takeaways, tags ?? [])
    : baseContent;

  await fs.promises.writeFile(path.join(outputFolder, `${baseName}.md`), mdContent, 'utf-8');
  return { language, ratings, overallScore, videoType, audience, tags, tldr, takeaways, mdContent, summaryMd: `${baseName}.md` };
}
```

Now rewire the `runIngestion` loop (`244-334`) to delegate. Replace the block from the "Fetching transcript…" progress event through the `await fs.promises.writeFile(mdPath, mdContent, 'utf-8');` line with:

```ts
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Fetching transcript…', current, total });
      const slug = slugify(meta.title);
      let baseName = slug;
      let counter = 2;
      while (fs.existsSync(path.join(outputFolder, `${baseName}.md`))) {
        baseName = `${slug}-${counter}`;
        counter++;
      }
      onProgress({ type: 'step', videoId: meta.videoId, title: meta.title, step: 'Generating summary…', current, total });
      const { language, ratings, overallScore, videoType, audience, tags, tldr, takeaways, mdContent } =
        await writeSummaryDoc({
          videoId: meta.videoId, title: meta.title, youtubeUrl: meta.youtubeUrl,
          channel: meta.channelTitle, durationSeconds: meta.durationSeconds, outputFolder, baseName,
        });
      fs.mkdirSync(path.join(outputFolder, 'pdfs'), { recursive: true });
      const pdfPath = path.join(outputFolder, 'pdfs', `${baseName}.pdf`);
```

Then in the `const video: Video = { … }` object (still in the loop), add `docVersion: CURRENT_DOC_VERSION,` (e.g. right after `processedAt`). The existing `generatePdf(mdContent, pdfPath)` call below stays. Remove the now-duplicated frontmatter/metaParts/baseContent/mdContent/mdPath lines that `writeSummaryDoc` replaced.

- [ ] **Step 4: Run — expect PASS** `npx jest pipeline.test` → green (writeSummaryDoc test + all existing ingestion tests still pass — byte-identical output). Then `npx tsc --noEmit` (only the 2 known errors).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "refactor(pipeline): extract writeSummaryDoc (no PDF); stamp docVersion on ingest"
```

---

### Task 3: `ensureHtmlDoc` — the version-driven orchestrator

**Files:**
- Create: `lib/html-doc/ensure.ts`
- Test: `tests/lib/html-doc/ensure.test.ts`

`ensureHtmlDoc` does the minimum work to bring a video to `CURRENT_DOC_VERSION`, then leaves `summaryHtml` + `docVersion` current.

- [ ] **Step 1: Write the failing test** — create `tests/lib/html-doc/ensure.test.ts`. Mock the collaborators:

```ts
import { ensureHtmlDoc } from '../../../lib/html-doc/ensure';
import * as pipeline from '../../../lib/pipeline';
import * as generate from '../../../lib/html-doc/generate';
import * as rerender from '../../../lib/html-doc/rerender';
import * as indexStore from '../../../lib/index-store';

jest.mock('../../../lib/pipeline');
jest.mock('../../../lib/html-doc/generate');
jest.mock('../../../lib/html-doc/rerender');
jest.mock('../../../lib/index-store');

const videoBase = {
  id: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en' as const,
  durationSeconds: 5, archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 'base.md', summaryPdf: 'pdfs/base.pdf', deepDiveMd: null, deepDivePdf: null,
  processedAt: '2026-01-01T00:00:00.000Z', personalScore: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  (indexStore.assertOutputFolder as jest.Mock).mockReturnValue(undefined);
  (indexStore.assertVideoId as jest.Mock).mockReturnValue(undefined);
  (generate.runHtmlDoc as jest.Mock).mockResolvedValue(undefined);
  (pipeline.writeSummaryDoc as jest.Mock).mockResolvedValue({
    language: 'en', ratings: videoBase.ratings, overallScore: 4, tags: ['t'], summaryMd: 'base.md', mdContent: '#',
  });
});
function withVideo(v: object) {
  (indexStore.readIndex as jest.Mock).mockReturnValue({ videos: [{ ...videoBase, ...v }] });
}

describe('ensureHtmlDoc', () => {
  it('pre-feature (no docVersion) → re-summarizes, rebuilds, preserves personalScore, stamps current', async () => {
    withVideo({ docVersion: undefined, summaryHtml: 'htmls/base.html' });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).toHaveBeenCalledWith(expect.objectContaining({ baseName: 'base' }));
    expect(generate.runHtmlDoc).toHaveBeenCalled();          // full rebuild after re-summarize
    expect(rerender.reRenderSummaryHtml).not.toHaveBeenCalled();
    const patches = (indexStore.updateVideoFields as jest.Mock).mock.calls.map((c) => c[2]);
    expect(patches).toEqual(expect.arrayContaining([expect.objectContaining({ overallScore: 4 })]));         // AI fields merged
    expect(patches).toEqual(expect.arrayContaining([expect.objectContaining({ docVersion: { major: 2, minor: 0 } })])); // stamped
    expect(patches.every((p) => !('personalScore' in p))).toBe(true); // never overwrites personal review
  });

  it('current major but no HTML → full generate (no re-summarize), stamp', async () => {
    withVideo({ docVersion: { major: 2, minor: 0 }, summaryHtml: null });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(generate.runHtmlDoc).toHaveBeenCalled();
  });

  it('minor-stale with cached model → cheap re-render (no Gemini), stamp', async () => {
    withVideo({ docVersion: { major: 2, minor: 0 }, summaryHtml: 'htmls/base.html' });
    // CURRENT minor is 0 today, so simulate a minor bump by spying: treat stored {2,0} as older than {2,1}
    // (this test pins the branch; if CURRENT minor is 0 it falls to the no-op case below instead).
    (rerender.reRenderSummaryHtml as jest.Mock).mockReturnValue({ status: 'rerendered', htmlPath: 'htmls/base.html' });
    // Force minor-stale by stubbing isOlder via a stored version behind current:
    await ensureHtmlDoc('vid11111111', '/out', () => {}, { major: 2, minor: 1 } /* test-injected current */);
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(rerender.reRenderSummaryHtml).toHaveBeenCalled();
    expect(generate.runHtmlDoc).not.toHaveBeenCalled();
  });

  it('current + HTML present → no work', async () => {
    withVideo({ docVersion: { major: 2, minor: 0 }, summaryHtml: 'htmls/base.html' });
    await ensureHtmlDoc('vid11111111', '/out', () => {});
    expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
    expect(generate.runHtmlDoc).not.toHaveBeenCalled();
    expect(rerender.reRenderSummaryHtml).not.toHaveBeenCalled();
  });

  it('throws 422-style error when the video has no summaryMd', async () => {
    withVideo({ summaryMd: null });
    await expect(ensureHtmlDoc('vid11111111', '/out', () => {})).rejects.toThrow(/no summary/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** `npx jest html-doc/ensure` → module not found.

- [ ] **Step 3: Implement** — create `lib/html-doc/ensure.ts`:

```ts
import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from '../index-store';
import { writeSummaryDoc } from '../pipeline';
import { runHtmlDoc } from './generate';
import { reRenderSummaryHtml } from './rerender';
import { CURRENT_DOC_VERSION, isOlder, needsResummarize, type DocVersion } from '../doc-version';
import type { ProgressEvent } from '../../types';

const PRE_FEATURE: DocVersion = { major: 1, minor: 0 };

/**
 * Bring a video's summary HTML to `current` (default CURRENT_DOC_VERSION), doing the minimum work:
 * major-stale → re-summarize (.md, Gemini) + full HTML rebuild; minor-stale with a cached model →
 * cheap re-render; no HTML yet → full build; already current → nothing. Leaves summaryHtml + docVersion
 * current. `current` is injectable for tests. Throws if the video lacks a source note.
 */
export async function ensureHtmlDoc(
  videoId: string,
  outputFolder: string,
  onProgress: (e: ProgressEvent) => void,
  current: DocVersion = CURRENT_DOC_VERSION,
): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const video = readIndex(outputFolder).videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  if (!video.summaryMd) throw new Error('no summary note for this video');

  const stored: DocVersion = video.docVersion ?? PRE_FEATURE;
  const base = video.summaryMd.replace(/\.md$/, '');

  // Forward only the child build's STEP events; ensureHtmlDoc owns the single terminal `done`,
  // emitted AFTER the docVersion stamp (Codex Blocking: child `done` must not reach the route early).
  // On error we throw — the route's `.catch` emits the job `error` event (don't double-emit here).
  const forwardSteps = (e: ProgressEvent) => { if (e.type === 'step') onProgress(e); };

  onProgress({ type: 'start' });

  if (needsResummarize(stored, current)) {
    onProgress({ type: 'step', videoId, step: 'Re-summarizing (adding timestamps)…', current: 1, total: 2 });
    const r = await writeSummaryDoc({
      videoId: video.id, title: video.title, youtubeUrl: video.youtubeUrl,
      channel: video.channel, durationSeconds: video.durationSeconds, outputFolder, baseName: base,
    });
    // Merge ONLY summary-derived AI fields; never touch personal review / deep-dive / playlist position.
    updateVideoFields(outputFolder, videoId, {
      language: r.language, ratings: r.ratings, overallScore: r.overallScore,
      videoType: r.videoType, audience: r.audience, tags: r.tags, tldr: r.tldr, takeaways: r.takeaways,
    });
    // The .md sections changed → the cached magazine model is stale; drop it so the rebuild regenerates it.
    try { fs.unlinkSync(path.join(outputFolder, 'models', `${base}.json`)); } catch { /* no model — fine */ }
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 2, total: 2 });
    await runHtmlDoc(videoId, outputFolder, forwardSteps);
  } else if (!video.summaryHtml) {
    onProgress({ type: 'step', videoId, step: 'Building HTML…', current: 1, total: 1 });
    await runHtmlDoc(videoId, outputFolder, forwardSteps);
  } else if (isOlder(stored, current)) {
    onProgress({ type: 'step', videoId, step: 'Re-rendering HTML…', current: 1, total: 1 });
    const rr = reRenderSummaryHtml(videoId, outputFolder);
    if (rr.status !== 'rerendered') await runHtmlDoc(videoId, outputFolder, forwardSteps); // no model / drift → full build
  } else {
    onProgress({ type: 'done' });
    return; // already current with HTML — nothing to do
  }

  updateVideoFields(outputFolder, videoId, { docVersion: current }); // stamp BEFORE the terminal done
  onProgress({ type: 'done' });
}
```

> The child `runHtmlDoc` emits its own `start`/`done`; `forwardSteps` swallows both, so the route sees
> exactly one `start` (here), the build's `step`s, and one `done` (after the stamp). `ensureHtmlDoc`
> never emits `error` — it throws, and the route turns the rejection into the job's `error` event.

- [ ] **Step 4: Run — expect PASS** `npx jest html-doc/ensure` → green. `npx tsc --noEmit` (only the 2 known errors).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/ensure.ts tests/lib/html-doc/ensure.test.ts
git commit -m "feat(html-doc): ensureHtmlDoc — version-driven re-summarize/re-render/build"
```

---

### Task 4: Route the unified action through `ensureHtmlDoc`

**Files:**
- Modify: `app/api/videos/[id]/html-doc/route.ts` (swap `runHtmlDoc` → `ensureHtmlDoc`)
- Test: `tests/lib/job-registry-html.test.ts` (existing html-doc route/job test — extend if present) or a new route test

The existing POST route already `createJob` + runs an orchestrator with `onProgress` → job events → SSE. Only the orchestrator call changes.

- [ ] **Step 1: Rewrite the existing route test.** `tests/api/html-doc-post.test.ts` currently mocks `lib/html-doc/generate` and asserts `runHtmlDoc` — **rewrite** it (don't supplement): `jest.mock('../../lib/html-doc/ensure')`, drop the generate mock, and replace the assertions with the new collaborator:

```ts
import { ensureHtmlDoc } from '../../lib/html-doc/ensure';
jest.mock('../../lib/html-doc/ensure');
// … POST the route with { outputFolder } …
expect(ensureHtmlDoc).toHaveBeenCalledWith('vid11111111', outputFolder, expect.any(Function));
```

Also inspect `tests/api/html-doc-pipeline.test.ts` and `tests/lib/job-registry-html.test.ts`: any that drive the **real** `ensureHtmlDoc` end-to-end (not mocked) use video fixtures with **no `docVersion`** → after the swap those would be treated as `{1,0}` and trigger re-summarize (calling `fetchTranscriptSegments`/`generateSummary`). For each such fixture, **add `docVersion: { major: 2, minor: 0 }`** so it exercises the build path unchanged (or, if the test intends to cover re-summarize, mock `writeSummaryDoc`). Run `npx jest html-doc-post html-doc-pipeline job-registry-html` to see exactly which break, and fix their fixtures.

- [ ] **Step 2: Run — expect FAIL** (route still calls `runHtmlDoc`; rewritten test asserts `ensureHtmlDoc`).

- [ ] **Step 3: Implement.** In `app/api/videos/[id]/html-doc/route.ts`, change the import `import { runHtmlDoc } from '../../../../../lib/html-doc/generate';` to `import { ensureHtmlDoc } from '../../../../../lib/html-doc/ensure';` and change the call `runHtmlDoc(videoId, outputFolder, (event) => {…})` to `ensureHtmlDoc(videoId, outputFolder, (event) => {…})`. Leave the job-registry/SSE wiring untouched (its `.catch` still emits the `error` event; its `onTerminal` still fires on the single `done`).

- [ ] **Step 4: Run — expect PASS** `npx jest html-doc-post html-doc-pipeline job-registry-html` → green (fixtures updated). `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add app/api/videos/\[id\]/html-doc/route.ts tests/
git commit -m "feat(api): html-doc route drives ensureHtmlDoc (version-aware)"
```

---

### Task 5: Corrections invalidates the cached HTML

**Files:**
- Modify: `app/api/videos/[id]/regenerate/route.ts` (clear `summaryHtml` in index + response)
- Modify: `components/CorrectionsPanel.tsx` (patch type + onSuccess), `components/VideoList.tsx`, `components/VideoRow.tsx`, `app/page.tsx` (`onAnnotationChange` patch type includes `summaryHtml`)
- Test: the existing corrections/regenerate route test

After "Edit corrections" rewrites the `.md`, the cached HTML is stale but the version is unchanged; clear `summaryHtml` so the unified action rebuilds it. **And** thread that null into the in-memory row so the menu flips from a (stale) link to a button immediately — not only after a hard refetch (Codex High).

- [ ] **Step 1: Write the failing test** — after a successful corrections POST, assert the index update clears the HTML and the JSON response carries it:

```ts
// mock index-store.updateVideoFields; POST corrections; then:
expect(updateVideoFields).toHaveBeenCalledWith(outputFolder, videoId, expect.objectContaining({ summaryHtml: null }));
// and the response body:
expect(body).toEqual(expect.objectContaining({ summaryHtml: null }));
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement (route).** In `regenerate/route.ts`, extend the existing post-write quick-view update and the JSON response to clear the HTML:

```ts
    updateVideoFields(outputFolder, videoId, { tldr, takeaways, summaryHtml: null });
    // …existing corrections persistence…
    return NextResponse.json({ tldr, takeaways, corrections: trimmedCorrections, summaryHtml: null });
```

- [ ] **Step 4: Implement (UI threading).** Widen the corrections patch type so the cleared HTML reaches the in-memory row:
  - `components/CorrectionsPanel.tsx`: change `type Patch = Partial<Pick<Video, 'corrections' | 'tldr' | 'takeaways'>>;` to add `'summaryHtml'`; in the `onSuccess({ … })` call add `summaryHtml: (data.summaryHtml ?? null) as string | null`.
  - `components/VideoList.tsx` and `components/VideoRow.tsx`: in the `onAnnotationChange` prop type `Partial<Pick<Video, 'personalScore' | 'personalNote' | 'corrections' | 'tldr' | 'takeaways'>>`, add `'summaryHtml'`.
  - `app/page.tsx`: the existing annotation handler already merges the patch into the video (`{ ...v, ...patch }`), so `summaryHtml: null` now clears it in state → the menu item becomes a button. (If the handler's local patch type is also a `Pick`, widen it identically.)

- [ ] **Step 5: Run — expect PASS** `npx jest regenerate CorrectionsPanel`. `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add app/api/videos/\[id\]/regenerate/route.ts components/CorrectionsPanel.tsx components/VideoList.tsx components/VideoRow.tsx app/page.tsx tests/
git commit -m "fix: clear stale summaryHtml after corrections — index, response, and in-memory row"
```

---

### Task 6: Collapse the menu into one version-aware "HTML doc" item

**Files:**
- Modify: `components/VideoMenu.tsx`
- Test: `tests/components/VideoMenu.test.tsx` (create if absent)

Replace the three items (`View HTML doc` link, `Generate HTML doc` button, `Regenerate HTML doc` button) with **one** "HTML doc" item: a direct link when current, a button otherwise, disabled while busy or without a summary.

- [ ] **Step 1: Write the failing test** — `tests/components/VideoMenu.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import VideoMenu from '../../components/VideoMenu';

const base = {
  id: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
  durationSeconds: 5, archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 'base.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null, processedAt: '2026-01-01T00:00:00.000Z',
};
const props = { outputFolder: '/o', baseOutputFolder: '/o', onDeepDive() {}, onArchive() {}, onEditCorrections() {}, onGenerateHtml() {}, onClose() {}, busy: false };

it('shows a single "HTML doc" item — a direct link when current (html + docVersion 2.0)', () => {
  render(<VideoMenu {...props} video={{ ...base, summaryHtml: 'htmls/base.html', docVersion: { major: 2, minor: 0 } } as any} />);
  const el = screen.getByRole('link', { name: /HTML doc/i });
  expect(el).toHaveAttribute('href', expect.stringContaining('/api/html/'));
  expect(screen.queryByText(/Generate HTML doc|Regenerate HTML doc|View HTML doc/)).toBeNull();
});

it('renders a button when stale (pre-feature: no docVersion)', () => {
  render(<VideoMenu {...props} video={{ ...base, summaryHtml: 'htmls/base.html' } as any} />);
  expect(screen.getByRole('button', { name: /HTML doc/i })).toBeInTheDocument();
});

it('disables the item while busy', () => {
  render(<VideoMenu {...props} busy video={{ ...base, summaryHtml: 'htmls/base.html', docVersion: { major: 2, minor: 0 } } as any} />);
  expect(screen.getByText(/HTML doc/i).closest('a,button,span')).toHaveAttribute('aria-disabled', 'true');
});
```

- [ ] **Step 2: Run — expect FAIL** `npx jest VideoMenu`.

- [ ] **Step 3: Implement.** In `components/VideoMenu.tsx`: add imports `import { CURRENT_DOC_VERSION, isOlder } from '@/lib/doc-version';`. Add `busy?: boolean` to `VideoMenuProps`. Replace the three `<li>`s for the HTML-doc items (the `hasSummaryHtml ? View : hasSummary ? Generate : disabled` block **and** the separate `Regenerate HTML doc` block, currently lines 86-105) with a single item:

```tsx
      <li role="none">
        {(() => {
          const current = !!video.summaryHtml && !isOlder(video.docVersion ?? { major: 1, minor: 0 }, CURRENT_DOC_VERSION);
          if (!hasSummary) return <span aria-disabled="true" className={disabledClass}>HTML doc</span>;
          if (busy) return <span aria-disabled="true" className={disabledClass}>HTML doc <span aria-hidden="true">⏳</span></span>;
          return current
            ? <a href={htmlViewHref} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>HTML doc</a>
            : <button type="button" onClick={() => { onGenerateHtml(video.id); onClose(); }} className={itemClass}>HTML doc</button>;
        })()}
      </li>
```

Pass `busy` through from `VideoMenu`'s props (destructure it in the function signature). Keep the deep-dive HTML, Obsidian, PDF, corrections, archive items unchanged.

- [ ] **Step 4: Run — expect PASS** `npx jest VideoMenu`. `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add components/VideoMenu.tsx tests/components/VideoMenu.test.tsx
git commit -m "feat(ui): single version-aware 'HTML doc' menu item"
```

---

### Task 7: Per-row hourglass + busy threading

**Files:**
- Modify: `components/VideoRow.tsx`, `components/VideoList.tsx`, `app/page.tsx`
- Test: `tests/components/VideoRow.test.tsx` (busy indicator)

While a row is regenerating (`htmlJob.videoId === video.id`), show an hourglass next to the ☰ trigger and mark the menu item busy. On completion the existing `handleHtmlClose` refetches videos → `docVersion` current → item becomes a direct link.

- [ ] **Step 1: Write the failing test** — `tests/components/VideoRow.test.tsx` renders a `<table><tbody>` wrapper with `<VideoRow busy ... />` and asserts an hourglass with `aria-label="Regenerating"` is present next to the menu; and `<VideoRow ...>` (not busy) has none. (Render inside a `table`/`tbody` to satisfy `<tr>`.)

```tsx
it('shows an hourglass next to the menu while busy', () => {
  render(<table><tbody><VideoRow {...rowProps} busy /></tbody></table>);
  expect(screen.getByLabelText('Regenerating')).toBeInTheDocument();
});
it('no hourglass when not busy', () => {
  render(<table><tbody><VideoRow {...rowProps} /></tbody></table>);
  expect(screen.queryByLabelText('Regenerating')).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.**

`components/VideoRow.tsx`: add `busy?: boolean;` to `VideoRowProps`; destructure `busy` (default `false`). Next to the `☰` menu button (after it, inside the same flex container at lines 92-101) add:

```tsx
            {busy && <span role="status" aria-label="Regenerating" title="Regenerating…" className="shrink-0 text-amber-400 animate-pulse">⏳</span>}
```

Pass `busy={busy}` into `<VideoMenu … />`.

`components/VideoList.tsx`: add `busyVideoId?: string | null;` to `VideoListProps`; destructure it; pass `busy={busyVideoId === video.id}` to each `<VideoRow … />`.

`app/page.tsx`: pass `busyVideoId={htmlJob?.videoId ?? null}` to `<VideoList … />`. (`htmlJob` already exists; `handleHtmlClose` already refetches videos so the row updates to current on completion.)

- [ ] **Step 4: Remove the conflicting auto-open** (Codex Medium). In `components/HtmlDocStatusBar.tsx`, the `data.type === 'done'` branch calls `window.open(viewUrl, …)`. Delete that `try { window.open(...) } catch {}` line. The user's model is "the menu becomes clickable" — on completion the status bar already shows the **"View HTML doc ↗"** link, and the refetched row's "HTML doc" item is now a direct link; both are real user-gesture opens (no popup-block, no double-open). Keep the auto-close timer.

- [ ] **Step 5: Rewrite the stale E2E** (Codex Medium). `tests/e2e/html-doc.spec.ts` asserts `View / Generate / Regenerate HTML doc`. Rewrite its menu expectations around the single **"HTML doc"** item and `docVersion`: a fixture video with `summaryHtml` + `docVersion {2,0}` shows a direct link; a fixture with no `docVersion` (pre-feature) shows the action button → clicking it shows the hourglass (mock the route/SSE) → on done the item becomes a link whose served HTML contains `.ts` anchors. Remove assertions for the removed menu items. Check `tests/e2e/darkmode-html.spec.ts` / `deep-dive-html.spec.ts` for any "Generate/View HTML doc" menu reliance and update the summary-menu parts only.

- [ ] **Step 6: Run — expect PASS** `npx jest VideoRow`; `npx playwright test html-doc` (E2E). `npx tsc --noEmit`.

- [ ] **Step 7: Full suite** `npm test` → all green (no regressions). `npx tsc --noEmit` → only the 2 pre-existing errors.

- [ ] **Step 8: Commit**

```bash
git add components/VideoRow.tsx components/VideoList.tsx app/page.tsx components/HtmlDocStatusBar.tsx tests/components/VideoRow.test.tsx tests/e2e/html-doc.spec.ts
git commit -m "feat(ui): per-row hourglass + busy threading; menu-clickable completion (no auto-open)"
```

---

## Self-Review

**Spec coverage**

| Spec | Task |
|---|---|
| §3 `DocVersion`, `CURRENT_DOC_VERSION`, `isOlder`, `needsResummarize`, per-video `docVersion` | Task 1 |
| §4 `writeSummaryDoc` extraction (no PDF), ingestion byte-identical + stamps version | Task 2 |
| §5 `ensureHtmlDoc` three branches + merge/preserve + model invalidation + non-destructive | Task 3 |
| §5 route drives `ensureHtmlDoc` | Task 4 |
| §7 corrections clears `summaryHtml` | Task 5 |
| D5/§7 single version-aware "HTML doc" item (link/button/disabled) | Task 6 |
| §7 per-row hourglass, busy disable, busy→clickable on refresh | Task 7 |
| D7 PDF untouched | Tasks 2 (no PDF in writeSummaryDoc) + 3 (re-summarize path never calls generatePdf) |
| D8 no confirm/overlay | (no task adds one) |
| §6 output format identical | Task 2 (same builder) |

No spec requirement is without a task. Phase-2 bulk is out of scope by D3.

**Placeholder scan:** every code step has complete code. Two prose directions remain — both reference concrete, already-read code: Task 2 "remove the now-duplicated frontmatter/… lines `writeSummaryDoc` replaced" (the exact lines are `pipeline.ts:264-302`), and Task 4's import/call swap (one line each).

**Type consistency:** `DocVersion {major,minor}` (Task 1) is used identically in Tasks 3/6; `writeSummaryDoc(SummaryDocInput with baseName)` (Task 2) is called with `baseName` in Tasks 2/3; `ensureHtmlDoc(videoId, outputFolder, onProgress, current?)` (Task 3) is called by Task 4; `busy` prop flows VideoMenu (Task 6) ← VideoRow ← VideoList ← page (Task 7); `updateVideoFields(outputFolder, videoId, patch)` matches the existing index-store signature.

**Codex plan-review findings folded in** (`docs/reviews/plan-resummarize-codex.md`): Blocking `done`-before-stamp → Task 3 `forwardSteps` + single terminal `done` after the version stamp, throws on error; High `GeminiSummaryResponse` import → Task 2; High stale-UI-after-corrections → Task 5 threads `summaryHtml: null` to the in-memory row; High route-test → Task 4 rewrites `html-doc-post.test.ts` + fixes `html-doc-pipeline`/`job-registry-html` fixtures (add `docVersion {2,0}`); Medium auto-open + stale E2E → Task 7. The injectable `current` param (Medium) is kept as an intentional test seam; progress-event drift (Low) accepted.

## Verification (Phase 4 — after all tasks)

Against the running app: open a pre-feature video's "HTML doc" → hourglass shows → on completion the item becomes a link → opening it shows `▶` timestamps; the `.md` is overwritten with `▶` lines; the PDF file is unchanged (stale); personal score/note survive; a second click opens instantly (no regen). Enumerate these as a `TaskCreate` list before clicking (per dev-process Phase 4).
