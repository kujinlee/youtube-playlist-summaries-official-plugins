/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import PlaylistPicker from '../../components/PlaylistPicker';

const options = [{ id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } }];
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ playlists: options }) })) as unknown as typeof fetch; });

it('shows recent titles (not ids) on focus', async () => {
  render(<PlaylistPicker root="/home/x/data" value="" onChange={() => {}} onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.focus(screen.getByRole('textbox'));
  expect(await screen.findByText('Building with Claude')).toBeInTheDocument();
  expect(screen.queryByText('PLa')).not.toBeInTheDocument();
});
it('selecting an option calls onPick with the url', async () => {
  const onPick = jest.fn();
  render(<PlaylistPicker root="/home/x/data" value="" onChange={() => {}} onPick={onPick} onBrowseChannel={() => {}} />);
  fireEvent.focus(screen.getByRole('textbox'));
  fireEvent.click(await screen.findByText('Building with Claude'));
  expect(onPick).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLa');
});
it('preserves free typing', () => {
  const onChange = jest.fn();
  render(<PlaylistPicker root="/home/x/data" value="" onChange={onChange} onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://youtube.com/playlist?list=PLtyped' } });
  expect(onChange).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLtyped');
});
it('footer row triggers onBrowseChannel', async () => {
  const onBrowseChannel = jest.fn();
  render(<PlaylistPicker root="/home/x/data" value="" onChange={() => {}} onPick={() => {}} onBrowseChannel={onBrowseChannel} />);
  fireEvent.focus(screen.getByRole('textbox'));
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(onBrowseChannel).toHaveBeenCalled();
});
