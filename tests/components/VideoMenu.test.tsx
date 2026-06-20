/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import VideoMenu from '../../components/VideoMenu';

const base = {
  id: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
  durationSeconds: 5, archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 'base.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null, processedAt: '2026-01-01T00:00:00.000Z',
};
const props = { outputFolder: '/o', baseOutputFolder: '/o', onDeepDive() {}, onArchive() {}, onEditCorrections() {}, onGenerateHtml() {}, onClose() {}, busy: false };

it('shows a single "HTML doc" item — a direct link when current (html + docVersion 3.2)', () => {
  render(<VideoMenu {...props} video={{ ...base, summaryHtml: 'htmls/base.html', docVersion: { major: 3, minor: 2 } } as any} />);
  const el = screen.getByRole('link', { name: /HTML doc/i });
  expect(el).toHaveAttribute('href', expect.stringContaining('/api/html/'));
  expect(screen.queryByText(/Generate HTML doc|Regenerate HTML doc|View HTML doc/)).toBeNull();
});

it('renders a button when stale (pre-feature: no docVersion)', () => {
  render(<VideoMenu {...props} video={{ ...base, summaryHtml: 'htmls/base.html' } as any} />);
  expect(screen.getByRole('button', { name: /HTML doc/i })).toBeInTheDocument();
});

it('disables the item while busy', () => {
  render(<VideoMenu {...props} busy video={{ ...base, summaryHtml: 'htmls/base.html', docVersion: { major: 3, minor: 2 } } as any} />);
  expect(screen.getByText(/HTML doc/i).closest('a,button,span')).toHaveAttribute('aria-disabled', 'true');
});
