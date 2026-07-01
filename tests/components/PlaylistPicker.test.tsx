/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import PlaylistPicker from '../../components/PlaylistPicker';

const options = [
  { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } },
  { id: 'PLn', title: 'No URL Playlist', url: '', source: 'recent', meta: {} },
];
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ playlists: options }) })) as unknown as typeof fetch; });

it('opens the dropdown on button click and shows titles (not ids)', async () => {
  render(<PlaylistPicker root="/home/x/data" onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  expect(await screen.findByText('Building with Claude')).toBeInTheDocument();
  expect(screen.queryByText('PLa')).not.toBeInTheDocument();
});
it('renders each option as title + muted URL line', async () => {
  render(<PlaylistPicker root="/home/x/data" onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  expect(await screen.findByText('Building with Claude')).toBeInTheDocument();
  expect(screen.getByText('https://youtube.com/playlist?list=PLa')).toBeInTheDocument();
});
it('an option without a url renders the title only', async () => {
  render(<PlaylistPicker root="/home/x/data" onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  expect(await screen.findByText('No URL Playlist')).toBeInTheDocument();
  expect(screen.getAllByText(/youtube\.com\/playlist/).length).toBe(1);
});
it('selecting an option calls onPick with the url', async () => {
  const onPick = jest.fn();
  render(<PlaylistPicker root="/home/x/data" onPick={onPick} onBrowseChannel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  fireEvent.click(await screen.findByText('Building with Claude'));
  expect(onPick).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLa');
});
it('footer row triggers onBrowseChannel', async () => {
  const onBrowseChannel = jest.fn();
  render(<PlaylistPicker root="/home/x/data" onPick={() => {}} onBrowseChannel={onBrowseChannel} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(onBrowseChannel).toHaveBeenCalled();
});
it('closes on an outside click', async () => {
  render(<PlaylistPicker root="/home/x/data" onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  expect(await screen.findByText('Building with Claude')).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByText('Building with Claude')).not.toBeInTheDocument();
});
it('disables the toggle when disabled', () => {
  render(<PlaylistPicker root="/home/x/data" onPick={() => {}} onBrowseChannel={() => {}} disabled />);
  expect(screen.getByRole('button', { name: /Recent/ })).toBeDisabled();
});
it('does not fetch recents when root is empty', () => {
  const spy = global.fetch as jest.Mock;
  render(<PlaylistPicker root="" onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Recent/ }));
  expect(spy).not.toHaveBeenCalled();
});
