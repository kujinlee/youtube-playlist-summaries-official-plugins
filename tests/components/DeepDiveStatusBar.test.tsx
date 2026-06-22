/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DeepDiveStatusBar from '@/components/DeepDiveStatusBar';
import type { ProgressEvent } from '@/types';

// ── EventSource mock ──────────────────────────────────────────────────────────
type ESHandler = ((event: MessageEvent) => void) | null;
type ESErrorHandler = ((event: Event) => void) | null;

interface MockEventSourceInstance {
  url: string;
  onmessage: ESHandler;
  onerror: ESErrorHandler;
  close: jest.Mock;
  emit: (data: ProgressEvent) => void;
  emitError: () => void;
}

let lastInstance: MockEventSourceInstance | null = null;

class MockEventSource {
  url: string;
  onmessage: ESHandler = null;
  onerror: ESErrorHandler = null;
  close = jest.fn();

  constructor(url: string) {
    this.url = url;
    lastInstance = this as unknown as MockEventSourceInstance;
  }

  emit(data: ProgressEvent) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  emitError() {
    this.onerror?.(new Event('error'));
  }
}

beforeEach(() => {
  lastInstance = null;
  jest.useFakeTimers();
  Object.defineProperty(window, 'EventSource', {
    writable: true,
    value: MockEventSource,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const VIDEO_ID = 'abc123';
const JOB_ID = 'job-xyz';
const TITLE = 'Test Video Title';
const DEFAULT_VIEW_URL = `/api/html/${encodeURIComponent(VIDEO_ID)}?outputFolder=${encodeURIComponent('/tmp/out')}&type=deep-dive`;

function renderBar(onClose = jest.fn(), title = TITLE, viewUrl = DEFAULT_VIEW_URL) {
  return render(
    <DeepDiveStatusBar videoId={VIDEO_ID} jobId={JOB_ID} title={title} viewUrl={viewUrl} onClose={onClose} />,
  );
}

function sendEvent(event: ProgressEvent) {
  act(() => {
    lastInstance?.emit(event);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('DeepDiveStatusBar — initial state', () => {
  it('renders the status bar when mounted (role=status, not dialog)', () => {
    renderBar();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not have aria-modal attribute', () => {
    renderBar();
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-modal');
  });

  it('opens an SSE connection with encoded videoId and jobId in the URL', () => {
    renderBar();
    expect(lastInstance).not.toBeNull();
    expect(lastInstance?.url).toContain(
      `/api/videos/${encodeURIComponent(VIDEO_ID)}/deep-dive/stream`,
    );
    expect(lastInstance?.url).toContain(`jobId=${encodeURIComponent(JOB_ID)}`);
  });

  it('shows a progress bar in the running state', () => {
    renderBar();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('progress bar starts at 0', () => {
    renderBar();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows the video title', () => {
    renderBar();
    expect(screen.getByText(TITLE, { exact: false })).toBeInTheDocument();
  });

  it('shows a dismiss button', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });
});

describe('DeepDiveStatusBar — step events', () => {
  it('advances the progress bar with each step event', () => {
    renderBar();
    sendEvent({ type: 'step', step: 'Generating…', current: 2, total: 4 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows the step label text from the SSE event', () => {
    renderBar();
    sendEvent({ type: 'step', step: 'Writing PDF…', current: 1, total: 2 });
    expect(screen.getByText('Writing PDF…')).toBeInTheDocument();
  });

  it('updates progress bar when multiple step events arrive', () => {
    renderBar();
    sendEvent({ type: 'step', step: 'Step 1', current: 1, total: 4 });
    sendEvent({ type: 'step', step: 'Step 2', current: 2, total: 4 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('clamps progress to 100 when current exceeds total', () => {
    renderBar();
    sendEvent({ type: 'step', step: 'Over', current: 5, total: 3 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('DeepDiveStatusBar — done state', () => {
  it('shows "View Deep Dive doc" link on done event', () => {
    renderBar();
    sendEvent({ type: 'done' });
    expect(screen.getByRole('link', { name: /view deep dive doc/i })).toBeInTheDocument();
  });

  it('link href contains the passed viewUrl', () => {
    renderBar();
    sendEvent({ type: 'done' });
    const link = screen.getByRole('link', { name: /view deep dive doc/i });
    expect(link).toHaveAttribute('href', DEFAULT_VIEW_URL);
  });

  it('link href has type=deep-dive param', () => {
    renderBar();
    sendEvent({ type: 'done' });
    const link = screen.getByRole('link', { name: /view deep dive doc/i });
    const href = link.getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.searchParams.get('type')).toBe('deep-dive');
  });

  it('link href has truthy outputFolder param', () => {
    renderBar();
    sendEvent({ type: 'done' });
    const link = screen.getByRole('link', { name: /view deep dive doc/i });
    const href = link.getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.searchParams.get('outputFolder')).toBeTruthy();
  });

  it('link opens in a new tab with safe rel', () => {
    renderBar();
    sendEvent({ type: 'done' });
    const link = screen.getByRole('link', { name: /view deep dive doc/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('does NOT show old ✓ Done span on done event', () => {
    renderBar();
    sendEvent({ type: 'done' });
    expect(screen.queryByText('✓ Done')).toBeNull();
  });

  it('progress bar reaches 100% on done event', () => {
    renderBar();
    sendEvent({ type: 'done' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('closes the SSE connection on done', () => {
    renderBar();
    sendEvent({ type: 'done' });
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('ignores step events arriving after done', () => {
    renderBar();
    sendEvent({ type: 'done' });
    sendEvent({ type: 'step', step: 'Late step', current: 1, total: 2 });
    expect(screen.queryByText('Late step')).toBeNull();
    expect(screen.getByRole('link', { name: /view deep dive doc/i })).toBeInTheDocument();
  });

  it('calls onClose automatically after 4 seconds on done', () => {
    const onClose = jest.fn();
    renderBar(onClose);
    sendEvent({ type: 'done' });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(4000); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-dismiss before 4 seconds have elapsed', () => {
    const onClose = jest.fn();
    renderBar(onClose);
    sendEvent({ type: 'done' });
    act(() => { jest.advanceTimersByTime(3999); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels auto-dismiss timer when component unmounts before 4s', () => {
    const onClose = jest.fn();
    const { unmount } = renderBar(onClose);
    sendEvent({ type: 'done' });
    unmount();
    act(() => { jest.advanceTimersByTime(4000); });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('DeepDiveStatusBar — error state', () => {
  it('shows the error message on error event', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'API quota exceeded' });
    expect(screen.getByText(/API quota exceeded/)).toBeInTheDocument();
  });

  it('shows a "Show Logs" button on error', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'Something broke' });
    expect(screen.getByRole('button', { name: /show logs/i })).toBeInTheDocument();
  });

  it('hides the log panel by default on error', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'Details here' });
    expect(screen.queryByRole('region', { name: /logs/i })).toBeNull();
  });

  it('expands the log panel when "Show Logs" is clicked', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'Details here' });
    fireEvent.click(screen.getByRole('button', { name: /show logs/i }));
    const logPanel = screen.getByRole('region', { name: /logs/i });
    expect(logPanel).toBeInTheDocument();
    expect(logPanel).toHaveTextContent('Details here');
  });

  it('collapses the log panel when "Hide Logs" is clicked', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'Details here' });
    fireEvent.click(screen.getByRole('button', { name: /show logs/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide logs/i }));
    expect(screen.queryByRole('region', { name: /logs/i })).toBeNull();
  });

  it('Show Logs button exposes aria-expanded state', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'Err' });
    const btn = screen.getByRole('button', { name: /show logs/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: /hide logs/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('closes the SSE connection on error', () => {
    renderBar();
    sendEvent({ type: 'error', log: 'Boom' });
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('shows connection-lost error when EventSource onerror fires', () => {
    renderBar();
    act(() => { lastInstance?.emitError(); });
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('does NOT auto-dismiss on error (stays until manually dismissed)', () => {
    const onClose = jest.fn();
    renderBar(onClose);
    sendEvent({ type: 'error', log: 'Broke' });
    act(() => { jest.advanceTimersByTime(10000); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onError when an error event arrives (so the menu can clear its busy state)', () => {
    const onError = jest.fn();
    render(
      <DeepDiveStatusBar videoId={VIDEO_ID} jobId={JOB_ID} title={TITLE} viewUrl={DEFAULT_VIEW_URL} onClose={jest.fn()} onError={onError} />,
    );
    sendEvent({ type: 'error', log: 'Broke' });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('calls onError when EventSource onerror fires (connection lost)', () => {
    const onError = jest.fn();
    render(
      <DeepDiveStatusBar videoId={VIDEO_ID} jobId={JOB_ID} title={TITLE} viewUrl={DEFAULT_VIEW_URL} onClose={jest.fn()} onError={onError} />,
    );
    act(() => { lastInstance?.emitError(); });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onError on done or step events', () => {
    const onError = jest.fn();
    render(
      <DeepDiveStatusBar videoId={VIDEO_ID} jobId={JOB_ID} title={TITLE} viewUrl={DEFAULT_VIEW_URL} onClose={jest.fn()} onError={onError} />,
    );
    sendEvent({ type: 'step', step: 'Working', current: 1, total: 2 });
    sendEvent({ type: 'done' });
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('DeepDiveStatusBar — SSE lifecycle', () => {
  it('closes the SSE connection when the component unmounts', () => {
    const { unmount } = renderBar();
    unmount();
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('opens a new SSE connection and resets state when jobId changes', () => {
    const { rerender } = render(
      <DeepDiveStatusBar videoId={VIDEO_ID} jobId="job-1" title={TITLE} viewUrl={DEFAULT_VIEW_URL} onClose={jest.fn()} />,
    );
    const firstInstance = lastInstance;
    sendEvent({ type: 'done' });
    expect(screen.getByRole('link', { name: /view deep dive doc/i })).toBeInTheDocument();

    act(() => {
      rerender(
        <DeepDiveStatusBar videoId={VIDEO_ID} jobId="job-2" title={TITLE} viewUrl={DEFAULT_VIEW_URL} onClose={jest.fn()} />,
      );
    });

    expect(firstInstance?.close).toHaveBeenCalled();
    expect(lastInstance).not.toBe(firstInstance);
    expect(screen.queryByRole('link', { name: /view deep dive doc/i })).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('handles malformed SSE payload without crashing', () => {
    renderBar();
    act(() => {
      lastInstance?.onmessage?.({ data: 'not-json{{{' } as MessageEvent);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('calls onClose when Dismiss button is clicked', () => {
    const onClose = jest.fn();
    renderBar(onClose);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Dismiss clicked in done state', () => {
    const onClose = jest.fn();
    renderBar(onClose);
    sendEvent({ type: 'done' });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Dismiss clicked in error state', () => {
    const onClose = jest.fn();
    renderBar(onClose);
    sendEvent({ type: 'error', log: 'Broke' });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
