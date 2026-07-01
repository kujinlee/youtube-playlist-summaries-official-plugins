/** @jest-environment jsdom */
import { render, screen, act } from '@testing-library/react';
import PdfStatusBar from '../../components/PdfStatusBar';

class FakeES {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  static last: FakeES | null = null;
  constructor(url: string) { this.url = url; FakeES.last = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) } as MessageEvent); }
}

beforeEach(() => {
  (global as unknown as { EventSource: unknown }).EventSource = FakeES as unknown as typeof EventSource;
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

it('subscribes to the pdf stream for the given job', () => {
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={() => {}} />);
  expect(FakeES.last?.url).toContain('/api/videos/v/pdf/stream?jobId=j1');
});

it('shows the running step', () => {
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Rendering PDF…', current: 1, total: 1 }); });
  expect(screen.getByText('Rendering PDF…')).toBeInTheDocument();
});

it('shows "Saved pdfs/<file>" on done with NO anchor', () => {
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'done', log: '275_x.pdf' }); });
  expect(screen.getByText(/Saved pdfs\/275_x\.pdf/)).toBeInTheDocument();
  expect(screen.queryByRole('link')).toBeNull();
});

it('shows an error message on error', () => {
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'error', log: 'boom' }); });
  expect(screen.getByRole('alert')).toHaveTextContent('boom');
});

it('labels the region "Save PDF Progress"', () => {
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={() => {}} />);
  expect(screen.getByRole('status', { name: /Save PDF Progress/i })).toBeInTheDocument();
});

it('calls onClose when Dismiss is clicked', () => {
  const onClose = jest.fn();
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={onClose} />);
  act(() => { screen.getByRole('button', { name: /dismiss/i }).click(); });
  expect(onClose).toHaveBeenCalled();
});

it('auto-closes ~2.5s after done', () => {
  const onClose = jest.fn();
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'done', log: 'x.pdf' }); });
  expect(onClose).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(2500); });
  expect(onClose).toHaveBeenCalled();
});

it('calls onError on an error event', () => {
  const onError = jest.fn();
  render(<PdfStatusBar videoId="v" jobId="j1" title="T" onClose={() => {}} onError={onError} />);
  act(() => { FakeES.last!.emit({ type: 'error', log: 'boom' }); });
  expect(onError).toHaveBeenCalledTimes(1);
});

it('shows a pre-set errorMessage (POST failed, no job) and opens NO stream', () => {
  FakeES.last = null;
  render(<PdfStatusBar videoId="v" jobId="" title="T" onClose={() => {}} errorMessage="PDF failed — missing-html" />);
  expect(screen.getByRole('alert')).toHaveTextContent('PDF failed — missing-html');
  expect(FakeES.last).toBeNull(); // no EventSource opened for an empty jobId
});

it('auto-dismisses a pre-set error after ~5s', () => {
  const onClose = jest.fn();
  render(<PdfStatusBar videoId="v" jobId="" title="T" onClose={onClose} errorMessage="PDF failed — 404" />);
  expect(onClose).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(5000); });
  expect(onClose).toHaveBeenCalled();
});
