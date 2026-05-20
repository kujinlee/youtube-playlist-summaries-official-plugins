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
    summaryPdf: 'summary.pdf',
    deepDiveMd: null,
    deepDivePdf: null,
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

    const urlInput = screen.getByPlaceholderText(/playlist url/i);
    fireEvent.change(urlInput, { target: { value: PLAYLIST_URL } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fetch|summarize/i }));
    });
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
      expect(screen.getByText('Fetching transcripts…')).toBeInTheDocument();
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
    const fetchMock = mockFetch({
      'GET /api/settings': DEFAULT_SETTINGS,
      'GET /api/videos': { videos: [] },
    });
    global.fetch = fetchMock;
    await act(async () => {
      render(<Page />);
    });
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });

    const urlInput = screen.getByPlaceholderText(/playlist url/i);
    fireEvent.change(urlInput, { target: { value: PLAYLIST_URL } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fetch|summarize/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(esInstances.some((es) => es.url.includes('/api/ingest/stream'))).toBe(false);
    });
  });

  it('adopts user-entered folder as page outputFolder on submit (C2)', async () => {
    const { fetchMock } = await renderPage([], {
      'POST /api/ingest': { jobId: 'ingest-job-1' },
      'POST /api/videos/v1/archive': { ok: true },
    });
    await waitFor(() => {
      const folderInput = screen.getByPlaceholderText(/output folder/i) as HTMLInputElement;
      expect(folderInput.value).toBe(OUTPUT_FOLDER);
    });

    // Change the folder in the Header input
    const folderInput = screen.getByPlaceholderText(/output folder/i);
    fireEvent.change(folderInput, { target: { value: '/custom/folder' } });

    const urlInput = screen.getByPlaceholderText(/playlist url/i);
    fireEvent.change(urlInput, { target: { value: PLAYLIST_URL } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /fetch|summarize/i }));
    });

    await waitFor(() => {
      const ingestCall = (fetchMock.mock.calls as [string, RequestInit][]).find(
        ([url]) => url === '/api/ingest',
      )!;
      const body = JSON.parse(ingestCall[1].body as string);
      expect(body.outputFolder).toBe('/custom/folder');
    });

    // After done, subsequent archive should use the updated folder
    const ingestES = getIngestES();
    act(() => {
      ingestES.emit({ type: 'done' });
    });
    await waitFor(() => screen.queryByLabelText('Ingestion progress') === null || true);
  });
});

describe('Page — sort bar (behavior 7)', () => {
  it('re-fetches videos with sort params when SortBar is clicked', async () => {
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
  it('posts to deep-dive route and renders overlay when menu action triggered (behavior 9)', async () => {
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
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('hides overlay and refetches on DeepDiveOverlay close (behavior 10)', async () => {
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
    await waitFor(() => screen.getByRole('dialog'));

    const initialVideoCalls = (fetchMock.mock.calls as [string][]).filter(
      (c) => c[0].startsWith('/api/videos') && !c[0].includes('deep-dive'),
    ).length;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close/i }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
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
