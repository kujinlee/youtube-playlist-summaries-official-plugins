/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import VideoMenu from '../../components/VideoMenu';

const base = {
  id: 'vid11111111', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
  durationSeconds: 5, archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 'base.md', deepDiveMd: null, processedAt: '2026-01-01T00:00:00.000Z',
};
const props = { outputFolder: '/o', baseOutputFolder: '/o', onDeepDive() {}, onArchive() {}, onEditCorrections() {}, onGenerateHtml() {}, onClose() {}, busy: false };

// ── HTML doc (existing tests, unchanged) ─────────────────────────────────────

it('shows a single "HTML doc" item — a direct link when current (html + docVersion 3.3)', () => {
  render(<VideoMenu {...props} video={{ ...base, summaryHtml: 'htmls/base.html', docVersion: { major: 3, minor: 3 } } as any} />);
  const el = screen.getByRole('link', { name: /HTML doc/i });
  expect(el).toHaveAttribute('href', expect.stringContaining('/api/html/'));
  expect(screen.queryByText(/Generate HTML doc|Regenerate HTML doc|View HTML doc/)).toBeNull();
});

it('renders a button when stale (pre-feature: no docVersion)', () => {
  render(<VideoMenu {...props} video={{ ...base, summaryHtml: 'htmls/base.html' } as any} />);
  expect(screen.getByRole('button', { name: /HTML doc/i })).toBeInTheDocument();
});

it('disables the item while busy', () => {
  render(<VideoMenu {...props} busy video={{ ...base, summaryHtml: 'htmls/base.html', docVersion: { major: 3, minor: 3 } } as any} />);
  expect(screen.getByText(/HTML doc/i).closest('a,button,span')).toHaveAttribute('aria-disabled', 'true');
});

// ── Deep Dive doc (new unified item) ────────────────────────────────────────

it('Deep Dive doc — renders as a LINK when current (deepDiveHtml + deepDiveVersion 2.3)', () => {
  render(<VideoMenu {...props} video={{ ...base, deepDiveMd: 'dd.md', deepDiveHtml: 'htmls/dd.html', deepDiveVersion: { major: 2, minor: 3 } } as any} />);
  const el = screen.getByRole('link', { name: /Deep Dive doc/i });
  expect(el).toHaveAttribute('href', expect.stringContaining('type=deep-dive'));
  expect(el).toHaveAttribute('href', expect.stringContaining('outputFolder='));
});

it('Deep Dive doc — renders as a BUTTON when stale (deepDiveHtml set but deepDiveVersion absent/older)', () => {
  render(<VideoMenu {...props} video={{ ...base, deepDiveMd: 'dd.md', deepDiveHtml: 'htmls/dd.html' } as any} />);
  expect(screen.getByRole('button', { name: /Deep Dive doc/i })).toBeInTheDocument();
});

it('Deep Dive doc — renders as a BUTTON when never generated (deepDiveMd and deepDiveHtml both null)', () => {
  render(<VideoMenu {...props} video={{ ...base, deepDiveMd: null, deepDiveHtml: null } as any} />);
  expect(screen.getByRole('button', { name: /Deep Dive doc/i })).toBeInTheDocument();
});

it('Deep Dive doc — renders DISABLED with hourglass when busy', () => {
  render(<VideoMenu {...props} busy video={{ ...base, deepDiveMd: 'dd.md', deepDiveHtml: 'htmls/dd.html', deepDiveVersion: { major: 2, minor: 3 } } as any} />);
  const el = screen.getByText(/Deep Dive doc/i).closest('a,button,span');
  expect(el).toHaveAttribute('aria-disabled', 'true');
  expect(el?.textContent).toMatch(/⏳/);
});

it('Deep Dive doc — calls onDeepDive with video.id on button click', () => {
  const onDeepDive = jest.fn();
  const onClose = jest.fn();
  render(<VideoMenu {...props} onDeepDive={onDeepDive} onClose={onClose} video={{ ...base, deepDiveMd: null, deepDiveHtml: null } as any} />);
  fireEvent.click(screen.getByRole('button', { name: /Deep Dive doc/i }));
  expect(onDeepDive).toHaveBeenCalledWith('vid11111111');
  expect(onClose).toHaveBeenCalled();
});

it('old "Deep Dive" and "View Deep Dive HTML" items no longer exist', () => {
  render(<VideoMenu {...props} video={{ ...base, deepDiveMd: 'dd.md', deepDiveHtml: 'htmls/dd.html', deepDiveVersion: { major: 2, minor: 3 } } as any} />);
  // There must be exactly one deep-dive-doc control (the unified item)
  const deepDiveDocEls = screen.getAllByText(/Deep Dive doc/i);
  expect(deepDiveDocEls).toHaveLength(1);
  // Old standalone items must be gone
  expect(screen.queryByRole('button', { name: /^Deep Dive$/i })).toBeNull();
  expect(screen.queryByText(/^View Deep Dive HTML$/i)).toBeNull();
});

it('does not render PDF menu items (PDF generation removed)', () => {
  render(<VideoMenu {...props} video={base as any} />);
  expect(screen.queryByText('View Summary PDF')).not.toBeInTheDocument();
  expect(screen.queryByText('View Deep Dive PDF')).not.toBeInTheDocument();
});
