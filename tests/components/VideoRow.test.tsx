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
    onArchive?: jest.Mock;
    onGenerateHtml?: jest.Mock;
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
          onArchive={options.onArchive ?? jest.fn()}
          onGenerateHtml={options.onGenerateHtml ?? jest.fn()}
          onAnnotationChange={onAnnotationChange}
        />
      </tbody>
    </table>,
  );
  return { onAnnotationChange, video };
}

function openMenu(overrides: Partial<Video> = {}, onArchive = jest.fn()) {
  const result = renderRow(overrides, { onArchive });
  fireEvent.click(screen.getByRole('button', { name: /menu/i }));
  return result;
}

describe('VideoRow', () => {
  describe('rank cell (serial number)', () => {
    // The rank cell is the only <td> carrying both `tabular-nums` and `text-zinc-500`
    // (the Published/Added cells use `text-zinc-400`), so scope assertions to it —
    // otherwise an absent publish date also renders an em dash and the query is ambiguous.
    function rankCellText(rank: number | undefined): string {
      const { container } = render(
        <table>
          <tbody>
            <VideoRow
              video={baseVideo}
              rank={rank}
              outputFolder={OUTPUT_FOLDER}
              baseOutputFolder={BASE_OUTPUT_FOLDER}
              dimUnscored={false}
              onArchive={jest.fn()}
              onGenerateHtml={jest.fn()}
              onAnnotationChange={jest.fn()}
            />
          </tbody>
        </table>,
      );
      const cell = container.querySelector('td.tabular-nums.text-zinc-500');
      return cell?.textContent ?? '';
    }

    it('renders the serial number when rank is set', () => {
      expect(rankCellText(7)).toBe('7');
    });

    it('renders an em dash when rank is undefined (no serial assigned yet)', () => {
      expect(rankCellText(undefined)).toBe('—');
    });
  });

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

    it('renders the overall score in its cell', () => {
      renderRow();
      expect(screen.getByRole('cell', { name: 'Overall' })).toHaveTextContent('3.4');
    });

    describe('Channel cell', () => {
      it('renders the channel name when set', () => {
        renderRow({ channel: 'DeepLearningAI' });
        expect(screen.getByRole('cell', { name: 'Channel' })).toHaveTextContent('DeepLearningAI');
      });

      it('renders an em dash when channel is absent', () => {
        renderRow({ channel: undefined });
        expect(screen.getByRole('cell', { name: 'Channel' })).toHaveTextContent('—');
      });
    });

    describe('Duration cell', () => {
      it('renders the duration as a clock string (m:ss)', () => {
        renderRow({ durationSeconds: 300 });
        expect(screen.getByRole('cell', { name: 'Duration' })).toHaveTextContent('5:00');
      });

      it('renders hours for long videos (h:mm:ss)', () => {
        renderRow({ durationSeconds: 8927 });
        expect(screen.getByRole('cell', { name: 'Duration' })).toHaveTextContent('2:28:47');
      });
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
      // cells[0] is the checkbox cell (no dim), cells[1] is the chevron cell (no dim), cells[2] is the rank cell (has opacity-40)
      expect(cells[2]).toHaveClass('opacity-40');
    });

    it('does not apply opacity-40 when video is not archived', () => {
      renderRow({ archived: false });
      expect(screen.getByRole('row')).not.toHaveClass('opacity-40');
      const cells = screen.getAllByRole('cell');
      // cells[2] is the rank cell
      expect(cells[2]).not.toHaveClass('opacity-40');
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
                onArchive={jest.fn()}
                onGenerateHtml={jest.fn()}
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

      // The Obsidian vault is the playlist-level folder: the FIRST path segment of
      // outputFolder below baseOutputFolder (the data root). Subfolders like raw/
      // are part of the note path, not the vault — matching how each playlist folder
      // (agentic-ai-claude-code, cs146s-…) is registered as its own Obsidian vault.
      describe('vault = first folder below baseOutputFolder', () => {
        function renderMenu(
          baseOutputFolder: string,
          outputFolder: string,
          overrides: Partial<Video> = {},
        ) {
          render(
            <table>
              <tbody>
                <VideoRow
                  video={{ ...baseVideo, ...overrides }}
                  rank={1}
                  outputFolder={outputFolder}
                  baseOutputFolder={baseOutputFolder}
                  dimUnscored={false}
                  onArchive={jest.fn()}
                  onGenerateHtml={jest.fn()}
                  onAnnotationChange={jest.fn()}
                />
              </tbody>
            </table>,
          );
          fireEvent.click(screen.getByRole('button', { name: /menu/i }));
        }
        const summaryHref = () =>
          screen.getByRole('link', { name: /open in obsidian/i }).getAttribute('href');

        it('nested playlist+subfolder: vault is the playlist folder, file keeps the subfolder', () => {
          renderMenu('/Users/test/data', '/Users/test/data/agentic-ai-claude-code/raw');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('agentic-ai-claude-code')}&file=${encodeURIComponent('raw/summary')}`,
          );
        });

        it('flat playlist: the playlist folder itself is the vault, no file prefix', () => {
          renderMenu('/Users/test/data', '/Users/test/data/cs146s-the-modern-software-development');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('cs146s-the-modern-software-development')}&file=${encodeURIComponent('summary')}`,
          );
        });

        it('single subfolder under base: that subfolder is the vault', () => {
          renderMenu('/Users/test/vault', '/Users/test/vault/my-playlist');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('my-playlist')}&file=${encodeURIComponent('summary')}`,
          );
        });

        it('output equals base: falls back to the base basename', () => {
          renderMenu('/Users/test/vault', '/Users/test/vault');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('vault')}&file=${encodeURIComponent('summary')}`,
          );
        });

        it('output not under base: falls back to the output basename', () => {
          renderMenu('/Users/other', '/Users/test/playlist');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('playlist')}&file=${encodeURIComponent('summary')}`,
          );
        });

        it('look-alike sibling prefix is NOT treated as under base (data vs data-2)', () => {
          // base '/Users/test/data' must not prefix-match '/Users/test/data-2/...'
          renderMenu('/Users/test/data', '/Users/test/data-2/raw');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('raw')}&file=${encodeURIComponent('summary')}`,
          );
        });

        it('normalises trailing slashes on both folders', () => {
          renderMenu('/Users/test/data/', '/Users/test/data/agentic-ai-claude-code/raw/');
          expect(summaryHref()).toBe(
            `obsidian://open?vault=${encodeURIComponent('agentic-ai-claude-code')}&file=${encodeURIComponent('raw/summary')}`,
          );
        });
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
        openMenu({ archived: false }, onArchive);
        fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
        expect(onArchive).toHaveBeenCalledWith('abc123', 'archive');
      });

      it('calls onArchive with video id and "unarchive" when clicked and archived', () => {
        const onArchive = jest.fn();
        openMenu({ archived: true }, onArchive);
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

    describe('menu items present', () => {
      it('renders all active menu actions without PDF items', () => {
        openMenu();
        expect(screen.getByRole('link', { name: /watch on youtube/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open in obsidian/i })).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: /^(archive|unarchive)$/i }),
        ).toBeInTheDocument();
        // PDF items should not be rendered (PDF generation removed)
        expect(screen.queryByText('View Summary PDF')).not.toBeInTheDocument();
        expect(screen.queryByText('View Deep Dive PDF')).not.toBeInTheDocument();
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
      // cells[0] is the checkbox cell (no dim), cells[1] is the chevron cell (no dim), cells[2] is the rank cell (has opacity-50)
      expect(cells[2]).toHaveClass('opacity-50');
    });

    it('applies opacity-40 when archived, taking precedence over dimUnscored', () => {
      renderRow({ archived: true, personalScore: undefined }, { dimUnscored: true });
      const cells = screen.getAllByRole('cell');
      // cells[2] is the rank cell
      expect(cells[2]).toHaveClass('opacity-40');
      expect(cells[2]).not.toHaveClass('opacity-50');
    });
  });

  describe('busy hourglass', () => {
    const rowProps = {
      video: baseVideo,
      rank: 1,
      outputFolder: OUTPUT_FOLDER,
      baseOutputFolder: BASE_OUTPUT_FOLDER,
      dimUnscored: false,
      onArchive: jest.fn(),
      onGenerateHtml: jest.fn(),
      onAnnotationChange: jest.fn(),
    };

    it('shows an hourglass next to the menu while busy', () => {
      render(<table><tbody><VideoRow {...rowProps} busy /></tbody></table>);
      expect(screen.getByLabelText('Regenerating')).toBeInTheDocument();
    });
    it('no hourglass when not busy', () => {
      render(<table><tbody><VideoRow {...rowProps} /></tbody></table>);
      expect(screen.queryByLabelText('Regenerating')).toBeNull();
    });
  });

  describe('VideoRow — expand/collapse', () => {
    beforeEach(() => {
      // Provide a default fetch mock so VideoQuickView does not throw when
      // a test expands a row that has no tldr (VideoQuickView fetches on mount).
      global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('renders a collapse chevron button (▶) initially', () => {
      renderRow();
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expand/i }).textContent).toBe('▶');
    });

    it('clicking chevron expands the row — shows VideoQuickView area', () => {
      renderRow({ tldr: 'This video teaches X.', takeaways: ['Point one'], tags: ['ai'] });
      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      expect(screen.getByText('This video teaches X.')).toBeInTheDocument();
    });

    it('clicking chevron again collapses the row', () => {
      renderRow({ tldr: 'This video teaches X.', takeaways: [], tags: [] });
      const chevron = screen.getByRole('button', { name: /expand/i });
      fireEvent.click(chevron);
      expect(screen.getByText('This video teaches X.')).toBeInTheDocument();
      fireEvent.click(chevron);
      expect(screen.queryByText('This video teaches X.')).not.toBeInTheDocument();
    });

    it('chevron label changes to ▼ when expanded', () => {
      renderRow();
      const chevron = screen.getByRole('button', { name: /expand/i });
      fireEvent.click(chevron);
      expect(chevron.textContent).toBe('▼');
    });

    it('clicking the title cell expands the row', () => {
      renderRow({ tldr: 'This video teaches Y.', takeaways: [], tags: [] });
      const titleCell = screen.getByText('Test Video Title').closest('td')!;
      fireEvent.click(titleCell);
      expect(screen.getByText('This video teaches Y.')).toBeInTheDocument();
    });

    it('clicking the title cell again collapses the row', () => {
      renderRow({ tldr: 'This video teaches Y.', takeaways: [], tags: [] });
      const titleCell = screen.getByText('Test Video Title').closest('td')!;
      fireEvent.click(titleCell);
      expect(screen.getByText('This video teaches Y.')).toBeInTheDocument();
      fireEvent.click(titleCell);
      expect(screen.queryByText('This video teaches Y.')).not.toBeInTheDocument();
    });

    it('does not fetch quick-view when tldr is already present and row is expanded', () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;
      renderRow({ tldr: 'This video teaches X.', takeaways: [], tags: [] });
      fireEvent.click(screen.getByRole('button', { name: /expand/i }));
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
