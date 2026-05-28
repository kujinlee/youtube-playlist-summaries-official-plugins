import crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migratePdfsInPlaylistFolder } from '../../scripts/migrate-pdfs-to-subfolder';

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `migrate-pdf-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeIndex(folder: string, videos: object[]): void {
  fs.writeFileSync(
    path.join(folder, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://example.com', outputFolder: folder, videos }, null, 2) + '\n',
    'utf-8',
  );
}

function readIndex(folder: string): { videos: Array<{ summaryPdf?: string | null; deepDivePdf?: string | null }> } {
  return JSON.parse(fs.readFileSync(path.join(folder, 'playlist-index.json'), 'utf-8'));
}

describe('migratePdfsInPlaylistFolder', () => {
  let dir: string;

  beforeEach(() => { dir = makeTempDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('moves summaryPdf from root to pdfs/ and updates index', () => {
    fs.writeFileSync(path.join(dir, 'my-video.pdf'), '%PDF');
    writeIndex(dir, [{ id: 'v1', summaryPdf: 'my-video.pdf', deepDivePdf: null }]);

    migratePdfsInPlaylistFolder(dir);

    expect(fs.existsSync(path.join(dir, 'pdfs', 'my-video.pdf'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'my-video.pdf'))).toBe(false);
    expect(readIndex(dir).videos[0].summaryPdf).toBe('pdfs/my-video.pdf');
  });

  it('moves deepDivePdf from root to pdfs/ and updates index', () => {
    fs.writeFileSync(path.join(dir, 'my-video-deep-dive.pdf'), '%PDF');
    writeIndex(dir, [{ id: 'v1', summaryPdf: null, deepDivePdf: 'my-video-deep-dive.pdf' }]);

    migratePdfsInPlaylistFolder(dir);

    expect(fs.existsSync(path.join(dir, 'pdfs', 'my-video-deep-dive.pdf'))).toBe(true);
    expect(readIndex(dir).videos[0].deepDivePdf).toBe('pdfs/my-video-deep-dive.pdf');
  });

  it('is idempotent — skips videos where summaryPdf already starts with pdfs/', () => {
    fs.mkdirSync(path.join(dir, 'pdfs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pdfs', 'my-video.pdf'), '%PDF');
    writeIndex(dir, [{ id: 'v1', summaryPdf: 'pdfs/my-video.pdf', deepDivePdf: null }]);

    migratePdfsInPlaylistFolder(dir);

    // File stays, index unchanged
    expect(fs.existsSync(path.join(dir, 'pdfs', 'my-video.pdf'))).toBe(true);
    expect(readIndex(dir).videos[0].summaryPdf).toBe('pdfs/my-video.pdf');
  });

  it('updates index field even when PDF file is absent on disk', () => {
    // PDF referenced in index but missing from disk (e.g. was deleted manually)
    writeIndex(dir, [{ id: 'v1', summaryPdf: 'ghost.pdf', deepDivePdf: null }]);

    migratePdfsInPlaylistFolder(dir);

    // Index still updated — the path must be correct for future syncs
    expect(readIndex(dir).videos[0].summaryPdf).toBe('pdfs/ghost.pdf');
  });

  it('does nothing when summaryPdf and deepDivePdf are both null', () => {
    writeIndex(dir, [{ id: 'v1', summaryPdf: null, deepDivePdf: null }]);
    const before = fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8');

    migratePdfsInPlaylistFolder(dir);

    const after = fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8');
    expect(after).toBe(before);
  });

  it('returns true when changes were made, false when nothing to do', () => {
    writeIndex(dir, [{ id: 'v1', summaryPdf: 'my-video.pdf', deepDivePdf: null }]);
    expect(migratePdfsInPlaylistFolder(dir)).toBe(true);

    // Second call — already migrated
    expect(migratePdfsInPlaylistFolder(dir)).toBe(false);
  });
});
