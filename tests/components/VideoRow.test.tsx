/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoRow from '@/components/VideoRow';
import type { Video } from '@/types';

const baseVideo: Video = {
  id: 'abc123',
  title: 'Test Video Title',
  youtubeUrl: 'https://www.youtube.com/watch?v=abc123',
  language: 'en',
  durationSeconds: 300,
  archived: false,
  ratings: {
    usefulness: 4,
    depth: 3,
    originality: 5,
    recency: 2,
    completeness: 3,
  },
  overallScore: 3.4,
  summaryMd: 'summary.md',
  summaryPdf: 'summary.pdf',
  deepDiveMd: null,
  deepDivePdf: null,
  processedAt: '2024-01-01T00:00:00.000Z',
};

const BASE_OUTPUT_FOLDER = '/Users/test/vault';
const OUTPUT_FOLDER = BASE_OUTPUT_FOLDER; // flat: playlist lives at vault root

// VideoRow renders <tr> — jsdom requires a table/tbody wrapper for correct DOM structure
function renderRow(
  overrides: Partial<Video> = {},
  options: {
    dimUnscored?: boolean;
    onAnnotationChange?: jest.Mock;
    onDeepDive?: jest.Mock;
    onArchive?: jest.Mock;
  } = {},
) {
  const video = { ...baseVideo, ...overrides };
  const onAnnotationChange = options.onAnnotationChange ?? jest.fn();
  render(
    <table>
      <tbody>
        <VideoRow
          video={video}
          rank={1}
          outputFolder={OUTPUT_FOLDER}
          baseOutputFolder={BASE_OUTPUT_FOLDER}
          dimUnscored={options.dimUnscored ?? false}
          onDeepDive={options.onDeepDive ?? jest.fn()}
          onArchive={options.onArchive ?? jest.fn()}
          onAnnotationChange={onAnnotationChange}
        />
      </tbody>
    </table>,
  );
  return { onAnnotationChange, video };
}

function openMenu(overrides: Partial<Video> = {}, onDeepDive = jest.fn(), onArchive = jest.fn()) {
  const result = renderRow(overrides, { onDeepDive, onArchive });
  fireEvent.click(screen.getByRole('button', { name: /menu/i }));
  return result;
}

describe('VideoRow', () => {
  describe('row display', () => {
    it('renders the video title', () => {
      renderRow();
      expect(screen.getByText('Test Video Title')).toBeInTheDocument();
    });

    it('renders EN badge for English videos', () => {
      renderRow({ language: 'en' });
      expect(screen.getByText('EN')).toBeInTheDocument();
    });

    it('renders KO badge for Korean videos', () => {
      renderRow({ language: 'ko' });
      expect(screen.getByText('KO')).toBeInTheDocument();
    });

    it('renders all 6 rating values in their respective cells', () => {
      renderRow();
      expect(screen.getByRole('cell', { name: 'Usefulness' })).toHaveTextContent('4');
      expect(screen.getByRole('cell', { name: 'Depth' })).toHaveTextContent('3');
      expect(screen.getByRole('cell', { name: 'Originality' })).toHaveTextContent('5');
      expect(screen.getByRole('cell', { name: 'Recency' })).toHaveTextContent('2');
      expect(screen.getByRole('cell', { name: 'Completeness' })).toHaveTextContent('3');
      expect(screen.getByRole('cell', { name: 'Overall' })).toHaveTextContent('3.4');
    });

    it('renders a menu toggle button', () => {
      renderRow();
      expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
    });

    it('applies opacity-40 to data cells (not the row) when video is archived', () => {
      renderRow({ archived: true });
      // opacity-40 must be on cells, not on <tr>, to avoid creating a CSS stacking
      // context that would make the absolutely-positioned VideoMenu unclickable.
      expect(screen.getByRole('row')).not.toHaveClass('opacity-40');
      const cells = screen.getAllByRole('cell');
      // At least the rank cell (first) should carry opacity-40
      expect(cells[0]).toHaveClass('opacity-40');
    });

    it('does not apply opacity-40 when video is not archived', () => {
      renderRow({ archived: false });
      expect(screen.getByRole('row')).not.toHaveClass('opacity-40');
      const cells = screen.getAllByRole('cell');
      expect(cells[0]).not.toHaveClass('opacity-40');
    });

    it('renders videoType badge when videoType is set', () => {
      renderRow({ videoType: 'Tutorial' });
      expect(screen.getByText('Tutorial')).toBeInTheDocument();
    });

    it('renders no videoType badge when videoType is undefined', () => {
      renderRow({ videoType: undefined });
      expect(screen.queryByText('Tutorial')).not.toBeInTheDocument();
    });

    it('renders audience badge when audience is set', () => {
      renderRow({ audience: 'Advanced' });
      expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('renders no audience badge when audience is undefined', () => {
      renderRow({ audience: undefined });
      expect(screen.queryByText('Advanced')).not.toBeInTheDocument();
    });

    describe('date cells', () => {
      it('renders videoPublishedAt as YYYY-MM-DD', () => {
        renderRow({ videoPublishedAt: '2024-11-12T14:30:00.000Z' });
        expect(screen.getByRole('cell', { name: 'Published on YouTube' })).toHaveTextContent('2024-11-12');
      });

      it('renders — when videoPublishedAt is absent', () => {
        renderRow(); // baseVideo has no videoPublishedAt
        expect(screen.getByRole('cell', { name: 'Published on YouTube' })).toHaveTextContent('—');
      });

      it('renders addedToPlaylistAt as YYYY-MM-DD', () => {
        renderRow({ addedToPlaylistAt: '2025-01-03T09:00:00.000Z' });
        expect(screen.getByRole('cell', { name: 'Added to playlist' })).toHaveTextContent('2025-01-03');
      });

      it('renders — when addedToPlaylistAt is absent', () => {
        renderRow(); // baseVideo has no addedToPlaylistAt
        expect(screen.getByRole('cell', { name: 'Added to playlist' })).toHaveTextContent('—');
      });
    });
  });

  describe('menu visibility', () => {
    it('menu is hidden initially', () => {
      renderRow();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('menu opens after clicking the toggle button', () => {
      renderRow();
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('menu closes after clicking the toggle button a second time', () => {
      renderRow();
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('menu closes on Escape key', () => {
      renderRow();
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('toggle button has aria-expanded=false when menu is closed', () => {
      renderRow();
      expect(screen.getByRole('button', { name: /menu/i })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });

    it('toggle button has aria-expanded=true when menu is open', () => {
      renderRow();
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      expect(screen.getByRole('button', { name: /menu/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  describe('menu actions', () => {
    describe('Open in Obsidian', () => {
      it('is a link with correct obsidian:// href', () => {
        openMenu();
        const link = screen.getByRole('link', { name: /open in obsidian/i });
        // vault= is the basename of outputFolder ('/Users/test/vault' → 'vault')
        const expectedVault = encodeURIComponent('vault');
        // summaryMd is 'summary.md' → strip .md → 'summary'
        const expectedFile = encodeURIComponent('summary');
        expect(link).toHaveAttribute(
          'href',
          `obsidian://open?vault=${expectedVault}&file=${expectedFile}`,
        );
      });

      it('encodes special characters in vault name', () => {
        const specialFolder = '/Users/test/my vault & notes';
        render(
          <table>
            <tbody>
              <VideoRow
                video={baseVideo}
                rank={1}
                outputFolder={specialFolder}
                baseOutputFolder={specialFolder}
                dimUnscored={false}
                onDeepDive={jest.fn()}
                onArchive={jest.fn()}
                onAnnotationChange={jest.fn()}
              />
            </tbody>
          </table>,
        );
        fireEvent.click(screen.getByRole('button', { name: /menu/i }));
        const link = screen.getByRole('link', { name: /open in obsidian/i });
        // vault= is the basename ('my vault & notes'), special chars must be encoded
        expect(link.getAttribute('href')).toContain(encodeURIComponent('my vault & notes'));
      });

      it('uses baseOutputFolder for vault and prefixes file with subfolder when outputFolder is a subdirectory', () => {
        const baseFolder = '/Users/test/vault';
        const subFolder = '/Users/test/vault/my-playlist';
        render(
          <table>
            <tbody>
              <VideoRow
                video={baseVideo}
                rank={1}
                outputFolder={subFolder}
                baseOutputFolder={baseFolder}
                dimUnscored={false}
                onDeepDive={jest.fn()}
                onArchive={jest.fn()}
                onAnnotationChange={jest.fn()}
              />
            </tbody>
          </table>,
        );
        fireEvent.click(screen.getByRole('button', { name: /menu/i }));
        const link = screen.getByRole('link', { name: /open in obsidian/i });
        // vault= basename of baseOutputFolder ('vault'), not the subfolder
        // file= subfolder/slug ('my-playlist/summary')
        expect(link).toHaveAttribute(
          'href',
          `obsidian://open?vault=${encodeURIComponent('vault')}&file=${encodeURIComponent('my-playlist/summary')}`,
        );
      });
    });

    describe('View Summary PDF', () => {
      it('is a link pointing to /api/pdf/[id]?outputFolder=...&type=summary when summaryPdf is set', () => {
        openMenu({ summaryPdf: 'summary.pdf' });
        const link = screen.getByRole('link', { name: /view summary pdf/i });
        const expected = `/api/pdf/abc123?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=summary`;
        expect(link).toHaveAttribute('href', expected);
      });

      it('is disabled when summaryPdf is null', () => {
        openMenu({ summaryPdf: null });
        const link = screen.getByRole('link', { name: /view summary pdf/i });
        expect(link).toHaveAttribute('aria-disabled', 'true');
        expect(link).toHaveAttribute('tabindex', '-1');
      });
    });

    describe('Deep Dive', () => {
      it('is a button (not a link)', () => {
        openMenu();
        const btn = screen.getByRole('button', { name: /^deep dive$/i });
        expect(btn.tagName).toBe('BUTTON');
      });

      it('is enabled regardless of deepDiveMd value', () => {
        openMenu({ deepDiveMd: null });
        expect(screen.getByRole('button', { name: /^deep dive$/i })).toBeEnabled();
      });

      it('calls onDeepDive with video id when clicked', () => {
        const onDeepDive = jest.fn();
        openMenu({}, onDeepDive);
        fireEvent.click(screen.getByRole('button', { name: /^deep dive$/i }));
        expect(onDeepDive).toHaveBeenCalledWith('abc123');
      });
    });

    describe('Open Deep Dive in Obsidian', () => {
      it('is disabled when deepDiveMd is null', () => {
        openMenu({ deepDiveMd: null });
        const item = screen.getByRole('link', { name: /open deep dive in obsidian/i });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        expect(item).toHaveAttribute('tabindex', '-1');
      });

      it('is enabled when deepDiveMd is non-null', () => {
        openMenu({ deepDiveMd: 'abc123-deep-dive.md' });
        const item = screen.getByRole('link', { name: /open deep dive in obsidian/i });
        expect(item).not.toHaveAttribute('aria-disabled', 'true');
      });

      it('has correct obsidian:// href with deep-dive file when enabled', () => {
        openMenu({ deepDiveMd: 'abc123-deep-dive.md' });
        const link = screen.getByRole('link', { name: /open deep dive in obsidian/i });
        // vault= is the basename of baseOutputFolder ('/Users/test/vault' → 'vault')
        // flat layout: no subfolder prefix on file
        const expectedVault = encodeURIComponent('vault');
        const expectedFile = encodeURIComponent('abc123-deep-dive');
        expect(link).toHaveAttribute(
          'href',
          `obsidian://open?vault=${expectedVault}&file=${expectedFile}`,
        );
      });
    });

    describe('View Deep Dive PDF', () => {
      it('is disabled when deepDivePdf is null', () => {
        openMenu({ deepDiveMd: 'abc123-deep-dive.md', deepDivePdf: null });
        const item = screen.getByRole('link', { name: /view deep dive pdf/i });
        expect(item).toHaveAttribute('aria-disabled', 'true');
        expect(item).toHaveAttribute('tabindex', '-1');
      });

      it('is disabled when deepDiveMd is null', () => {
        openMenu({ deepDiveMd: null, deepDivePdf: null });
        const item = screen.getByRole('link', { name: /view deep dive pdf/i });
        expect(item).toHaveAttribute('aria-disabled', 'true');
      });

      it('is enabled when both deepDiveMd and deepDivePdf are non-null', () => {
        openMenu({ deepDiveMd: 'abc123-deep-dive.md', deepDivePdf: 'abc123-deep-dive.pdf' });
        const item = screen.getByRole('link', { name: /view deep dive pdf/i });
        expect(item).not.toHaveAttribute('aria-disabled', 'true');
      });

      it('points to /api/pdf/[id]?outputFolder=...&type=deep-dive when enabled', () => {
        openMenu({ deepDiveMd: 'abc123-deep-dive.md', deepDivePdf: 'abc123-deep-dive.pdf' });
        const link = screen.getByRole('link', { name: /view deep dive pdf/i });
        const expected = `/api/pdf/abc123?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=deep-dive`;
        expect(link).toHaveAttribute('href', expected);
      });
    });

    describe('Archive / Unarchive', () => {
      it('shows "Archive" when video.archived is false', () => {
        openMenu({ archived: false });
        expect(screen.getByRole('button', { name: /^archive$/i })).toBeInTheDocument();
      });

      it('shows "Unarchive" when video.archived is true', () => {
        openMenu({ archived: true });
        expect(screen.getByRole('button', { name: /^unarchive$/i })).toBeInTheDocument();
      });

      it('calls onArchive with video id and "archive" when clicked and not archived', () => {
        const onArchive = jest.fn();
        openMenu({ archived: false }, jest.fn(), onArchive);
        fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
        expect(onArchive).toHaveBeenCalledWith('abc123', 'archive');
      });

      it('calls onArchive with video id and "unarchive" when clicked and archived', () => {
        const onArchive = jest.fn();
        openMenu({ archived: true }, jest.fn(), onArchive);
        fireEvent.click(screen.getByRole('button', { name: /^unarchive$/i }));
        expect(onArchive).toHaveBeenCalledWith('abc123', 'unarchive');
      });
    });

    describe('Watch on YouTube', () => {
      it('is a link pointing to video.youtubeUrl', () => {
        openMenu();
        const link = screen.getByRole('link', { name: /watch on youtube/i });
        expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123');
        expect(link).toHaveAttribute('target', '_blank');
      });
    });

    describe('all 7 menu items present', () => {
      it('renders all 7 actions', () => {
        openMenu({ deepDiveMd: 'abc123-deep-dive.md', deepDivePdf: 'abc123-deep-dive.pdf' });
        expect(screen.getByRole('link', { name: /watch on youtube/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open in obsidian/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /view summary pdf/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^deep dive$/i })).toBeInTheDocument();
        expect(
          screen.getByRole('link', { name: /open deep dive in obsidian/i }),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /view deep dive pdf/i })).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: /^(archive|unarchive)$/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe('personal review columns', () => {
    it('renders the My Score radiogroup', () => {
      renderRow();
      expect(screen.getByRole('radiogroup', { name: /my score/i })).toBeInTheDocument();
    });

    it('renders the Note cell with — when personalNote is undefined', () => {
      renderRow({ personalNote: undefined });
      // NoteCell renders a button with text "—"
      expect(screen.getAllByRole('button').some((btn) => btn.textContent === '—')).toBe(true);
    });

    it('applies opacity-50 to data cells when dimUnscored is true', () => {
      renderRow({ personalScore: undefined }, { dimUnscored: true });
      const cells = screen.getAllByRole('cell');
      // First data cell (rank) should have opacity-50
      expect(cells[0]).toHaveClass('opacity-50');
    });

    it('applies opacity-40 when archived, taking precedence over dimUnscored', () => {
      renderRow({ archived: true, personalScore: undefined }, { dimUnscored: true });
      const cells = screen.getAllByRole('cell');
      expect(cells[0]).toHaveClass('opacity-40');
      expect(cells[0]).not.toHaveClass('opacity-50');
    });
  });
});
