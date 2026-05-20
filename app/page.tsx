'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressEvent, SortColumn, SortOrder, Video } from '@/types';
import DeepDiveOverlay from '@/components/DeepDiveOverlay';
import Header from '@/components/Header';
import SortBar from '@/components/SortBar';
import VideoList from '@/components/VideoList';

type IngestStatus = 'idle' | 'running' | 'error';

interface IngestState {
  status: IngestStatus;
  step: string;
  progress: number;
  error: string;
}

const IDLE_INGEST: IngestState = { status: 'idle', step: '', progress: 0, error: '' };

export default function Page() {
  const [outputFolder, setOutputFolder] = useState('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [showArchive, setShowArchive] = useState(false);
  const [ingest, setIngest] = useState<IngestState>(IDLE_INGEST);
  const [deepDive, setDeepDive] = useState<{ videoId: string; jobId: string } | null>(null);

  const ingestESRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);
  // Always-current sort values for use inside async callbacks
  const sortRef = useRef<{ col: SortColumn | null; order: SortOrder }>({ col: null, order: 'asc' });

  useEffect(() => {
    sortRef.current = { col: sortColumn, order: sortOrder };
  }, [sortColumn, sortOrder]);

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
      try {
        const res = await fetch('/api/settings');
        if (!mountedRef.current) return;
        if (res.ok) {
          const data = await res.json();
          folder = data.outputFolder ?? '';
          setOutputFolder(folder);
        }
      } catch {
        // proceed with empty folder
      }
      await fetchVideos(folder, null, 'asc');
    })();
  }, [fetchVideos]);

  const handleIngest = useCallback(
    async (playlistUrl: string, folder: string) => {
      ingestESRef.current?.close();
      ingestESRef.current = null;
      setOutputFolder(folder);
      setIngest({ status: 'running', step: '', progress: 0, error: '' });

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
      } catch (e) {
        if (mountedRef.current) {
          setIngest({ status: 'error', step: '', progress: 0, error: String(e) });
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
          setIngest({ status: 'running', step: data.step, progress, error: '' });
        } else if (data.type === 'error') {
          // Per-video error: show inline but keep stream open
          setIngest((prev) => ({ ...prev, error: data.log }));
        } else if (data.type === 'done') {
          terminal = true;
          es.close();
          ingestESRef.current = null;
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
        setIngest({ status: 'error', step: '', progress: 0, error: 'Connection lost.' });
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

  const handleDeepDive = useCallback(
    async (videoId: string) => {
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/deep-dive`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputFolder }),
        });
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json();
        setDeepDive({ videoId, jobId: data.jobId });
      } catch {
        // ignore — no overlay opened
      }
    },
    [outputFolder],
  );

  const handleDeepDiveClose = useCallback(() => {
    setDeepDive(null);
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

  return (
    <main>
      <Header
        defaultOutputFolder={outputFolder}
        onIngest={handleIngest}
        disabled={ingest.status === 'running'}
      />

      {ingest.status !== 'idle' && (
        <section aria-label="Ingestion progress">
          {ingest.status === 'running' && (
            <div role="status" aria-live="polite">
              <progress
                role="progressbar"
                aria-valuenow={ingest.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                value={ingest.progress}
                max={100}
              />
              {ingest.step && <p>{ingest.step}</p>}
            </div>
          )}
          {ingest.error && <p role="alert">{ingest.error}</p>}
          {ingest.status === 'error' && !ingest.error && (
            <p role="alert">Ingestion failed.</p>
          )}
        </section>
      )}

      <SortBar activeColumn={sortColumn} order={sortOrder} onSort={handleSort} />

      <label>
        <input
          type="checkbox"
          checked={showArchive}
          onChange={(e) => setShowArchive(e.target.checked)}
        />
        {' '}Show Archive
      </label>

      <VideoList
        videos={videos}
        outputFolder={outputFolder}
        showArchive={showArchive}
        onDeepDive={handleDeepDive}
        onArchive={handleArchive}
      />

      {deepDive && (
        <DeepDiveOverlay
          videoId={deepDive.videoId}
          jobId={deepDive.jobId}
          onClose={handleDeepDiveClose}
        />
      )}
    </main>
  );
}
