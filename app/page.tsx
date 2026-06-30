'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilterState, ProgressEvent, SortColumn, SortOrder, Video } from '@/types';
import type { BatchMode } from '@/lib/html-doc/batch';
import { FILTER_DEFAULTS } from '@/types';
import BackfillOverlay from '@/components/BackfillOverlay';
import BatchDocStatusBar from '@/components/BatchDocStatusBar';
import BulkActionBar from '@/components/BulkActionBar';
import DeepDiveStatusBar from '@/components/DeepDiveStatusBar';
import FilterBar from '@/components/FilterBar';
import Header from '@/components/Header';
import HtmlDocStatusBar from '@/components/HtmlDocStatusBar';
import VideoList from '@/components/VideoList';
import { summaryNeedsWork, videoNeedsBatchWork } from '@/lib/html-doc/eligibility';

type IngestStatus = 'idle' | 'running' | 'error';

interface IngestState {
  status: IngestStatus;
  step: string;
  progress: number;
  error: string;
  current: number;
  total: number;
  title: string;
}

const IDLE_INGEST: IngestState = { status: 'idle', step: '', progress: 0, error: '', current: 0, total: 0, title: '' };

// Stable empty set — module-level so it never causes unnecessary re-renders
const EMPTY_SET = new Set<string>();

export default function Page() {
  const [outputFolder, setOutputFolder] = useState('');
  const [baseOutputFolder, setBaseOutputFolder] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [showArchive, setShowArchive] = useState(false);
  const [filters, setFilters] = useState<FilterState>(FILTER_DEFAULTS);
  const [currentPlaylistUrl, setCurrentPlaylistUrl] = useState('');
  const [ingest, setIngest] = useState<IngestState>(IDLE_INGEST);
  const [deepDive, setDeepDive] = useState<{ videoId: string; jobId: string; title: string; viewUrl: string } | null>(null);
  const [htmlJob, setHtmlJob] = useState<{ videoId: string; jobId: string; title: string; viewUrl: string } | null>(null);
  // The row whose doc job is actively running, driving its ⏳. Set on job start; cleared on
  // close OR when a status bar reports a terminal error (so a failed job stops showing ⏳ while
  // its error bar stays open). Derived-from-job-existence would leave ⏳ stuck through the error.
  // Single scalar: assumes at most one active doc job at a time (one status bar open). If multi-row
  // concurrency is ever needed, make this a Set and have onError clear only the errored videoId.
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState<BatchMode>('summary');
  const [batchJob, setBatchJob] = useState<{ jobId: string; videoIds: Set<string> } | null>(null);

  const ingestESRef = useRef<EventSource | null>(null);
  const ingestJobIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // Always-current sort values for use inside async callbacks
  const sortRef = useRef<{ col: SortColumn | null; order: SortOrder }>({ col: null, order: 'asc' });
  // The pair last loaded-from / written-to settings. Persisting is driven by a single
  // effect that watches {baseOutputFolder, outputFolder}, so whatever order the root
  // and folder are set in (e.g. Browse sets both), settings always receives the final
  // consistent pair — never a half-stale {newRoot, oldFolder}. Null until the initial
  // settings load, so we don't persist the loaded values back.
  const lastPersistedRef = useRef<string | null>(null);
  // Always-current viewing folder, so the URL-driven list switch can skip a redundant
  // re-fetch when the resolved target already matches what's displayed.
  const outputFolderRef = useRef('');

  useEffect(() => {
    sortRef.current = { col: sortColumn, order: sortOrder };
  }, [sortColumn, sortOrder]);

  useEffect(() => {
    outputFolderRef.current = outputFolder;
  }, [outputFolder]);

  // Persist the CURRENT {baseOutputFolder, outputFolder} pair (best-effort, debounced).
  // The route requires a non-empty outputFolder, so skip when nothing is viewed yet.
  const persistSettings = useCallback(async (base: string, output: string) => {
    if (!output) return;
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseOutputFolder: base, outputFolder: output }),
      });
    } catch {
      // best-effort — settings will re-sync on next change
    }
  }, []);

  useEffect(() => {
    if (lastPersistedRef.current === null) return; // settings not loaded yet
    if (!outputFolder) return;
    const pair = `${baseOutputFolder}\0${outputFolder}`;
    if (pair === lastPersistedRef.current) return; // unchanged from last write/load
    const timer = setTimeout(() => {
      lastPersistedRef.current = pair;
      persistSettings(baseOutputFolder, outputFolder);
    }, 400);
    return () => clearTimeout(timer);
  }, [baseOutputFolder, outputFolder, persistSettings]);

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Fetch counter: only apply the latest response
  const fetchSeqRef = useRef(0);

  const fetchVideos = useCallback(
    async (folder: string, col: SortColumn | null, order: SortOrder) => {
      const seq = ++fetchSeqRef.current;
      const params = new URLSearchParams({ outputFolder: folder });
      if (col) {
        params.set('sortColumn', col);
        params.set('sortOrder', order);
      }
      try {
        const res = await fetch(`/api/videos?${params}`);
        if (res.ok && mountedRef.current && seq === fetchSeqRef.current) {
          const data = await res.json();
          setVideos(data.videos ?? []);
          // Clear the URL when the viewed folder has no index (e.g. the root itself),
          // so a stale playlist URL doesn't linger in the field. The Header's
          // urlEditedByUser guard still protects a URL the user typed themselves.
          setCurrentPlaylistUrl(data.playlistUrl ?? '');
        }
      } catch {
        // leave existing video list unchanged on network error
      }
    },
    [],
  );

  // On mount: load settings, then fetch videos
  useEffect(() => {
    (async () => {
      let folder = '';
      let base = '';
      try {
        const res = await fetch('/api/settings');
        if (!mountedRef.current) return;
        if (res.ok) {
          const data = await res.json();
          folder = data.outputFolder ?? '';
          base = data.baseOutputFolder ?? folder;
          setOutputFolder(folder);
          setBaseOutputFolder(base);
        }
      } catch {
        // proceed with empty folder
      }
      // Mark the loaded pair so the persist effect doesn't write it straight back.
      lastPersistedRef.current = `${base}\0${folder}`;
      await fetchVideos(folder, null, 'asc');
    })();
  }, [fetchVideos]);

  const handleIngest = useCallback(
    async (playlistUrl: string, folder: string) => {
      ingestESRef.current?.close();
      ingestESRef.current = null;
      ingestJobIdRef.current = null;
      // setOutputFolder adopts the resolved target as the active viewing folder; the
      // persist effect writes the {root, target} pair to settings.
      setOutputFolder(folder);
      setSyncNote('');
      setIngest({ status: 'running', step: '', progress: 0, error: '', current: 0, total: 0, title: '' });

      let jobId: string;
      try {
        const res = await fetch('/api/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistUrl, outputFolder: folder }),
        });
        if (!mountedRef.current) return;
        if (!res.ok) throw new Error('Ingest POST failed');
        const data = await res.json();
        jobId = data.jobId;
        ingestJobIdRef.current = jobId;
      } catch (e) {
        if (mountedRef.current) {
          setIngest({ status: 'error', step: '', progress: 0, error: String(e), current: 0, total: 0, title: '' });
        }
        return;
      }

      if (!mountedRef.current) return;

      const es = new EventSource(`/api/ingest/stream?jobId=${encodeURIComponent(jobId)}`);
      ingestESRef.current = es;
      let terminal = false;

      es.onmessage = (event: MessageEvent) => {
        if (terminal || !mountedRef.current) return;
        let data: ProgressEvent;
        try {
          data = JSON.parse(event.data) as ProgressEvent;
        } catch {
          return;
        }
        if (data.type === 'step') {
          const progress =
            data.current != null && data.total != null && data.total > 0
              ? Math.min(100, Math.round((data.current / data.total) * 100))
              : 0;
          setIngest({
            status: 'running', step: data.step, progress, error: '',
            current: data.current ?? 0, total: data.total ?? 0, title: data.title ?? '',
          });
          // Refresh list each time a video is fully saved so it appears incrementally.
          if (data.step === 'Saved') {
            const { col, order } = sortRef.current;
            fetchVideos(folder, col, order);
          }
        } else if (data.type === 'error') {
          // Per-video error: show inline but keep stream open
          setIngest((prev) => ({ ...prev, error: data.log }));
        } else if (data.type === 'done' || data.type === 'cancelled') {
          terminal = true;
          es.close();
          ingestESRef.current = null;
          ingestJobIdRef.current = null;
          if (data.type === 'done' && data.total === 0) {
            setSyncNote('Sync complete — no new videos.');
          }
          setIngest(IDLE_INGEST);
          const { col, order } = sortRef.current;
          fetchVideos(folder, col, order);
        }
      };

      es.onerror = () => {
        if (terminal || !mountedRef.current) return;
        terminal = true;
        es.close();
        ingestESRef.current = null;
        ingestJobIdRef.current = null;
        setIngest({ status: 'error', step: '', progress: 0, error: 'Connection lost.', current: 0, total: 0, title: '' });
        // Fetch whatever was indexed before the connection dropped so the list stays current.
        const { col, order } = sortRef.current;
        fetchVideos(folder, col, order);
      };
    },
    [fetchVideos],
  );

  const handleSort = useCallback(
    (col: SortColumn, order: SortOrder) => {
      setSortColumn(col);
      setSortOrder(order);
      fetchVideos(outputFolder, col, order);
    },
    [fetchVideos, outputFolder],
  );

  const handleSync = useCallback((folder: string, url: string) => {
    if (url) handleIngest(url, folder);
  }, [handleIngest]);

  // The Header reports a settled root (Browse / server self-correction). Update the
  // Obsidian anchor; the persist effect writes the consistent {root, folder} pair
  // (so Browse, which also changes the viewing folder, can't persist a half-stale pair).
  const handleRootChange = useCallback((rootFolder: string) => {
    setBaseOutputFolder(rootFolder);
  }, []);

  // The Header resolved the playlist URL to a target folder — make the displayed list
  // follow it. Switching playlists shows that playlist's existing videos immediately;
  // a brand-new playlist shows empty until Fetch/Sync populates it. Skip when the
  // target already matches the viewed folder (e.g. the initial settings auto-fill).
  const handleResolvedTarget = useCallback((target: string) => {
    if (!target || target === outputFolderRef.current) return;
    setOutputFolder(target);
    const { col, order } = sortRef.current;
    fetchVideos(target, col, order);
  }, [fetchVideos]);

  // Called by Header when Browse picks a new folder — re-fetches videos so
  // currentPlaylistUrl is loaded from the folder's playlist-index.json, which
  // then auto-fills the URL field via the currentPlaylistUrl prop.
  const handleFolderChange = useCallback((folder: string) => {
    // Must update outputFolder state so BackfillOverlay, sort, archive, and
    // deep-dive all use the new folder — previously only fetchVideos was called,
    // leaving outputFolder stale at the old playlist path.
    setOutputFolder(folder);
    const { col, order } = sortRef.current;
    fetchVideos(folder, col, order);
  }, [fetchVideos]);

  const handleCancel = useCallback(async () => {
    const jobId = ingestJobIdRef.current;
    if (!jobId) return;
    try {
      await fetch('/api/ingest/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
    } catch {
      // ignore — the pipeline will emit cancelled via SSE when it checks the signal
    }
  }, []);

  const handleFilterChange = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleAnnotationChange = useCallback(
    (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote' | 'corrections' | 'tldr' | 'takeaways' | 'summaryHtml'>>) => {
      setVideos((prev) =>
        prev.map((v) => (v.id === videoId ? { ...v, ...patch } : v)),
      );
    },
    [],
  );

  const handleDeepDive = useCallback(
    async (videoId: string) => {
      const title = videos.find((v) => v.id === videoId)?.title ?? '';
      const viewUrl = `/api/html/${encodeURIComponent(videoId)}?outputFolder=${encodeURIComponent(outputFolder)}&type=deep-dive`;
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/deep-dive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputFolder }),
        });
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
        setDeepDive({ videoId, jobId: data.jobId, title, viewUrl });
        setBusyVideoId(videoId);
      } catch {
        // ignore — no status bar opened
      }
    },
    [outputFolder, videos],
  );

  const handleDeepDiveClose = useCallback(() => {
    setDeepDive(null);
    setBusyVideoId(null);
    const { col, order } = sortRef.current;
    fetchVideos(outputFolder, col, order);
  }, [fetchVideos, outputFolder]);

  const handleGenerateHtml = useCallback(
    async (videoId: string) => {
      const title = videos.find((v) => v.id === videoId)?.title ?? '';
      const viewUrl = `/api/html/${encodeURIComponent(videoId)}?outputFolder=${encodeURIComponent(outputFolder)}&type=summary`;
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/html-doc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputFolder }),
        });
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
        setHtmlJob({ videoId, jobId: data.jobId, title, viewUrl });
        setBusyVideoId(videoId);
      } catch {
        // ignore — no status bar opened
      }
    },
    [outputFolder, videos],
  );

  const handleHtmlClose = useCallback(() => {
    setHtmlJob(null);
    setBusyVideoId(null);
    const { col, order } = sortRef.current;
    fetchVideos(outputFolder, col, order); // refresh so the menu flips to View/Regenerate
  }, [fetchVideos, outputFolder]);

  const toggleSelect = useCallback((videoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
      return next;
    });
  }, []);

  const selectAllNeeding = useCallback((visible: Video[]) => {
    const needing = visible.filter((x) => videoNeedsBatchWork(x, batchMode)).map((x) => x.id);
    setSelected((prev) => {
      const allSel = needing.length > 0 && needing.every((id) => prev.has(id));
      return allSel ? new Set() : new Set(needing); // toggle: clear if all already selected
    });
  }, [batchMode]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleBatchGenerate = useCallback(async () => {
    const ids = videos.filter((x) => selected.has(x.id) && videoNeedsBatchWork(x, batchMode)).map((x) => x.id);
    if (ids.length === 0) return;
    try {
      const res = await fetch('/api/videos/batch-docs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder, videoIds: ids, mode: batchMode }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setBatchJob({ jobId: data.jobId, videoIds: new Set(ids) });
    } catch { /* best-effort */ }
  }, [videos, selected, outputFolder, batchMode]);

  // H2: refresh rows as each item completes (a 'step' means the prior video finished). The
  // fetchSeqRef race guard in fetchVideos dedupes overlapping refreshes.
  const handleBatchProgress = useCallback((e: ProgressEvent) => {
    if (e.type === 'step' || (e.type === 'error' && 'videoId' in e && e.videoId)) {
      const { col, order } = sortRef.current;
      fetchVideos(outputFolder, col, order);
    }
  }, [fetchVideos, outputFolder]);

  const handleBatchClose = useCallback(() => {
    setBatchJob(null);
    setSelected(new Set());
    const { col, order } = sortRef.current;
    fetchVideos(outputFolder, col, order);
  }, [fetchVideos, outputFolder]);

  const handleArchive = useCallback(
    async (videoId: string, action: 'archive' | 'unarchive') => {
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/archive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputFolder, action }),
        });
        if (res.ok) {
          const { col, order } = sortRef.current;
          fetchVideos(outputFolder, col, order);
        }
      } catch {
        // ignore
      }
    },
    [fetchVideos, outputFolder],
  );

  // Cleanup ingest SSE on unmount
  useEffect(() => () => { ingestESRef.current?.close(); }, []);

  // Client-side filtered list (sort comes from API, archive+filters applied here)
  const filteredVideos = videos
    .filter((v) => showArchive || !v.archived)
    .filter((v) =>
      !filters.searchText ||
      v.title.toLowerCase().includes(filters.searchText.toLowerCase()) ||
      (v.channel ?? '').toLowerCase().includes(filters.searchText.toLowerCase()),
    )
    .filter((v) => filters.language === 'all' || v.language === filters.language)
    .filter((v) => filters.videoType === 'all' || v.videoType === filters.videoType)
    .filter((v) => filters.audience === 'all' || v.audience === filters.audience)
    .filter((v) => v.overallScore >= filters.minScore)
    .filter((v) => {
      if (filters.minPersonalScore === 0) return true;
      if (v.personalScore === undefined) return true; // unscored: shown dimmed, not hidden
      return v.personalScore >= filters.minPersonalScore;
    });

  // Stats computed from filtered list
  const totalVideos = filteredVideos.length;
  const avgScore = totalVideos > 0
    ? (filteredVideos.reduce((sum, v) => sum + v.overallScore, 0) / totalVideos).toFixed(2)
    : '—';
  const koreanCount = filteredVideos.filter((v) => v.language === 'ko').length;
  const backfillCount = videos.filter((v) => v.summaryMd && !v.tldr).length;

  const selectedVideos = videos.filter((x) => selected.has(x.id));
  const willGenerateCount = selectedVideos.filter((x) => videoNeedsBatchWork(x, batchMode)).length;
  const skipCount = selectedVideos.length - willGenerateCount;

  return (
    <main className="min-h-screen bg-zinc-950">
      <Header
        defaultBaseOutputFolder={baseOutputFolder}
        defaultOutputFolder={outputFolder}
        currentPlaylistUrl={currentPlaylistUrl}
        onIngest={handleIngest}
        onSync={handleSync}
        onFolderChange={handleFolderChange}
        onRootChange={handleRootChange}
        onResolvedTarget={handleResolvedTarget}
        disabled={ingest.status === 'running'}
      />

      {ingest.status !== 'idle' && (
        <section aria-label="Ingestion progress" className="bg-zinc-900 px-6 py-3 border-b border-zinc-800">
          {ingest.status === 'running' && (
            <div role="status" aria-live="polite" className="space-y-1">
              <div className="flex items-center gap-3">
                <div
                  className="flex-1 h-2 bg-zinc-700 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={ingest.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{ width: `${ingest.progress}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums text-zinc-400 w-8 text-right">{ingest.progress}%</span>
                <button
                  type="button"
                  onClick={handleCancel}
                  aria-label="Cancel ingestion"
                  className="text-zinc-400 hover:text-zinc-100 text-xs px-2 py-1 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {ingest.total > 0 && (
                <p className="text-xs text-zinc-400">
                  New video {ingest.current} of {ingest.total}
                  {ingest.step ? ` · ${ingest.step}` : ''}
                </p>
              )}
              {ingest.title && <p className="text-xs text-zinc-500 truncate">{ingest.title}</p>}
            </div>
          )}
          {ingest.error && <p role="alert" className="text-xs text-red-400 mt-1">{ingest.error}</p>}
          {ingest.status === 'error' && !ingest.error && (
            <p role="alert" className="text-xs text-red-400">Ingestion failed.</p>
          )}
        </section>
      )}

      {syncNote && ingest.status === 'idle' && (
        <p className="px-6 py-1 text-xs text-zinc-400">{syncNote}</p>
      )}

      {/* Stats bar */}
      <section aria-label="Statistics" className="px-6 py-4 flex gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 min-w-24">
          <p className="text-xl font-semibold tabular-nums text-zinc-50">{totalVideos}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Total videos</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 min-w-24">
          <p className="text-xl font-semibold tabular-nums text-zinc-50">{avgScore}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Avg score</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 min-w-24">
          <p className="text-xl font-semibold tabular-nums text-zinc-50">{koreanCount}</p>
          <p className="text-xs text-zinc-400 mt-0.5">Korean</p>
        </div>
      </section>

      {/* Filter row */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-zinc-800">
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          backfillCount={backfillCount}
          onBackfill={() => setShowBackfill(true)}
        />
        <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer ml-4">
          <input
            type="checkbox"
            checked={showArchive}
            onChange={(e) => setShowArchive(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-blue-500"
          />
          Show Archive
        </label>
      </div>

      <div className="px-6 py-4">
        <BulkActionBar
          selectedCount={selected.size}
          willGenerateCount={willGenerateCount}
          skipCount={skipCount}
          mode={batchMode}
          onModeChange={setBatchMode}
          onGenerate={handleBatchGenerate}
          onClear={clearSelection}
        />
        <VideoList
          videos={filteredVideos}
          outputFolder={outputFolder}
          baseOutputFolder={baseOutputFolder}
          showArchive={true}
          busyVideoId={busyVideoId}
          onDeepDive={handleDeepDive}
          onArchive={handleArchive}
          onGenerateHtml={handleGenerateHtml}
          sortColumn={sortColumn}
          sortOrder={sortOrder}
          onSort={handleSort}
          minPersonalScore={filters.minPersonalScore}
          onAnnotationChange={handleAnnotationChange}
          selected={selected}
          onToggleSelect={toggleSelect}
          onSelectAllNeeding={selectAllNeeding}
          activeBatchVideoIds={batchJob?.videoIds ?? EMPTY_SET}
          batchMode={batchMode}
        />
      </div>

      {deepDive && (
        <DeepDiveStatusBar
          videoId={deepDive.videoId}
          jobId={deepDive.jobId}
          title={deepDive.title}
          viewUrl={deepDive.viewUrl}
          onClose={handleDeepDiveClose}
          onError={() => setBusyVideoId(null)}
        />
      )}
      {htmlJob && (
        <HtmlDocStatusBar
          videoId={htmlJob.videoId}
          jobId={htmlJob.jobId}
          title={htmlJob.title}
          viewUrl={htmlJob.viewUrl}
          onClose={handleHtmlClose}
          onError={() => setBusyVideoId(null)}
        />
      )}
      {batchJob && (
        <BatchDocStatusBar
          jobId={batchJob.jobId}
          onClose={handleBatchClose}
          onProgressEvent={handleBatchProgress}
        />
      )}
      {showBackfill && (
        <BackfillOverlay
          outputFolder={outputFolder}
          onClose={() => {
            setShowBackfill(false);
            fetchVideos(outputFolder, sortColumn, sortOrder);
          }}
        />
      )}
    </main>
  );
}
