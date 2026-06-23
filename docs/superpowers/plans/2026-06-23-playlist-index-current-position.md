# Playlist Index = Current Position — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `playlistIndex` reflects the current playlist position (re-derived each sync for in-playlist videos), instead of being frozen at first ingest.

**Architecture:** One-expression change to the re-stamp pass in `runIngestion`, plus the now-stale comment, plus tests.

## Global Constraints
- Change only the `playlistIndex` precedence; `videoPublishedAt`/`addedToPlaylistAt` stay write-once.
- Mock boundary for tests: `lib/youtube` + `lib/index-store` + `lib/gemini` (already mocked in `pipeline.test.ts`).
- Full `npm test` + `npx tsc --noEmit` green before commit.

---

### Task 1: Re-derive `playlistIndex` from current playlist order

**Files:**
- Modify: `lib/pipeline.ts` (re-stamp pass ~387-393; comment ~385-386)
- Test: `tests/lib/pipeline.test.ts` (add cases in the `describe('runIngestion', …)` block)

**Interfaces:** No signature change. `runIngestion(playlistUrl, outputFolder, onProgress, signal?)` unchanged.

- [ ] **Step 1: Add failing tests** (use the file's existing `makeIndexedVideo`, `makeVideoMeta`, `mockReadIndex`, `mockFetchPlaylistVideos`, `mockWriteIndex`; default `beforeEach` already stubs transcript/summary/detectLanguage). Helper to read the final written videos:

```ts
function lastWrittenVideos(): Video[] {
  const calls = mockWriteIndex.mock.calls;
  return calls[calls.length - 1][1].videos;
}

describe('playlistIndex tracks current playlist position', () => {
  it('re-derives a stale in-playlist index to its current position', async () => {
    const stale = makeIndexedVideo('vidA', { playlistIndex: 1 }); // frozen at 1
    const others = ['vidW', 'vidX', 'vidY', 'vidZ'].map((id) => makeIndexedVideo(id));
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [...others, stale] });
    // playlist now places vidA at position 5
    mockFetchPlaylistVideos.mockResolvedValue(
      ['vidW', 'vidX', 'vidY', 'vidZ', 'vidA'].map((id) => makeVideoMeta(id)),
    );
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    expect(lastWrittenVideos().find((v) => v.id === 'vidA')?.playlistIndex).toBe(5);
  });

  it('resolves a collision (two videos frozen at 1) to distinct current positions', async () => {
    const a = makeIndexedVideo('vidA', { playlistIndex: 1 });
    const b = makeIndexedVideo('vidB', { playlistIndex: 1 });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [a, b] });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vidB'), makeVideoMeta('vidA')]); // B@1, A@2
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    const w = lastWrittenVideos();
    expect(w.find((v) => v.id === 'vidB')?.playlistIndex).toBe(1);
    expect(w.find((v) => v.id === 'vidA')?.playlistIndex).toBe(2);
  });

  it('un-archives (via reconcile upsert) AND re-numbers a removed video that returns', async () => {
    const d = makeIndexedVideo('vidD', { playlistIndex: 9, archived: true, removedFromPlaylist: true });
    const others = ['vidW', 'vidX', 'vidY'].map((id) => makeIndexedVideo(id));
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [...others, d] });
    // D reappears at position 4
    mockFetchPlaylistVideos.mockResolvedValue(
      ['vidW', 'vidX', 'vidY', 'vidD'].map((id) => makeVideoMeta(id)),
    );
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    // index-store is mocked, so the reconcile un-archive is observable only at the upsert call
    // (the re-stamp pass re-reads the mocked seeded array). Mirror the existing :332 test.
    expect(mockUpsertVideo).toHaveBeenCalledWith(
      outputFolder,
      expect.objectContaining({ id: 'vidD', archived: false, removedFromPlaylist: false }),
    );
    // playlistIndex is re-derived by the final writeIndex re-stamp pass (vidD is in positionMap)
    expect(lastWrittenVideos().find((v) => v.id === 'vidD')?.playlistIndex).toBe(4);
  });

  it('re-numbers an archived-but-still-in-playlist video (kept archived)', async () => {
    const e = makeIndexedVideo('vidE', { playlistIndex: 1, archived: true, removedFromPlaylist: false });
    const others = ['vidU', 'vidV', 'vidW', 'vidX', 'vidY'].map((id) => makeIndexedVideo(id));
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [...others, e] });
    mockFetchPlaylistVideos.mockResolvedValue(
      ['vidU', 'vidV', 'vidW', 'vidX', 'vidY', 'vidE'].map((id) => makeVideoMeta(id)), // E@6
    );
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    const ew = lastWrittenVideos().find((v) => v.id === 'vidE');
    expect(ew?.playlistIndex).toBe(6);
    expect(ew?.archived).toBe(true);
  });

  it('preserves stable fields while re-deriving playlistIndex', async () => {
    const a = makeIndexedVideo('vidA', { playlistIndex: 1, videoPublishedAt: '2020-01-01T00:00:00Z', addedToPlaylistAt: '2021-01-01T00:00:00Z' });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [makeIndexedVideo('vidB'), a] });
    mockFetchPlaylistVideos.mockResolvedValue([makeVideoMeta('vidB'), makeVideoMeta('vidA')]); // A@2
    await runIngestion(PLAYLIST_URL, outputFolder, () => {});
    const aw = lastWrittenVideos().find((v) => v.id === 'vidA');
    expect(aw?.playlistIndex).toBe(2);
    expect(aw?.videoPublishedAt).toBe('2020-01-01T00:00:00Z'); // write-once preserved
    expect(aw?.addedToPlaylistAt).toBe('2021-01-01T00:00:00Z');
  });

  it('does not crash on an empty playlist and keeps existing indices', async () => {
    const a = makeIndexedVideo('vidA', { playlistIndex: 7 });
    mockReadIndex.mockReturnValue({ playlistUrl: PLAYLIST_URL, outputFolder, videos: [a] });
    mockFetchPlaylistVideos.mockResolvedValue([]);
    await expect(runIngestion(PLAYLIST_URL, outputFolder, () => {})).resolves.toBeUndefined();
    expect(lastWrittenVideos().find((v) => v.id === 'vidA')?.playlistIndex).toBe(7);
  });
});
```

- [ ] **Step 2: Run — confirm RED** (`npx jest pipeline -t "tracks current playlist position"`). The stale/collision/archived `playlistIndex` assertions fail (old write-once keeps the frozen value). For the returned-video test, the `playlistIndex` assertion is the one that flips RED→GREEN; its `mockUpsertVideo` un-archive assertion passes both before and after the flip (reconcile is independent of the change). (`mockUpsertVideo` is the existing `jest.mocked(indexStore.upsertVideo)` already declared at the top of the file.)

- [ ] **Step 3: Implement the flip** in `lib/pipeline.ts`. Change the re-stamp expression (currently `playlistIndex: v.playlistIndex ?? positionMap.get(v.id),`) to:

```ts
    // playlistIndex tracks the CURRENT playlist position: in-playlist videos (always in
    // positionMap) are re-derived each sync; videos removed from the playlist (absent from
    // positionMap) keep their last-known index. videoPublishedAt/addedToPlaylistAt remain
    // write-once (stable per video).
    playlistIndex: positionMap.get(v.id) ?? v.playlistIndex,
    videoPublishedAt: v.videoPublishedAt ?? publishedMap.get(v.id),
    addedToPlaylistAt: v.addedToPlaylistAt ?? addedMap.get(v.id),
```

Replace the stale comment block above this mapping (the "Prefer existing values (write-once semantics via ??): playlistIndex, videoPublishedAt, addedToPlaylistAt are all stable IDs…" comment) with the new inline comment shown above (it must no longer claim `playlistIndex` is write-once).

- [ ] **Step 4: Run — confirm GREEN** (`npx jest pipeline -t "tracks current playlist position"`), then the full pipeline suite (`npx jest pipeline`) — verify the existing `:369` ("stamps playlistIndex on already-indexed videos") and `:389` ("preserves … for videos no longer in the playlist") still pass (the flip keeps both: positions match for in-playlist; removed videos fall through to `?? v.playlistIndex`).

- [ ] **Step 5: Full suite + types** — `npm test` then `npx tsc --noEmit`. All green.

- [ ] **Step 6: Commit** — `fix(pipeline): playlistIndex tracks current playlist position (was write-once)`. Use `git commit -F -` with a quoted-EOF heredoc; end the body with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LmbSdwfXunHoxGJxtb3zGc
  ```

## Post-implementation (migration — after merge)
Run one Sync against the corpus (re-fetches the full playlist order; already-indexed videos are skipped in the processing loop, so no Gemini/transcript work — just the re-stamp pass). Then verify the index has 269 distinct `playlistIndex` values among in-playlist videos.

## Self-review notes
- Spec coverage: flip (Step 3) + comment fix (Step 3) + all 6 spec test cases (Step 1, minus the duplicate-removed case which the existing `:389` already covers). Type consistency: no signature change; `positionMap`/`publishedMap`/`addedMap` already exist at `pipeline.ts:381-383`.
