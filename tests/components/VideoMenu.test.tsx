/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import VideoMenu from '../../components/VideoMenu';
import type { Video } from '@/types';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

const noop = () => {};
function renderMenu(v: Video) {
  return render(
    <VideoMenu video={v} outputFolder="/home/u/p" baseOutputFolder="/home/u"
      onDeepDive={noop} onArchive={noop} onEditCorrections={noop} onGenerateHtml={noop} onClose={noop} />,
  );
}

it('shows "Generate HTML doc" when summaryMd is set and summaryHtml is null', () => {
  renderMenu(video({ summaryHtml: null }));
  expect(screen.getByRole('button', { name: /generate html doc/i })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /view html doc/i })).not.toBeInTheDocument();
});

it('shows View + Regenerate when summaryHtml is set', () => {
  renderMenu(video({ summaryHtml: 'htmls/a.html' }));
  const link = screen.getByRole('link', { name: /view html doc/i });
  expect(link).toHaveAttribute(
    'href', '/api/html/v?outputFolder=%2Fhome%2Fu%2Fp&type=summary',
  );
  expect(screen.getByRole('button', { name: /regenerate html doc/i })).toBeInTheDocument();
});

it('disables HTML actions when there is no summaryMd', () => {
  renderMenu(video({ summaryMd: null, summaryHtml: null }));
  const item = screen.getByText(/generate html doc/i);
  expect(item).toHaveAttribute('aria-disabled', 'true');
});
