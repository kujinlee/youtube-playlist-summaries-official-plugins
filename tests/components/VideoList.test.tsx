/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoList from '@/components/VideoList';
import type { SortColumn, SortOrder, Video } from '@/types';

jest.mock('@/components/VideoRow', () => {
  const MockVideoRow = ({
    video,
    rank,
    outputFolder,
    onArchive,
    dimUnscored,
    onAnnotationChange,
  }: {
    video: Video;
    rank?: number;
    outputFolder: string;
    baseOutputFolder: string;
    dimUnscored: boolean;
    onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
    onAnnotationChange: (videoId: string, patch: unknown) => void;
  }) => (
    <tr data-testid={`row-${video.id}`} data-dim={String(dimUnscored)}>
      <td>{rank}</td>
      <td>{outputFolder}</td>
      <td><button onClick={() => onArchive(video.id, 'archive')}>archive</button></td>
      <td><button onClick={() => onAnnotationChange(video.id, { personalScore: 4 })}>annotate</button></td>
    </tr>
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
  processedAt: '2024-01-01T00:00:00.000Z',
});

const baseVideo = makeVideo('base-v1');

function renderList({
  videos = [] as Video[],
  showArchive = false,
  onArchive = jest.fn(),
  onGenerateHtml = jest.fn(),
} = {}) {
  return render(
    <VideoList
      videos={videos}
      outputFolder={OUTPUT_FOLDER}
      baseOutputFolder={OUTPUT_FOLDER}
      showArchive={showArchive}
      onArchive={onArchive}
      onGenerateHtml={onGenerateHtml}
    />,
  );
}

describe('VideoList — core rendering', () => {
  it('renders one VideoRow per non-archived video', () => {
    renderList({ videos: [makeVideo('v1'), makeVideo('v2')] });
    expect(screen.getByTestId('row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('row-v2')).toBeInTheDocument();
  });

  it('renders nothing when videos array is empty', () => {
    const { container } = renderList({ videos: [] });
    expect(container.querySelector('[data-testid^="row-"]')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('passes video and outputFolder props through to VideoRow (prop-forwarding)', () => {
    renderList({ videos: [makeVideo('v1')] });
    // outputFolder is rendered as text in the second <td> of the mock row
    expect(screen.getByTestId('row-v1')).toBeInTheDocument();
    expect(screen.getByTestId('row-v1')).toHaveTextContent(OUTPUT_FOLDER);
  });

  it('passes each video.serialNumber through as rank to VideoRow', () => {
    renderList({
      videos: [
        { ...makeVideo('v1'), serialNumber: 10 },
        { ...makeVideo('v2'), serialNumber: 20 },
        { ...makeVideo('v3'), serialNumber: 30 },
      ],
    });
    expect(screen.getByTestId('row-v1')).toHaveTextContent('10');
    expect(screen.getByTestId('row-v2')).toHaveTextContent('20');
    expect(screen.getByTestId('row-v3')).toHaveTextContent('30');
  });

  it('threads onArchive callback to VideoRow (prop-forwarding)', () => {
    const onArchive = jest.fn();
    renderList({ videos: [makeVideo('v1')], onArchive });
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(onArchive).toHaveBeenCalledWith('v1', 'archive');
  });
});

describe('VideoList — archive filtering (showArchive=false)', () => {
  it('hides archived rows by default', () => {
    const { container } = renderList({ videos: [makeVideo('a1', true)] });
    expect(screen.queryByTestId('row-a1')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows non-archived rows when an archived row is also present', () => {
    renderList({ videos: [makeVideo('a1', true), makeVideo('v1', false)] });
    expect(screen.queryByTestId('row-a1')).toBeNull();
    expect(screen.getByTestId('row-v1')).toBeInTheDocument();
  });

  it('renders nothing when all videos are archived', () => {
    const { container } = renderList({ videos: [makeVideo('a1', true), makeVideo('a2', true)] });
    expect(screen.queryByTestId('row-a1')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
  });
});

describe('VideoList — serialNumber rank', () => {
  it('passes serialNumber as rank when video has serialNumber set', () => {
    const video = { ...makeVideo('v1'), serialNumber: 41 };
    renderList({ videos: [video] });
    // rank=41 is rendered as text in the first <td> of the mock row
    expect(screen.getByTestId('row-v1')).toHaveTextContent('41');
  });

  it('passes serialNumber as rank — not the loop position — so the value is stable', () => {
    // v1 has serialNumber 7 even though it is the first row; the rank must be 7, not 1
    const video = { ...makeVideo('v1'), serialNumber: 7 };
    renderList({ videos: [video] });
    expect(screen.getByTestId('row-v1')).toHaveTextContent('7');
  });

  it('serialNumber values are stable regardless of display order', () => {
    const v1 = { ...makeVideo('v1'), serialNumber: 5 };
    const v2 = { ...makeVideo('v2'), serialNumber: 2 };
    renderList({ videos: [v1, v2] });
    expect(screen.getByTestId('row-v1')).toHaveTextContent('5');
    expect(screen.getByTestId('row-v2')).toHaveTextContent('2');
  });

  it('passes rank=undefined (not the loop position) when a video has no serialNumber', () => {
    // makeVideo leaves serialNumber unset → the first rank cell must be empty, NOT "1".
    // Guards against regressing to the old `playlistIndex ?? i + 1` fallback.
    renderList({ videos: [makeVideo('v1')] });
    const rankCell = screen.getByTestId('row-v1').querySelector('td');
    expect(rankCell?.textContent).toBe('');
  });
});

describe('VideoList — sort column headers', () => {
  function renderWithSort({
    videos = [makeVideo('v1')] as Video[],
    sortColumn = null as SortColumn | null,
    sortOrder = 'asc' as SortOrder,
    onSort = jest.fn(),
  } = {}) {
    return render(
      <VideoList
        videos={videos}
        outputFolder={OUTPUT_FOLDER}
        baseOutputFolder={OUTPUT_FOLDER}
        showArchive={true}
        onArchive={jest.fn()}
        onGenerateHtml={jest.fn()}
        sortColumn={sortColumn}
        sortOrder={sortOrder}
        onSort={onSort}
      />,
    );
  }

  it('renders 9 sort buttons in the column header row when onSort is provided', () => {
    // Sortable: #, Title, Channel, Duration, Published, Added, Lang, OVR, My Score.
    // Note has no sort button.
    renderWithSort();
    const headers = screen.getAllByRole('columnheader');
    const sortableHeaders = headers.filter((th) => th.querySelector('button') !== null);
    expect(sortableHeaders).toHaveLength(9);
  });

  it('clicking # column calls onSort("serialNumber", "asc") when unsorted', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Serial number' }));
    expect(onSort).toHaveBeenCalledWith('serialNumber', 'asc');
  });

  it('clicking Title column calls onSort("name", "asc")', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('clicking OVR column calls onSort("overall", "asc")', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Overall' }));
    expect(onSort).toHaveBeenCalledWith('overall', 'asc');
  });

  it('clicking Channel column calls onSort("channel", "asc")', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Channel' }));
    expect(onSort).toHaveBeenCalledWith('channel', 'asc');
  });

  it('clicking Duration column calls onSort("durationSeconds", "asc")', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Duration' }));
    expect(onSort).toHaveBeenCalledWith('durationSeconds', 'asc');
  });

  it('clicking active column (asc) calls onSort with desc', () => {
    const onSort = jest.fn();
    renderWithSort({ sortColumn: 'overall', sortOrder: 'asc', onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Overall, sorted ascending' }));
    expect(onSort).toHaveBeenCalledWith('overall', 'desc');
  });

  it('clicking active column (desc) calls onSort with asc', () => {
    const onSort = jest.fn();
    renderWithSort({ sortColumn: 'overall', sortOrder: 'desc', onSort });
    fireEvent.click(screen.getByRole('button', { name: 'Overall, sorted descending' }));
    expect(onSort).toHaveBeenCalledWith('overall', 'asc');
  });

  it('active column (asc) shows ↑ in button text', () => {
    renderWithSort({ sortColumn: 'overall', sortOrder: 'asc' });
    expect(screen.getByRole('button', { name: 'Overall, sorted ascending' })).toHaveTextContent('↑');
  });

  it('active column (desc) shows ↓ in button text', () => {
    renderWithSort({ sortColumn: 'overall', sortOrder: 'desc' });
    expect(screen.getByRole('button', { name: 'Overall, sorted descending' })).toHaveTextContent('↓');
  });

  it('non-active column shows no arrow', () => {
    renderWithSort({ sortColumn: 'overall', sortOrder: 'asc' });
    const titleBtn = screen.getByRole('button', { name: 'Title' });
    expect(titleBtn.textContent).not.toMatch(/[↑↓]/);
  });

  it('first click on Published calls onSort("videoPublishedAt", "desc")', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: /published on youtube/i }));
    expect(onSort).toHaveBeenCalledWith('videoPublishedAt', 'desc');
  });

  it('first click on Added calls onSort("addedToPlaylistAt", "desc")', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: /added to playlist/i }));
    expect(onSort).toHaveBeenCalledWith('addedToPlaylistAt', 'desc');
  });

  it('clicking active Published (desc) calls onSort with asc', () => {
    const onSort = jest.fn();
    renderWithSort({ sortColumn: 'videoPublishedAt', sortOrder: 'desc', onSort });
    fireEvent.click(screen.getByRole('button', { name: /published on youtube/i }));
    expect(onSort).toHaveBeenCalledWith('videoPublishedAt', 'asc');
  });

  it('first click on non-date column (Title) still calls onSort with asc', () => {
    const onSort = jest.fn();
    renderWithSort({ onSort });
    fireEvent.click(screen.getByRole('button', { name: /^title$/i }));
    expect(onSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('column headers are plain text (no buttons) when onSort is not provided', () => {
    render(
      <VideoList
        videos={[makeVideo('v1')]}
        outputFolder={OUTPUT_FOLDER}
        baseOutputFolder={OUTPUT_FOLDER}
        showArchive={true}
        onArchive={jest.fn()}
        onGenerateHtml={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Playlist position' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Title' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Overall' })).toBeNull();
  });
});

describe('VideoList — archive visibility (showArchive=true)', () => {
  it('shows archived rows in the DOM when showArchive=true', () => {
    renderList({ videos: [makeVideo('a1', true)], showArchive: true });
    expect(screen.getByTestId('row-a1')).toBeInTheDocument();
  });

  it('toggles archived row visibility when showArchive changes', () => {
    const archivedVideo = makeVideo('a1', true);
    const { rerender } = render(
      <VideoList
        videos={[archivedVideo]}
        outputFolder={OUTPUT_FOLDER}
        baseOutputFolder={OUTPUT_FOLDER}
        showArchive={false}
        onArchive={jest.fn()}
        onGenerateHtml={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('row-a1')).toBeNull();

    rerender(
      <VideoList
        videos={[archivedVideo]}
        outputFolder={OUTPUT_FOLDER}
        baseOutputFolder={OUTPUT_FOLDER}
        showArchive={true}
        onArchive={jest.fn()}
        onGenerateHtml={jest.fn()}
      />,
    );
    expect(screen.getByTestId('row-a1')).toBeInTheDocument();

    rerender(
      <VideoList
        videos={[archivedVideo]}
        outputFolder={OUTPUT_FOLDER}
        baseOutputFolder={OUTPUT_FOLDER}
        showArchive={false}
        onArchive={jest.fn()}
        onGenerateHtml={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('row-a1')).toBeNull();
  });
});

describe('My Score and Note column headers', () => {
  it('renders a My Score column header', () => {
    render(<VideoList videos={[makeVideo('v1')]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} onArchive={jest.fn()} onGenerateHtml={jest.fn()} />);
    expect(screen.getByText('My Score')).toBeInTheDocument();
  });

  it('renders a Note column header', () => {
    render(<VideoList videos={[makeVideo('v1')]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} onArchive={jest.fn()} onGenerateHtml={jest.fn()} />);
    expect(screen.getByText('Note')).toBeInTheDocument();
  });

  it('Note column has no sort button', () => {
    render(<VideoList videos={[makeVideo('v1')]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} onArchive={jest.fn()} onGenerateHtml={jest.fn()}
      onSort={jest.fn()} />);
    // My Score has a sort button; Note does not
    expect(screen.queryByRole('button', { name: /Note/i })).not.toBeInTheDocument();
  });

  it('first click on My Score header calls onSort with desc order', () => {
    const onSort = jest.fn();
    render(<VideoList videos={[makeVideo('v1')]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} onArchive={jest.fn()} onGenerateHtml={jest.fn()} onSort={onSort} />);
    fireEvent.click(screen.getByRole('button', { name: /my score/i }));
    expect(onSort).toHaveBeenCalledWith('personalScore', 'desc');
  });
});

describe('dimUnscored prop forwarding', () => {
  it('passes dimUnscored=true to VideoRow when minPersonalScore>0 and video has no score', () => {
    const video = { ...baseVideo, personalScore: undefined };
    render(<VideoList videos={[video]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} minPersonalScore={3}
      onArchive={jest.fn()} onGenerateHtml={jest.fn()} />);
    expect(screen.getByTestId(`row-${video.id}`)).toHaveAttribute('data-dim', 'true');
  });

  it('passes dimUnscored=false when minPersonalScore=0', () => {
    const video = { ...baseVideo, personalScore: undefined };
    render(<VideoList videos={[video]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} minPersonalScore={0}
      onArchive={jest.fn()} onGenerateHtml={jest.fn()} />);
    expect(screen.getByTestId(`row-${video.id}`)).toHaveAttribute('data-dim', 'false');
  });
});

describe('onAnnotationChange forwarding', () => {
  it('threads onAnnotationChange to VideoRow', () => {
    const onAnnotationChange = jest.fn();
    render(<VideoList videos={[baseVideo]} outputFolder="/tmp" baseOutputFolder="/tmp"
      showArchive={true} onArchive={jest.fn()} onGenerateHtml={jest.fn()}
      onAnnotationChange={onAnnotationChange} />);
    fireEvent.click(screen.getByRole('button', { name: /annotate/i }));
    expect(onAnnotationChange).toHaveBeenCalledWith(baseVideo.id, { personalScore: 4 });
  });
});
