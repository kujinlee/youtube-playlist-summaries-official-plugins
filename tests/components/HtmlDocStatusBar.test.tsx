/** @jest-environment jsdom */
import { render, screen, act } from '@testing-library/react';
import HtmlDocStatusBar from '../../components/HtmlDocStatusBar';

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
  (global as any).EventSource = FakeES as unknown as typeof EventSource;
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

const viewUrl = '/api/html/v?outputFolder=%2Fhome%2Fu%2Fp&type=summary';

it('subscribes to the html-doc stream for the given job', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  expect(FakeES.last?.url).toContain('/api/videos/v/html-doc/stream?jobId=j1');
});

it('shows the running step', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'step', step: 'Transforming to skim view…', current: 2, total: 3 }); });
  expect(screen.getByText('Transforming to skim view…')).toBeInTheDocument();
});

it('reveals a View link on done', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'done' }); });
  const link = screen.getByRole('link', { name: /view html doc/i });
  expect(link).toHaveAttribute('href', viewUrl);
});

it('shows an error message on error', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.emit({ type: 'error', log: 'transform failed' }); });
  expect(screen.getByRole('alert')).toHaveTextContent('transform failed');
});

it('shows a connection-lost error when EventSource errors', () => {
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={() => {}} />);
  act(() => { FakeES.last!.onerror?.(); });
  expect(screen.getByRole('alert')).toHaveTextContent(/connection lost/i);
});

it('calls onClose when the Dismiss button is clicked', () => {
  const onClose = jest.fn();
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={onClose} />);
  act(() => { screen.getByRole('button', { name: /dismiss/i }).click(); });
  expect(onClose).toHaveBeenCalled();
});

it('auto-closes ~4s after done', () => {
  const onClose = jest.fn();
  render(<HtmlDocStatusBar videoId="v" jobId="j1" title="T" viewUrl={viewUrl} onClose={onClose} />);
  act(() => { FakeES.last!.emit({ type: 'done' }); });
  expect(onClose).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(4000); });
  expect(onClose).toHaveBeenCalled();
});
