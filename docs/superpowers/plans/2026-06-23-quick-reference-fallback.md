# Quick Reference Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `writeSummaryDoc` always emits the Quick Reference callout — when `generateSummary` omits `tldr`/`takeaways`, derive them via `extractQuickView`; graceful (no callout, no throw) if that also fails.

## Global Constraints
- `extractQuickView(baseContent)` (full md), matching `backfill`/`regenerate` consumers.
- `try` wraps ONLY the derive; `writeFile` stays outside (never skip the .md write).
- Discard the partial on throw (return `undefined` → keeps the doc backfill-eligible).
- Full `npm test` + `npx tsc --noEmit` green before commit.

---

### Task 1: Fallback to `extractQuickView` in `writeSummaryDoc`

**Files:**
- Modify: `lib/pipeline.ts` (import line 4; `writeSummaryDoc` ~68-72)
- Test: `tests/lib/pipeline.test.ts`

**Interfaces:** `writeSummaryDoc` signature/return shape unchanged (already returns `{tldr, takeaways, …}`).

- [ ] **Step 1: Blast-radius guard + scaffolding** in `tests/lib/pipeline.test.ts`. (NOTE: the file ALREADY has `describe('writeSummaryDoc', …)` at ~line 1112 and `describe('runIngestion', …)` — do NOT create new describes; add into the existing ones.)
  - Add the mock handle in MODULE scope, near the other `jest.mocked(...)` handles (~line 22-28): `const mockExtractQuickView = jest.mocked(gemini.extractQuickView);`
  - Add `tldr` + `takeaways` to `makeSummaryResponse()`'s default so existing tests stay on the both-present path:
    ```ts
    function makeSummaryResponse(overrides: Partial<GeminiSummaryResponse> = {}): GeminiSummaryResponse {
      return {
        summary: 'A great summary',
        ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
        overallScore: 3,
        tldr: 'This video explains the topic.',
        takeaways: ['Point one', 'Point two'],
        ...overrides,
      };
    }
    ```
  - Add a defensive default `mockExtractQuickView.mockResolvedValue({ tldr: 'QV tldr', takeaways: ['qa', 'qb'] });` to BOTH the `describe('runIngestion')` `beforeEach` (~line 84) AND the `describe('writeSummaryDoc')` `beforeEach` (~line 1115).
  - Also add `mockFetchTranscriptSegments.mockResolvedValue([{ text: 't', offset: 0, duration: 5 }]);` to the `describe('writeSummaryDoc')` `beforeEach` (~line 1115) so the new fallback cases below resolve transcripts (existing `:1128`/`:1151` set their own and override).

- [ ] **Step 2: Add the new failing tests.** Put the 4 fallback cases INSIDE the existing `describe('writeSummaryDoc', …)` block (reuse its `outputFolder` fixture + `afterEach`). `writeSummaryDoc` and `fsReal` are already imported there; use `fsReal.readFileSync`.

```ts
  // — Quick Reference fallback (Issue 2) —
  const qrInput = () => ({ videoId: 'vidQR', title: 'T', youtubeUrl: 'https://youtu.be/x', channel: 'C', durationSeconds: 300, outputFolder, baseName: 'doc' });
  const qrRead = () => fsReal.readFileSync(`${outputFolder}/doc.md`, 'utf-8');

  it('QR: both present → no extractQuickView call, callout from generateSummary values', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: 'This video does X.', takeaways: ['a', 'b'] }));
    const r = await writeSummaryDoc(qrInput());
    expect(mockExtractQuickView).not.toHaveBeenCalled();
    expect(qrRead()).toContain('> **TL;DR:** This video does X.');
    expect(r.tldr).toBe('This video does X.');
  });

  it('QR: neither present → extractQuickView(baseContent) fallback inserts callout', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: undefined, takeaways: undefined }));
    mockExtractQuickView.mockResolvedValue({ tldr: 'Derived tldr.', takeaways: ['d1', 'd2'] });
    const r = await writeSummaryDoc(qrInput());
    expect(mockExtractQuickView).toHaveBeenCalledTimes(1);
    const arg = mockExtractQuickView.mock.calls[0][0] as string;
    expect(arg).toContain('video_id: "vidQR"'); // baseContent = full md (frontmatter present)
    expect(arg).toContain('# T');
    expect(qrRead()).toContain('> **TL;DR:** Derived tldr.');
    expect(r.tldr).toBe('Derived tldr.');
    expect(r.takeaways).toEqual(['d1', 'd2']);
  });

  it('QR: only tldr present → fallback derives both (partial discarded)', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: 'partial only', takeaways: undefined }));
    mockExtractQuickView.mockResolvedValue({ tldr: 'Derived.', takeaways: ['d1'] });
    const r = await writeSummaryDoc(qrInput());
    expect(mockExtractQuickView).toHaveBeenCalledTimes(1);
    expect(qrRead()).toContain('> **TL;DR:** Derived.');
    expect(r.tldr).toBe('Derived.'); // partial 'partial only' discarded
  });

  it('QR: extractQuickView throws → graceful (md written without callout, no throw, undefined values)', async () => {
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: undefined, takeaways: undefined }));
    mockExtractQuickView.mockRejectedValue(new Error('qv failed'));
    const r = await writeSummaryDoc(qrInput());
    expect(qrRead()).not.toContain('> [!summary] Quick Reference');
    expect(qrRead()).toContain('# T'); // file still written
    expect(r.tldr).toBeUndefined();
    expect(r.takeaways).toBeUndefined();
  });
```

Then add this ONE case INSIDE the existing `describe('runIngestion', …)` block (e.g. right after the `:561` "writes Quick Reference callout" test), so it inherits the runIngestion `beforeEach` (which sets `YOUTUBE_API_KEY`, `assertOutputFolder`, `upsertVideo`, etc.):

```ts
  it('persists DERIVED tldr/takeaways to the index when generateSummary omits them', async () => {
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vid1')]);
    mockFetchTranscriptSegments.mockResolvedValue([{ text: 't', offset: 0, duration: 5 }]);
    mockGenerateSummary.mockResolvedValue(makeSummaryResponse({ tldr: undefined, takeaways: undefined }));
    mockExtractQuickView.mockResolvedValue({ tldr: 'Derived.', takeaways: ['d1', 'd2'] });
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vid1', tldr: 'Derived.', takeaways: ['d1', 'd2'] }),
    );
  });
```

- [ ] **Step 3: Run — confirm RED** (`npx jest pipeline -t "QR:"` and `-t "persists DERIVED"`). Cases 2/3/4 (neither/only-tldr/throw) and the ingestion case fail under current code (no callout written, extractQuickView never called). Case 1 ("QR: both present → no extractQuickView call") is already GREEN at this stage (current code never calls extractQuickView) — that's expected for a guard assertion, not a broken RED.

- [ ] **Step 4: Implement.** In `lib/pipeline.ts`:
  - Line 4 import: `import { generateSummary, extractQuickView } from './gemini';`
  - Replace the `const mdContent = (tldr && takeaways) ? insertQuickViewCallout(...) : baseContent;` line and the `return {…}` (lines ~68-73) with the spec's control structure:

```ts
  let outTldr = tldr;
  let outTakeaways = takeaways;
  let mdContent: string;
  if (tldr && takeaways) {
    mdContent = insertQuickViewCallout(baseContent, tldr, takeaways, tags ?? []);
  } else {
    // generateSummary omitted tldr/takeaways → derive them from the full md so the Quick
    // Reference callout is never silently skipped (same primitive the backfill route uses).
    try {
      const qv = await extractQuickView(baseContent);
      outTldr = qv.tldr;
      outTakeaways = qv.takeaways;
      mdContent = insertQuickViewCallout(baseContent, qv.tldr, qv.takeaways, tags ?? []);
    } catch {
      // Extraction failed — write without the callout and clear the partial so the doc
      // stays eligible for the backfill route (filters on !v.tldr). Never fail the summary.
      mdContent = baseContent;
      outTldr = undefined;
      outTakeaways = undefined;
    }
  }

  await fs.promises.writeFile(path.join(outputFolder, `${baseName}.md`), mdContent, 'utf-8');
  return { language, ratings, overallScore, videoType, audience, tags, tldr: outTldr, takeaways: outTakeaways, mdContent, summaryMd: `${baseName}.md` };
```

- [ ] **Step 5: Run — GREEN** (`npx jest pipeline -t "Quick Reference fallback"` + the ingestion case).

- [ ] **Step 6: Full suite + types** — `npm test` then `npx tsc --noEmit`. The adversarial review found the `makeSummaryResponse` default change breaks **no** existing assertion (callout-absence is never asserted on a defaulted response; all index-entry checks use `objectContaining`); the two existing `writeSummaryDoc` direct tests `:1130`/`:1153` now carry tldr+takeaways → both-present path → still green. Expected churn ≈ zero — but RUN the full suite to confirm; if any test does break, fix by asserting the now-present callout, or override `tldr/takeaways: undefined` in that one test if it must assert the no-callout shape. All green before commit.

- [ ] **Step 7: Commit** — `fix(pipeline): derive Quick Reference via extractQuickView when generateSummary omits tldr/takeaways`. `git commit -F -` quoted-EOF heredoc; end body with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LmbSdwfXunHoxGJxtb3zGc
  ```

## Post-implementation (migration — after merge)
Throwaway script (env sourced) over summaries whose `.md` lacks `> [!summary] Quick Reference`: read `.md` → `extractQuickView` → `insertQuickViewCallout` → write → `updateVideoFields({tldr, takeaways})`. Dry-run/print first (list eligible), then `--run`, then verify each now contains the callout.

## Self-review notes
- Spec coverage: import + control structure (Step 4) + 6 test cases (Steps 1-2) + blast-radius guard (Step 1). Type consistency: `outTldr/outTakeaways` typed `string | undefined` / `string[] | undefined` to match the return; `extractQuickView` returns `{tldr: string; takeaways: string[]}`.
