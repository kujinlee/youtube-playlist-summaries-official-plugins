/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '../../components/Header';

beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ playlists: [] }) })) as unknown as typeof fetch; });

it('renders the current playlist name caption when provided', () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/a/raw"
    currentPlaylistTitle="Building with Claude" onIngest={() => {}} />);
  expect(screen.getByText(/Building with Claude/)).toBeInTheDocument();
});
it('opens the channel panel from the picker footer', async () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/a/raw" onIngest={() => {}} />);
  fireEvent.focus(screen.getByPlaceholderText(/Paste a playlist URL/));
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(await screen.findByText(/Browse channel playlists/i)).toBeInTheDocument();
});
