/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import Page from '@/app/page';
import type { Video, ProgressEvent, SortColumn, SortOrder } from '@/types';

// ── EventSource mock ──────────────────────────────────────────────────────────
type ESHandler = ((event: MessageEvent) => void) | null;
type ESErrorHandler = ((event: Event) => void) | null;

interface MockESInstance {
  url: string;
  onmessage: ESHandler;
  onerror: ESErrorHandler;
  close: jest.Mock;
  emit: (data: ProgressEvent) => void;
  emitError: () => void;
}

const esInstances: MockESInstance[] = [];

class MockEventSource {
  url: string;
  onmessage: ESHandler = null;
  onerror: ESErrorHandler = null;
  close = jest.fn();

  constructor(url: string) {
    this.url = url;
    esInstances.push(this as unknown as MockESInstance);
  }

  emit(data: ProgressEvent) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitError() {
    this.onerror?.(new Event('error'));
  }
}

// ── Fetch mock helpers ────────────────────────────────────────────────────────
const OUTPUT_FOLDER = '/vault/output';
const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLtest';
const DEFAULT_SETTINGS = { outputFolder: OUTPUT_FOLDER };

function makeVideo(id: string, overrides: Partial<Video> = {}): Video {
  return {
    id,
    title: `Video ${id}`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
    language: 'en',
    durationSeconds: 300,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: 'summary.md',
    deepDiveMd: null,
    tldr: 'Quick reference content',
    processedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockFetch(handlers: Record<string, unknown>) {
  return jest.fn((url: string, options?: RequestInit) => {
    const method = (options?.method ?? 'GET').toUpperCase();
    // Exact match first, then prefix match
    const baseUrl = url.split('?')[0];
    const key = `${method} ${baseUrl}`;
    const match =
      handlers[key] !== undefined
        ? ([key, handlers[key]] as [string, unknown])
        : Object.entries(handlers).find(([k]) => key.startsWith(k));
    if (!match) {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: `No handler for ${key}` }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(match[1]) });
  }) as jest.Mock;
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────
beforeEach(() => {
  esInstances.length = 0;
  Object.defineProperty(window, 'EventSource', { writable: true, value: MockEventSource });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Helper: render page with default fetch mocks ──────────────────────────────
async function renderPage(videos: Video[] = [], extraHandlers: Record<string, unknown> = {}) {
  const fetchMock = mockFetch({
    'GET /api/settings': DEFAULT_SETTINGS,
    'GET /api/videos': { videos },
    // The Header now derives the write target from (url, root) via this endpoint.
    // Default: target === OUTPUT_FOLDER so existing outputFolder assertions hold.
    'GET /api/resolve-folder': { root: OUTPUT_FOLDER, outputFolder: OUTPUT_FOLDER },
    'POST /api/settings': { ok: true },
    ...extraHandlers,
  });
  global.fetch = fetchMock;

  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<Page />);
  });
  return { result: result!, fetchMock };
}

function getIngestES() {
  return esInstances.find((es) => es.url.includes('/api/ingest/stream'))!;
}

const fetchButton = () => screen.getByRole('button', { name: /fetch|summarize/i });

// Type a playlist URL, wait for the debounced resolve to enable Fetch (the button
// only enables once a fresh target is resolved), then click it.
async function typeUrlAndFetch(url: string) {
  fireEvent.change(screen.getByPlaceholderText(/playlist url/i), { target: { value: url } });
  await waitFor(() => expect(fetchButton()).toBeEnabled());
  await act(async () => {
    fireEvent.click(fetchButton());
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Page — mount (behaviors 1–2)', () => {
  it('fetches settings on mount', async () => {
    const { fetchMock } = await renderPage();
    expect(fetchMock).toHaveBeenCalledWith('/api/settings');
  });

  it('fetches videos on mount with outputFolder from settings', async () => {
    const { fetchMock } = await renderPage();
    const videoCalls = (fetchMock.mock.calls as [string][]).filter((c) =>
      c[0].startsWith('/api/videos'),
    );
    expect(videoCalls.length).toBeGreaterThan(0);
    expect(videoCalls[0][0]).toContain(`outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}`);
  });

  it('renders video titles after mount fetch', async () => {
    await renderPage([makeVideo('v1'), makeVideo('v2')]);
    await waitFor(() => {
      expect(screen.getByText('Video v1')).toBeInTheDocument();
      expect(screen.getByText('Video v2')).toBeInTheDocument();
    });
  });

  it('renders nothing when video list is empty', async () => {
    await renderPage([]);
    await waitFor(() => {
      expect(screen.queryByRole('list')).toBeNull();
    });
  });

  it('Header output folder input is populated with settings value (C1)', async () => {
    await renderPage();
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });
  });
});

describe('Page — ingest (behaviors 3–6)', () => {
  async function setupIngest(videos: Video[] = []) {
    const { fetchMock } = await renderPage(videos, {
      'POST /api/ingest': { jobId: 'ingest-job-1' },
    });
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });

    await typeUrlAndFetch(PLAYLIST_URL);
    return { fetchMock };
  }

  it('posts to /api/ingest with playlistUrl and outputFolder in body (behavior 3, I9)', async () => {
    const { fetchMock } = await setupIngest();
    await waitFor(() => {
      const ingestCall = (fetchMock.mock.calls as [string, RequestInit][]).find(
        ([url]) => url === '/api/ingest',
      )!;
      const body = JSON.parse(ingestCall[1].body as string);
      expect(body.playlistUrl).toBe(PLAYLIST_URL);
      expect(body.outputFolder).toBe(OUTPUT_FOLDER);
    });
  });

  it('opens ingest SSE stream with jobId in URL after POST (behavior 3)', async () => {
    await setupIngest();
    await waitFor(() => {
      const ingestES = getIngestES();
      expect(ingestES).toBeDefined();
      expect(ingestES.url).toContain('jobId=ingest-job-1');
    });
  });

  it('disables submit button during ingest (I3)', async () => {
    await setupIngest();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /fetch|summarize/i })).toBeDisabled();
    });
  });

  it('shows ingest progress on step event (behavior 4)', async () => {
    await setupIngest();
    const ingestES = getIngestES();
    act(() => {
      ingestES.emit({ type: 'step', step: 'Fetching transcripts…', current: 1, total: 5 });
    });
    await waitFor(() => {
      // New format: "New video N of M · step"
      expect(screen.getByText(/New video 1 of 5 · Fetching transcripts…/)).toBeInTheDocument();
    });
  });

  it('refreshes video list, hides progress, re-enables button on done (behavior 5)', async () => {
    const { fetchMock } = await setupIngest([makeVideo('v1')]);
    const ingestES = getIngestES();

    act(() => {
      ingestES.emit({ type: 'step', step: 'Working…', current: 1, total: 2 });
    });
    act(() => {
      ingestES.emit({ type: 'done' });
    });

    await waitFor(() => {
      expect(ingestES.close).toHaveBeenCalled();
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) => c[0].startsWith('/api/videos') && !c[0].includes('ingest'),
      );
      expect(videoCalls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Ingestion progress')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /fetch|summarize/i })).not.toBeDisabled();
    });
  });

  it('fetches videos after connection loss so already-indexed videos are displayed (behavior 6b)', async () => {
    const { fetchMock } = await setupIngest([makeVideo('v1')]);
    const ingestES = getIngestES();

    const videoCallsBefore = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos'),
    ).length;

    act(() => { ingestES.emitError(); });

    await waitFor(() => {
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) => c[0].startsWith('/api/videos'),
      ).length;
      expect(videoCalls).toBeGreaterThan(videoCallsBefore);
    });
    // Error message still shown so user knows the stream dropped
    expect(screen.getByText('Connection lost.')).toBeInTheDocument();
  });

  it('fetches videos on each "Saved" step event for incremental display (behavior 6c)', async () => {
    const { fetchMock } = await setupIngest();
    const ingestES = getIngestES();

    const videoCallsBefore = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos'),
    ).length;

    act(() => {
      ingestES.emit({ type: 'step', step: 'Saved', current: 1, total: 5 });
    });

    await waitFor(() => {
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) => c[0].startsWith('/api/videos'),
      ).length;
      expect(videoCalls).toBeGreaterThan(videoCallsBefore);
    });
  });

  it('does not fetch videos on non-Saved step events (behavior 6c negative)', async () => {
    const { fetchMock } = await setupIngest();
    const ingestES = getIngestES();

    const videoCallsBefore = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos'),
    ).length;

    act(() => {
      ingestES.emit({ type: 'step', step: 'Fetching transcript…', current: 1, total: 5 });
    });
    act(() => {
      ingestES.emit({ type: 'step', step: 'Generating summary…', current: 2, total: 5 });
    });

    // Allow any microtasks to flush
    await act(async () => {});

    const videoCallsAfter = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos'),
    ).length;
    expect(videoCallsAfter).toBe(videoCallsBefore);
  });

  it('shows per-video error inline but keeps stream open (behavior 6, C3)', async () => {
    await setupIngest();
    const ingestES = getIngestES();
    act(() => {
      ingestES.emit({ type: 'error', log: 'Video abc123 failed' });
    });
    await waitFor(() => {
      expect(screen.getByText(/Video abc123 failed/)).toBeInTheDocument();
      expect(ingestES.close).not.toHaveBeenCalled();
    });
  });

  it('shows error and closes stream on ingest POST failure (I2)', async () => {
    // POST /api/ingest has no handler → mockFetch returns ok:false → ingest fails.
    const fetchMock = mockFetch({
      'GET /api/settings': DEFAULT_SETTINGS,
      'GET /api/videos': { videos: [] },
      'GET /api/resolve-folder': { root: OUTPUT_FOLDER, outputFolder: OUTPUT_FOLDER },
    });
    global.fetch = fetchMock;
    await act(async () => {
      render(<Page />);
    });
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });

    await typeUrlAndFetch(PLAYLIST_URL);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(esInstances.some((es) => es.url.includes('/api/ingest/stream'))).toBe(false);
    });
  });

  it('threads the server-resolved target into the ingest outputFolder and adopts it (C2/P3)', async () => {
    const TARGET = '/vault/output/agentic-ai/raw';
    const { fetchMock } = await renderPage([], {
      'POST /api/ingest': { jobId: 'ingest-job-1' },
      // Resolver derives a target distinct from the root field.
      'GET /api/resolve-folder': { root: OUTPUT_FOLDER, outputFolder: TARGET },
    });
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });

    await typeUrlAndFetch(PLAYLIST_URL);

    // onIngest receives the resolved TARGET, not the root field value.
    await waitFor(() => {
      const ingestCall = (fetchMock.mock.calls as [string, RequestInit][]).find(
        ([url]) => url === '/api/ingest',
      )!;
      const body = JSON.parse(ingestCall[1].body as string);
      expect(body.outputFolder).toBe(TARGET);
    });

    // The page adopts the target as its viewing folder → the post-done list refresh
    // queries /api/videos for the target.
    const ingestES = getIngestES();
    act(() => {
      ingestES.emit({ type: 'done' });
    });
    await waitFor(() => {
      const videoCalls = (fetchMock.mock.calls as [string][]).filter((c) =>
        c[0].startsWith('/api/videos'),
      );
      expect(videoCalls.some((c) => c[0].includes(encodeURIComponent(TARGET)))).toBe(true);
    });
  });
});

describe('Page — sort column headers (behavior 7)', () => {
  it('re-fetches videos with sort params when a column header is clicked', async () => {
    const { fetchMock } = await renderPage([makeVideo('v1')]);
    await waitFor(() => screen.getByText('Video v1'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /overall/i }));
    });

    await waitFor(() => {
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) => c[0].startsWith('/api/videos') && !c[0].includes('deep-dive') && !c[0].includes('archive'),
      );
      const latestCall = videoCalls[videoCalls.length - 1][0];
      expect(latestCall).toContain('sortColumn=overall');
    });
  });
});

describe('Page — show archive (behavior 8)', () => {
  it('toggles VideoList showArchive when checkbox changes', async () => {
    await renderPage([makeVideo('a1', { archived: true }), makeVideo('v1')]);
    await waitFor(() => screen.getByText('Video v1'));

    expect(screen.queryByText('Video a1')).toBeNull();

    const checkbox = screen.getByRole('checkbox', { name: /show archive/i });
    await act(async () => {
      fireEvent.click(checkbox);
    });

    await waitFor(() => {
      expect(screen.getByText('Video a1')).toBeInTheDocument();
    });
  });
});

describe('Page — deep dive (behaviors 9–10)', () => {
  it('posts to deep-dive route and renders status bar when menu action triggered (behavior 9)', async () => {
    const { fetchMock } = await renderPage([makeVideo('v1')], {
      'POST /api/videos/v1/deep-dive': { jobId: 'dd-job-1' },
    });
    await waitFor(() => screen.getByText('Video v1'));

    const menuBtn = screen.getByRole('button', { name: /menu/i });
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /deep dive/i }));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/videos/v1/deep-dive',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(screen.getByRole('status', { name: /deep dive progress/i })).toBeInTheDocument();
    });
  });

  it('hides status bar and refetches on dismiss (behavior 10)', async () => {
    const { fetchMock } = await renderPage([makeVideo('v1')], {
      'POST /api/videos/v1/deep-dive': { jobId: 'dd-job-1' },
    });
    await waitFor(() => screen.getByText('Video v1'));

    const menuBtn = screen.getByRole('button', { name: /menu/i });
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /deep dive/i }));
    });
    await waitFor(() => screen.getByRole('status', { name: /deep dive progress/i }));

    const initialVideoCalls = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos') && !c[0].includes('deep-dive'),
    ).length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /deep dive progress/i })).toBeNull();
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) => c[0].startsWith('/api/videos') && !c[0].includes('deep-dive'),
      ).length;
      expect(videoCalls).toBeGreaterThan(initialVideoCalls);
    });
  });
});

describe('Page — archive (behavior 11)', () => {
  it('posts archive action and refetches video list (behavior 11)', async () => {
    const { fetchMock } = await renderPage([makeVideo('v1')], {
      'POST /api/videos/v1/archive': { ok: true },
    });
    await waitFor(() => screen.getByText('Video v1'));

    const menuBtn = screen.getByRole('button', { name: /menu/i });
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/videos/v1/archive',
        expect.objectContaining({ method: 'POST' }),
      );
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) =>
          c[0].startsWith('/api/videos') &&
          !c[0].includes('archive') &&
          !c[0].includes('deep-dive'),
      );
      expect(videoCalls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Page — cancel (behavior 6d)', () => {
  async function setupIngestRunning() {
    const { fetchMock } = await renderPage([], {
      'POST /api/ingest': { jobId: 'ingest-job-1' },
      'POST /api/ingest/cancel': { ok: true },
    });
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });
    await typeUrlAndFetch(PLAYLIST_URL);
    return { fetchMock };
  }

  it('shows cancel button while ingestion is running', async () => {
    await setupIngestRunning();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });
  });

  it('does not show cancel button when idle', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('posts to /api/ingest/cancel with correct jobId when cancel button is clicked', async () => {
    const { fetchMock } = await setupIngestRunning();
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });
    await waitFor(() => {
      const cancelCall = (fetchMock.mock.calls as [string, RequestInit][]).find(
        ([url]) => url === '/api/ingest/cancel',
      )!;
      expect(cancelCall).toBeDefined();
      const body = JSON.parse(cancelCall[1].body as string);
      expect(body.jobId).toBe('ingest-job-1');
    });
  });

  it('resets ingest to idle, closes stream, and fetches videos on cancelled SSE event', async () => {
    const { fetchMock } = await setupIngestRunning();
    const ingestES = getIngestES();

    const videoCallsBefore = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos'),
    ).length;

    act(() => {
      ingestES.emit({ type: 'cancelled' });
    });

    await waitFor(() => {
      expect(ingestES.close).toHaveBeenCalled();
      expect(screen.queryByLabelText('Ingestion progress')).not.toBeInTheDocument();
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) => c[0].startsWith('/api/videos'),
      ).length;
      expect(videoCalls).toBeGreaterThan(videoCallsBefore);
    });
  });
});

describe('Page — minPersonalScore filtering (behavior 13)', () => {
  it('hides a video whose personalScore is below minPersonalScore', async () => {
    await renderPage([makeVideo('v1', { title: 'Low Scorer', personalScore: 2 })]);
    await waitFor(() => screen.getByText('Low Scorer'));

    const select = screen.getByRole('combobox', { name: /my score/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: '3' } });
    });

    await waitFor(() => {
      expect(screen.queryByText('Low Scorer')).toBeNull();
    });
  });

  it('shows an unscored video when minPersonalScore > 0 (shown dimmed, not hidden)', async () => {
    await renderPage([makeVideo('v2', { title: 'No Score', personalScore: undefined })]);
    await waitFor(() => screen.getByText('No Score'));

    const select = screen.getByRole('combobox', { name: /my score/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: '3' } });
    });

    await waitFor(() => {
      expect(screen.getByText('No Score')).toBeInTheDocument();
    });
  });

  it('shows a video whose personalScore meets the threshold', async () => {
    await renderPage([makeVideo('v3', { title: 'High Scorer', personalScore: 4 })]);
    await waitFor(() => screen.getByText('High Scorer'));

    const select = screen.getByRole('combobox', { name: /my score/i });
    await act(async () => {
      fireEvent.change(select, { target: { value: '3' } });
    });

    await waitFor(() => {
      expect(screen.getByText('High Scorer')).toBeInTheDocument();
    });
  });
});

describe('Page — sort persistence (behavior 12)', () => {
  it('uses current sortColumn/sortOrder when refetching after archive', async () => {
    const { fetchMock } = await renderPage([makeVideo('v1')], {
      'POST /api/videos/v1/archive': { ok: true },
    });
    await waitFor(() => screen.getByText('Video v1'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /overall/i }));
    });

    const menuBtn = screen.getByRole('button', { name: /menu/i });
    await act(async () => {
      fireEvent.click(menuBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    });

    await waitFor(() => {
      const videoCalls = (fetchMock.mock.calls as [string][]).filter(
        (c) =>
          c[0].startsWith('/api/videos') &&
          !c[0].includes('archive') &&
          !c[0].includes('deep-dive'),
      );
      const lastCall = videoCalls[videoCalls.length - 1][0];
      expect(lastCall).toContain('sortColumn=overall');
    });
  });
});

describe('Page — list follows playlist URL', () => {
  it('switches the displayed list to the resolved target when the URL changes', async () => {
    const NEW_TARGET = '/vault/output/other-playlist/raw';
    const { fetchMock } = await renderPage([], {
      'GET /api/resolve-folder': { root: OUTPUT_FOLDER, outputFolder: NEW_TARGET },
    });
    await waitFor(() => {
      expect((screen.getByPlaceholderText(/output folder/i) as HTMLInputElement).value).toBe(OUTPUT_FOLDER);
    });

    fireEvent.change(screen.getByPlaceholderText(/playlist url/i), { target: { value: PLAYLIST_URL } });

    // After the debounced resolve, the page re-fetches videos for the RESOLVED target
    // (the list follows the URL), not just the original settings folder.
    await waitFor(
      () => {
        const videoCalls = (fetchMock.mock.calls as [string][]).filter((c) => c[0].startsWith('/api/videos'));
        expect(videoCalls.some((c) => c[0].includes(encodeURIComponent(NEW_TARGET)))).toBe(true);
      },
      { timeout: 2000 },
    );
  });
});

describe('Page — browse persistence (P2)', () => {
  const originalPlatform = navigator.platform;
  afterEach(() => {
    Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
  });

  it('persists the consistent {newRoot, pickedFolder} pair after Browse (not a half-stale pair)', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const PICKED = '/vault/output/cs146s/raw';
    const NEW_ROOT = '/vault/output';
    const { fetchMock } = await renderPage([], {
      'GET /api/pick-folder': { folderPath: PICKED },
      'GET /api/normalize-folder': { root: NEW_ROOT },
    });
    await waitFor(() => screen.getByRole('button', { name: /browse/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /browse/i }));
    });

    // The debounced persist effect writes the FINAL consistent pair — proving the root
    // (NEW_ROOT) and the just-viewed folder (PICKED) are persisted together, not
    // {NEW_ROOT, oldFolder}.
    await waitFor(
      () => {
        const settingsPost = (fetchMock.mock.calls as [string, RequestInit?][])
          .filter(([url, opts]) => url === '/api/settings' && (opts?.method ?? 'GET').toUpperCase() === 'POST')
          .pop();
        expect(settingsPost).toBeDefined();
        const body = JSON.parse(settingsPost![1]!.body as string);
        expect(body).toEqual({ baseOutputFolder: NEW_ROOT, outputFolder: PICKED });
      },
      { timeout: 2000 },
    );
  });
});
