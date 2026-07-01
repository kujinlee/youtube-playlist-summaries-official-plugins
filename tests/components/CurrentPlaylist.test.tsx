/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import CurrentPlaylist from '../../components/CurrentPlaylist';

it('renders the title', () => {
  render(<CurrentPlaylist title="건강" />);
  expect(screen.getByText('건강')).toBeInTheDocument();
});
it('renders a muted URL anchor opening YouTube in a new tab', () => {
  const url = 'https://youtube.com/playlist?list=PL837';
  render(<CurrentPlaylist title="건강" url={url} />);
  const link = screen.getByRole('link');
  expect(link).toHaveAttribute('href', url);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link.getAttribute('rel')).toContain('noopener');
  expect(link.getAttribute('rel')).toContain('noreferrer');
  expect(link).toHaveAttribute('title', url);
});
it('omits the anchor when no url is given', () => {
  render(<CurrentPlaylist title="건강" />);
  expect(screen.queryByRole('link')).toBeNull();
});
