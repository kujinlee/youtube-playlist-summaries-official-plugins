/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import VideoList from '../../components/VideoList';
import type { Video } from '../../types';

function v(id: string, over: Partial<Video> = {}): Video {
  return {
    id, title: `T${id}`, youtubeUrl: `https://youtu.be/${id}`, language: 'en', durationSeconds: 1,
    archived: false, ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: `${id}.md`, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-29T00:00:00.000Z', docVersion: { major: 3, minor: 3 },
    ...over,
  } as Video;
}

const baseProps = {
  outputFolder: '/p', baseOutputFolder: '/p', showArchive: true,
  onDeepDive: () => {}, onArchive: () => {}, onGenerateHtml: () => {},
  selected: new Set<string>(), onToggleSelect: () => {}, onSelectAllNeeding: () => {},
};

it('CA1: clicking a row checkbox calls onToggleSelect with the videoId', () => {
  const onToggleSelect = jest.fn();
  render(<VideoList {...baseProps} videos={[v('a')]} onToggleSelect={onToggleSelect} />);
  fireEvent.click(screen.getByLabelText('Select Ta'));
  expect(onToggleSelect).toHaveBeenCalledWith('a');
});

it('CA2: a row with no summaryMd has a disabled checkbox', () => {
  render(<VideoList {...baseProps} videos={[v('a', { summaryMd: null })]} />);
  expect(screen.getByLabelText('Select Ta')).toBeDisabled();
});

it('CA3: header select-all calls onSelectAllNeeding with only missing/stale visible rows', () => {
  const onSelectAllNeeding = jest.fn();
  const videos = [
    v('a', { summaryHtml: null }),                                   // needs work
    v('b', { summaryHtml: 'b.html', docVersion: { major: 3, minor: 3 } }), // current
    v('c', { summaryMd: null }),                                     // not selectable
  ];
  render(<VideoList {...baseProps} videos={videos} onSelectAllNeeding={onSelectAllNeeding} />);
  fireEvent.click(screen.getByLabelText('Select all needing generation'));
  const arg = onSelectAllNeeding.mock.calls[0][0] as Video[];
  expect(arg.map((x) => x.id)).toEqual(['a']);
});

it('CA1: header checkbox is checked when all needing rows are selected', () => {
  const videos = [v('a', { summaryHtml: null })];
  render(<VideoList {...baseProps} videos={videos} selected={new Set(['a'])} />);
  expect(screen.getByLabelText('Select all needing generation')).toBeChecked();
});

it('H3: a row in the active batch has a disabled checkbox', () => {
  render(<VideoList {...baseProps} videos={[v('a')]} activeBatchVideoIds={new Set(['a'])} />);
  expect(screen.getByLabelText('Select Ta')).toBeDisabled();
});
