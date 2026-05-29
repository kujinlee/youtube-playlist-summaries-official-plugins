/** @jest-environment jsdom */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import BackfillOverlay from '@/components/BackfillOverlay';

const OUTPUT_FOLDER = '/tmp/vault';

// Minimal EventSource mock
class FakeEventSource {
  static instance: FakeEventSource | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCalled = false;
  constructor(public url: string) { FakeEventSource.instance = this; }
  close() { this.closeCalled = true; }
  emit(data: object) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
}

beforeEach(() => {
  FakeEventSource.instance = null;
  (global as any).EventSource = FakeEventSource;
});
afterEach(() => jest.clearAllMocks());

function renderOverlay(onClose = jest.fn()) {
  return render(<BackfillOverlay outputFolder={OUTPUT_FOLDER} onClose={onClose} />);
}

describe('BackfillOverlay', () => {
  it('shows progress when start + step events are received', () => {
    renderOverlay();
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 3 }); });
    act(() => { FakeEventSource.instance!.emit({ type: 'step', videoId: 'v1', title: 'Video One', step: 'done', current: 1, total: 3 }); });
    expect(screen.getByText('Video One')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('Dismiss button is disabled while running', () => {
    renderOverlay();
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 2 }); });
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeDisabled();
  });

  it('Dismiss button is enabled after done event', () => {
    renderOverlay();
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 1 }); });
    act(() => { FakeEventSource.instance!.emit({ type: 'done', total: 1, succeeded: 1, failed: 0 }); });
    expect(screen.getByRole('button', { name: /dismiss/i })).not.toBeDisabled();
  });

  it('calls onClose when Dismiss is clicked after done', () => {
    const onClose = jest.fn();
    renderOverlay(onClose);
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 1 }); });
    act(() => { FakeEventSource.instance!.emit({ type: 'done', total: 1, succeeded: 1, failed: 0 }); });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows error entry for per-video error events', () => {
    renderOverlay();
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 2 }); });
    act(() => { FakeEventSource.instance!.emit({ type: 'error', videoId: 'v1', title: 'Bad Video', log: 'timeout' }); });
    expect(screen.getByText('Bad Video')).toBeInTheDocument();
  });

  it('shows error state when SSE connection drops', () => {
    renderOverlay();
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 1 }); });
    act(() => { FakeEventSource.instance!.onerror?.(); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss/i })).not.toBeDisabled();
  });

  it('calls onClose when Escape is pressed after done', () => {
    const onClose = jest.fn();
    renderOverlay(onClose);
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 1 }); });
    act(() => { FakeEventSource.instance!.emit({ type: 'done', total: 1, succeeded: 1, failed: 0 }); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when Escape is pressed while running', () => {
    const onClose = jest.fn();
    renderOverlay(onClose);
    act(() => { FakeEventSource.instance!.emit({ type: 'start', total: 2 }); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
