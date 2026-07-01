/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Header from '../../components/Header';

function mockFetch() {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/playlists/recent')) return { ok: true, json: async () => ({ playlists: [
      { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: {} },
    ] }) } as Response;
    if (url.includes('/api/resolve-folder')) return { ok: true, json: async () => ({ root: '/home/x/data', outputFolder: '/home/x/data/a/raw' }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}
beforeEach(() => { mockFetch(); });

const common = { defaultBaseOutputFolder: '/home/x/data', defaultOutputFolder: '/home/x/data/a/raw', onIngest: () => {} };

it('renders the current playlist title prominently (no ▶ caption)', () => {
  render(<Header {...common} currentPlaylistTitle="Building with Claude" playlistLoaded />);
  expect(screen.getByText('Building with Claude')).toBeInTheDocument();
  expect(screen.queryByText(/▶/)).toBeNull();
});

it('renders a clickable muted URL for the current playlist', () => {
  render(<Header {...common} currentPlaylistTitle="건강" currentPlaylistUrl="https://youtube.com/playlist?list=PL837" playlistLoaded />);
  const link = screen.getByRole('link', { name: /playlist\?list=PL837/ });
  expect(link).toHaveAttribute('href', 'https://youtube.com/playlist?list=PL837');
  expect(link).toHaveAttribute('target', '_blank');
});

it('shows the folder-slug fallback when the title is missing', () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/건강/raw"
    currentPlaylistUrl="https://youtube.com/playlist?list=PL837" onIngest={() => {}} playlistLoaded />);
  expect(screen.getByText('건강')).toBeInTheDocument();
});

it('empty state (loaded, no playlist) starts with the add-by-link input expanded', () => {
  render(<Header {...common} playlistLoaded />);
  expect(screen.getByPlaceholderText(/Paste a playlist URL/)).toBeInTheDocument();
});

it('does NOT auto-open the disclosure before the playlist has loaded', () => {
  render(<Header {...common} />); // playlistLoaded defaults false
  expect(screen.queryByPlaceholderText(/Paste a playlist URL/)).toBeNull();
});

it('an existing playlist never auto-opens the disclosure', () => {
  render(<Header {...common} currentPlaylistTitle="건강" playlistLoaded />);
  expect(screen.queryByPlaceholderText(/Paste a playlist URL/)).toBeNull();
});

it('the toggle reveals the input in the non-empty state', () => {
  render(<Header {...common} currentPlaylistTitle="건강" playlistLoaded />);
  fireEvent.click(screen.getByRole('button', { name: /Add by link/ }));
  expect(screen.getByPlaceholderText(/Paste a playlist URL/)).toBeInTheDocument();
});

it('opens the channel panel from the ▾ Recent dropdown', async () => {
  render(<Header {...common} currentPlaylistTitle="건강" playlistLoaded />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(await screen.findByText(/Browse channel playlists/i)).toBeInTheDocument();
});

it('auto-collapses the disclosure after a pasted URL resolves', async () => {
  render(<Header {...common} playlistLoaded />); // empty → disclosure open
  const input = screen.getByPlaceholderText(/Paste a playlist URL/);
  fireEvent.change(input, { target: { value: 'https://youtube.com/playlist?list=PLa' } });
  await waitFor(() => expect(screen.queryByPlaceholderText(/Paste a playlist URL/)).toBeNull());
});

it('picking a recent playlist enables Fetch', async () => {
  render(<Header {...common} currentPlaylistTitle="건강" playlistLoaded />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  fireEvent.click(await screen.findByText('Building with Claude'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Fetch & Summarize/ })).toBeEnabled());
});
