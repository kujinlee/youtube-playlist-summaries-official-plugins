/** @jest-environment jsdom */
import { render, screen, act, fireEvent } from '@testing-library/react';
import BatchDocStatusBar from '../../components/BatchDocStatusBar';

class FakeES {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string; static last: FakeES | null = null;
  constructor(url: string) { this.url = url; FakeES.last = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent); }
}

beforeEach(() => { (global as any).EventSource = FakeES as unknown as typeof EventSource; jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

it('subscribes to the batch stream for the given job', () => {
  render(<BatchDocStatusBar jobId="j1" onClose={() => {}} />);
  expect(FakeES.last?.url).toContain('/api/videos/batch-docs/stream?jobId=j1');
});

it('renders step X of N and a failed count', () => {
  render(<BatchDocStatusBar jobId="j1" onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', current: 2, total: 5 }); });
  expect(screen.getByText(/step 2 of 5/)).toBeInTheDocument();
  act(() => { FakeES.last!.emit({ type: 'error', videoId: 'a', log: 'x' }); });
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', current: 3, total: 5 }); });
  expect(screen.getByText(/1 failed/)).toBeInTheDocument();
});

it('auto-closes ~4s after done', () => {
  const onClose = jest.fn();
  render(<BatchDocStatusBar jobId="j1" onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'done', succeeded: 4, failed: 1 }); });
  expect(screen.getByText(/4 generated/)).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(4000); });
  expect(onClose).toHaveBeenCalled();
});

it('H1: ✕ while running POSTs cancel, then closes', () => {
  const onClose = jest.fn();
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  (global as any).fetch = fetchMock;
  render(<BatchDocStatusBar jobId="j1" onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', current: 1, total: 3 }); });
  fireEvent.click(screen.getByLabelText('Close'));
  expect(fetchMock).toHaveBeenCalledWith('/api/videos/batch-docs/cancel', expect.objectContaining({ method: 'POST' }));
  expect(onClose).toHaveBeenCalled();
});

it('H2: fires onProgressEvent for each parsed event', () => {
  const onProgressEvent = jest.fn();
  render(<BatchDocStatusBar jobId="j1" onClose={() => {}} onProgressEvent={onProgressEvent} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Generating HTML doc…', videoId: 'a', current: 1, total: 2 }); });
  expect(onProgressEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'step', videoId: 'a' }));
});
