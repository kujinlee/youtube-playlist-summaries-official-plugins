/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DeepDiveOverlay from '@/components/DeepDiveOverlay';
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
  Object.defineProperty(window, 'EventSource', {
    writable: true,
    value: MockEventSource,
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const VIDEO_ID = 'abc123';
const JOB_ID = 'job-xyz';

function renderOverlay(onClose = jest.fn()) {
  return render(
    <DeepDiveOverlay videoId={VIDEO_ID} jobId={JOB_ID} onClose={onClose} />,
  );
}

function sendEvent(event: ProgressEvent) {
  act(() => {
    lastInstance?.emit(event);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('DeepDiveOverlay — initial state', () => {
  it('renders the overlay when mounted', () => {
    renderOverlay();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens an SSE connection with encoded videoId and jobId in the URL', () => {
    renderOverlay();
    expect(lastInstance).not.toBeNull();
    expect(lastInstance?.url).toContain(
      `/api/videos/${encodeURIComponent(VIDEO_ID)}/deep-dive/stream`,
    );
    expect(lastInstance?.url).toContain(`jobId=${encodeURIComponent(JOB_ID)}`);
  });

  it('shows a progress bar in the running state', () => {
    renderOverlay();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('progress bar starts at 0', () => {
    renderOverlay();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });
});

describe('DeepDiveOverlay — step events', () => {
  it('advances the progress bar with each step event', () => {
    renderOverlay();
    sendEvent({ type: 'step', step: 'Generating…', current: 2, total: 4 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('shows the step label text from the SSE event', () => {
    renderOverlay();
    sendEvent({ type: 'step', step: 'Writing PDF…', current: 1, total: 2 });
    expect(screen.getByText('Writing PDF…')).toBeInTheDocument();
  });

  it('updates progress bar when multiple step events arrive', () => {
    renderOverlay();
    sendEvent({ type: 'step', step: 'Step 1', current: 1, total: 4 });
    sendEvent({ type: 'step', step: 'Step 2', current: 2, total: 4 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('clamps progress to 100 when current exceeds total', () => {
    renderOverlay();
    sendEvent({ type: 'step', step: 'Over', current: 5, total: 3 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('DeepDiveOverlay — done state', () => {
  it('shows a success message on done event', () => {
    renderOverlay();
    sendEvent({ type: 'done' });
    expect(screen.getByText(/done|complete|✓/i)).toBeInTheDocument();
  });

  it('progress bar reaches 100% on done event', () => {
    renderOverlay();
    sendEvent({ type: 'done' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('closes the SSE connection on done', () => {
    renderOverlay();
    sendEvent({ type: 'done' });
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('ignores step events arriving after done', () => {
    renderOverlay();
    sendEvent({ type: 'done' });
    sendEvent({ type: 'step', step: 'Late step', current: 1, total: 2 });
    expect(screen.queryByText('Late step')).toBeNull();
    expect(screen.getByText(/✓/)).toBeInTheDocument();
  });
});

describe('DeepDiveOverlay — error state', () => {
  it('shows the error message on error event', () => {
    renderOverlay();
    sendEvent({ type: 'error', log: 'API quota exceeded' });
    expect(screen.getByText(/API quota exceeded/)).toBeInTheDocument();
  });

  it('shows a "Show Logs" button on error', () => {
    renderOverlay();
    sendEvent({ type: 'error', log: 'Something broke' });
    expect(screen.getByRole('button', { name: /show logs/i })).toBeInTheDocument();
  });

  it('hides the log panel by default on error', () => {
    renderOverlay();
    sendEvent({ type: 'error', log: 'Details here' });
    expect(screen.queryByRole('region', { name: /logs/i })).toBeNull();
  });

  it('expands the log panel when "Show Logs" is clicked', () => {
    renderOverlay();
    sendEvent({ type: 'error', log: 'Details here' });
    fireEvent.click(screen.getByRole('button', { name: /show logs/i }));
    const logPanel = screen.getByRole('region', { name: /logs/i });
    expect(logPanel).toBeInTheDocument();
    expect(logPanel).toHaveTextContent('Details here');
  });

  it('collapses the log panel when "Hide Logs" is clicked', () => {
    renderOverlay();
    sendEvent({ type: 'error', log: 'Details here' });
    fireEvent.click(screen.getByRole('button', { name: /show logs/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide logs/i }));
    expect(screen.queryByRole('region', { name: /logs/i })).toBeNull();
  });

  it('Show Logs button exposes aria-expanded state', () => {
    renderOverlay();
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
    renderOverlay();
    sendEvent({ type: 'error', log: 'Boom' });
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('shows connection-lost error when EventSource onerror fires', () => {
    renderOverlay();
    act(() => {
      lastInstance?.emitError();
    });
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
    expect(lastInstance?.close).toHaveBeenCalled();
  });
});

describe('DeepDiveOverlay — SSE lifecycle', () => {
  it('closes the SSE connection when the component unmounts', () => {
    const { unmount } = renderOverlay();
    unmount();
    expect(lastInstance?.close).toHaveBeenCalled();
  });

  it('opens a new SSE connection and resets state when jobId changes', () => {
    const { rerender } = render(
      <DeepDiveOverlay videoId={VIDEO_ID} jobId="job-1" onClose={jest.fn()} />,
    );
    const firstInstance = lastInstance;
    sendEvent({ type: 'done' });
    expect(screen.getByText(/✓/)).toBeInTheDocument();

    act(() => {
      rerender(<DeepDiveOverlay videoId={VIDEO_ID} jobId="job-2" onClose={jest.fn()} />);
    });

    expect(firstInstance?.close).toHaveBeenCalled();
    expect(lastInstance).not.toBe(firstInstance);
    // State reset: progress bar back, done message gone
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('handles malformed SSE payload without crashing', () => {
    renderOverlay();
    act(() => {
      lastInstance?.onmessage?.({ data: 'not-json{{{' } as MessageEvent);
    });
    // Component should still render normally (running state)
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', () => {
    const onClose = jest.fn();
    renderOverlay(onClose);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
