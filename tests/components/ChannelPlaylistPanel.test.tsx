/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import ChannelPlaylistPanel from '../../components/ChannelPlaylistPanel';

const okBody = { channelTitle: 'Anthropic', playlists: [{ id: 'PLa', title: 'A', url: 'https://youtube.com/playlist?list=PLa', source: 'channel', meta: { videoCount: 7 } }] };
function mockFetch(status: number, body: unknown) { global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch; }
beforeEach(() => { localStorage.clear(); mockFetch(200, okBody); });

it('Go lists channel playlist titles', async () => {
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText('A')).toBeInTheDocument();
});
it('selecting a playlist calls onSelect(url) and onClose', async () => {
  const onSelect = jest.fn(); const onClose = jest.fn();
  render(<ChannelPlaylistPanel onSelect={onSelect} onClose={onClose} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  fireEvent.click(await screen.findByText('A'));
  expect(onSelect).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLa');
  expect(onClose).toHaveBeenCalled();
});
it.each([
  ['close button', () => fireEvent.click(screen.getByLabelText('Close'))],
  ['escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ['backdrop', () => fireEvent.click(screen.getByTestId('panel-backdrop'))],
])('dismisses via %s', (_n, act) => {
  const onClose = jest.fn();
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={onClose} />);
  act();
  expect(onClose).toHaveBeenCalled();
});
it('shows a loading state while fetching', async () => {
  let resolve!: (v: unknown) => void;
  global.fetch = jest.fn(() => new Promise((r) => { resolve = r; })) as unknown as typeof fetch;
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@x' } });
  fireEvent.click(screen.getByText('Go'));
  expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  resolve({ ok: true, status: 200, json: async () => okBody });
});
it('shows not-found on 404', async () => {
  mockFetch(404, { error: "No channel found for '@nope'" });
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@nope' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText(/No channel found/i)).toBeInTheDocument();
});
it('shows an error on 502', async () => {
  mockFetch(502, { error: 'Could not reach YouTube' });
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@x' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText(/reach YouTube/i)).toBeInTheDocument();
});
it('remembers the handle and refills the input from a chip', async () => {
  const { rerender } = render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  await screen.findByText('A');
  expect(JSON.parse(localStorage.getItem('playlist-picker:channel-recents') || '[]')).toContain('@Anthropic');
  // remount: chip present, clicking it refills the input
  rerender(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '@Anthropic' }));
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('@Anthropic');
});

// Task 5: two-line result rows
const body = { channelTitle: 'Anthropic', playlists: [
  { id: 'PLc', title: 'Research Talks', url: 'https://youtube.com/playlist?list=PLc', source: 'channel', meta: { videoCount: 31 } },
  { id: 'PLd', title: 'No URL Talks', url: '', source: 'channel', meta: {} },
] };

it('renders result rows as title + muted URL line', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  render(<ChannelPlaylistPanel onSelect={jest.fn()} onClose={jest.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(/@channel/), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  await screen.findByText('Research Talks');
  expect(screen.getByText('Research Talks')).toBeInTheDocument();
  expect(screen.getByText('https://youtube.com/playlist?list=PLc')).toBeInTheDocument();
});

it('a result without a url renders the title only', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  render(<ChannelPlaylistPanel onSelect={jest.fn()} onClose={jest.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(/@channel/), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  await screen.findByText('Research Talks');
  expect(screen.getByText('No URL Talks')).toBeInTheDocument();
  expect(screen.getAllByText(/youtube\.com\/playlist/).length).toBe(1);
});

it('picking a result calls onSelect with the url and closes', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
  const onSelect = jest.fn(); const onClose = jest.fn();
  render(<ChannelPlaylistPanel onSelect={onSelect} onClose={onClose} />);
  fireEvent.change(screen.getByPlaceholderText(/@channel/), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  fireEvent.click(await screen.findByText('Research Talks'));
  expect(onSelect).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLc');
  expect(onClose).toHaveBeenCalled();
});
