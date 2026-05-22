/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import VideoList from '@/components/VideoList';
import type { Video } from '@/types';

jest.mock('@/components/VideoRow', () => {
  const MockVideoRow = ({
    video,
    rank,
    outputFolder,
    onDeepDive,
    onArchive,
  }: {
    video: Video;
    rank: number;
    outputFolder: string;
    onDeepDive: (videoId: string) => void;
    onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  }) => (
    <tr
      data-testid="video-row"
      data-video-id={video.id}
      data-rank={rank}
      data-output-folder={outputFolder}
      onClick={() => {
        onDeepDive(video.id);
        onArchive(video.id, 'archive');
      }}
    />
  );
  MockVideoRow.displayName = 'MockVideoRow';
  return MockVideoRow;
});

const OUTPUT_FOLDER = '/Users/test/vault';

const makeVideo = (id: string, archived = false): Video => ({
  id,
  title: `Video ${id}`,
  youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
  language: 'en',
  durationSeconds: 300,
  archived,
  ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3,
  summaryMd: 'summary.md',
  summaryPdf: 'summary.pdf',
  deepDiveMd: null,
  deepDivePdf: null,
  processedAt: '2024-01-01T00:00:00.000Z',
});

function renderList({
  videos = [] as Video[],
  showArchive = false,
  onDeepDive = jest.fn(),
  onArchive = jest.fn(),
} = {}) {
  return render(
    <VideoList
      videos={videos}
      outputFolder={OUTPUT_FOLDER}
      showArchive={showArchive}
      onDeepDive={onDeepDive}
      onArchive={onArchive}
    />,
  );
}

describe('VideoList — core rendering', () => {
  it('renders one VideoRow per non-archived video', () => {
    renderList({ videos: [makeVideo('v1'), makeVideo('v2')] });
    expect(screen.getAllByTestId('video-row')).toHaveLength(2);
  });

  it('renders nothing when videos array is empty', () => {
    const { container } = renderList({ videos: [] });
    expect(screen.queryByTestId('video-row')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('passes video and outputFolder props through to VideoRow (prop-forwarding)', () => {
    renderList({ videos: [makeVideo('v1')] });
    const row = screen.getByTestId('video-row');
    expect(row).toHaveAttribute('data-video-id', 'v1');
    expect(row).toHaveAttribute('data-output-folder', OUTPUT_FOLDER);
  });

  it('passes 1-indexed rank to each VideoRow', () => {
    renderList({ videos: [makeVideo('v1'), makeVideo('v2'), makeVideo('v3')] });
    const rows = screen.getAllByTestId('video-row');
    expect(rows[0]).toHaveAttribute('data-rank', '1');
    expect(rows[1]).toHaveAttribute('data-rank', '2');
    expect(rows[2]).toHaveAttribute('data-rank', '3');
  });

  it('threads onDeepDive callback to VideoRow (prop-forwarding)', () => {
    const onDeepDive = jest.fn();
    renderList({ videos: [makeVideo('v1')], onDeepDive });
    screen.getByTestId('video-row').click();
    expect(onDeepDive).toHaveBeenCalledWith('v1');
  });

  it('threads onArchive callback to VideoRow (prop-forwarding)', () => {
    const onArchive = jest.fn();
    renderList({ videos: [makeVideo('v1')], onArchive });
    screen.getByTestId('video-row').click();
    expect(onArchive).toHaveBeenCalledWith('v1', 'archive');
  });
});

describe('VideoList — archive filtering (showArchive=false)', () => {
  it('hides archived rows by default', () => {
    const { container } = renderList({ videos: [makeVideo('a1', true)] });
    expect(screen.queryByTestId('video-row')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows non-archived rows when an archived row is also present', () => {
    renderList({ videos: [makeVideo('a1', true), makeVideo('v1', false)] });
    const rows = screen.getAllByTestId('video-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-video-id', 'v1');
  });

  it('renders nothing when all videos are archived', () => {
    const { container } = renderList({ videos: [makeVideo('a1', true), makeVideo('a2', true)] });
    expect(screen.queryByTestId('video-row')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('VideoList — playlistIndex rank', () => {
  it('passes playlistIndex as rank when video has playlistIndex set', () => {
    const video = { ...makeVideo('v1'), playlistIndex: 41 };
    renderList({ videos: [video] });
    expect(screen.getByTestId('video-row')).toHaveAttribute('data-rank', '41');
  });

  it('falls back to 1-indexed loop position when playlistIndex is absent', () => {
    renderList({ videos: [makeVideo('v1'), makeVideo('v2')] });
    const rows = screen.getAllByTestId('video-row');
    expect(rows[0]).toHaveAttribute('data-rank', '1');
    expect(rows[1]).toHaveAttribute('data-rank', '2');
  });

  it('playlistIndex values are stable regardless of display order', () => {
    const v1 = { ...makeVideo('v1'), playlistIndex: 5 };
    const v2 = { ...makeVideo('v2'), playlistIndex: 2 };
    renderList({ videos: [v1, v2] });
    const rows = screen.getAllByTestId('video-row');
    expect(rows[0]).toHaveAttribute('data-rank', '5');
    expect(rows[1]).toHaveAttribute('data-rank', '2');
  });
});

describe('VideoList — archive visibility (showArchive=true)', () => {
  it('shows archived rows in the DOM when showArchive=true', () => {
    renderList({ videos: [makeVideo('a1', true)], showArchive: true });
    expect(screen.getByTestId('video-row')).toBeInTheDocument();
  });

  it('toggles archived row visibility when showArchive changes', () => {
    const archivedVideo = makeVideo('a1', true);
    const { rerender } = render(
      <VideoList
        videos={[archivedVideo]}
        outputFolder={OUTPUT_FOLDER}
        showArchive={false}
        onDeepDive={jest.fn()}
        onArchive={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('video-row')).toBeNull();

    rerender(
      <VideoList
        videos={[archivedVideo]}
        outputFolder={OUTPUT_FOLDER}
        showArchive={true}
        onDeepDive={jest.fn()}
        onArchive={jest.fn()}
      />,
    );
    expect(screen.getByTestId('video-row')).toBeInTheDocument();

    rerender(
      <VideoList
        videos={[archivedVideo]}
        outputFolder={OUTPUT_FOLDER}
        showArchive={false}
        onDeepDive={jest.fn()}
        onArchive={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('video-row')).toBeNull();
  });
});
