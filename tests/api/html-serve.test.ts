import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';
import { GENERATOR_VERSION } from '../../lib/html-doc/render';

// Mock reRenderSummaryHtml so tests control return values without hitting disk/Gemini.
jest.mock('../../lib/html-doc/rerender', () => ({
  ...jest.requireActual('../../lib/html-doc/rerender'),
  reRenderSummaryHtml: jest.fn(),
}));

import { reRenderSummaryHtml } from '../../lib/html-doc/rerender';
const mockReRender = reRenderSummaryHtml as jest.MockedFunction<typeof reRenderSummaryHtml>;

let dir: string;
const VIDEO_ID = 'vid12345';

function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md',
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
function writeIndex(v: unknown) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function url(extra = '') {
  return new Request(`http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=summary${extra}`);
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };

// Must be under homedir — assertOutputFolder (not mocked) enforces this on macOS
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-htmlserve-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('400s without outputFolder', async () => {
  const res = await GET(new Request(`http://localhost/api/html/${VIDEO_ID}`), ctx);
  expect(res.status).toBe(400);
});

it('400s when type is missing or unsupported', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const base = `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}`;
  expect((await GET(new Request(base), ctx)).status).toBe(400);                 // missing type
  expect((await GET(new Request(`${base}&type=bogus`), ctx)).status).toBe(400); // unsupported type
});

it('404s on a path-traversal summaryHtml value (Codex BLOCKING)', async () => {
  writeIndex(video({ summaryHtml: '../../../../etc/passwd' }));
  const res = await GET(url(), ctx);
  expect([400, 404]).toContain(res.status); // never 200
  expect(res.status).not.toBe(200);
});

it('404s when summaryHtml is unset', async () => {
  writeIndex(video({ summaryHtml: null }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});

it('404s when the file is missing on disk', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(404);
});

it('serves the cached HTML with text/html', async () => {
  fs.mkdirSync(path.join(dir, 'htmls'));
  // Include current generator version so the version check serves cached without calling rerender.
  fs.writeFileSync(path.join(dir, 'htmls', 'a.html'),
    `<!DOCTYPE html><head><meta name="generator" content="${GENERATOR_VERSION}"></head><title>ok</title>`);
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const res = await GET(url(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  expect(await res.text()).toContain('<title>ok</title>');
});

it('serves a summary HTML whose filename has a Korean slug (B-1)', async () => {
  const koFile = 'htmls/모든-곳에-구글이-있었다.html';
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  // Include current generator version so the version check serves cached without calling rerender.
  fs.writeFileSync(path.join(dir, koFile),
    `<!DOCTYPE html><head><meta name="generator" content="${GENERATOR_VERSION}"></head><title>ko</title>`);
  writeIndex(video({ summaryHtml: koFile }));
  const res = await GET(new Request(
    `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=summary`), ctx);
  expect(res.status).toBe(200); // was 404 before the Unicode-regex fix
});

// --- type=dig-deeper (renderDigDeeperDoc behaviors) ---

function digDeeperUrl() {
  return new Request(
    `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=dig-deeper`
  );
}

// A minimal summary .md that parses without errors (parseSummaryMarkdown requires >= 1 ## section)
const SUMMARY_MD = [
  '---',
  'lang: "EN"',
  `video_id: "${VIDEO_ID}"`,
  '---',
  '# Test Video Title',
  '',
  '**Channel:** Test Channel | **Duration:** 10:00',
  `**URL:** https://www.youtube.com/watch?v=${VIDEO_ID}`,
  '',
  '## 1. Introduction',
  '',
  'Section one prose.',
  '',
  '## 2. Conclusion',
  '',
  'Section two prose.',
].join('\n');

// Helper: write summary .md (in wiki/) and return the relative path.
function writeSummaryMd(name = 'video.md'): string {
  fs.mkdirSync(path.join(dir, 'wiki'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'wiki', name), SUMMARY_MD);
  return `wiki/${name}`;
}

// Helper: write a valid companion doc
function writeCompanionDoc(name: string, sectionId: number, startSec: number): void {
  fs.mkdirSync(path.join(dir, 'wiki'), { recursive: true });
  const content = [
    '---',
    'title: "Test Video Title"',
    `videoId: "${VIDEO_ID}"`,
    'language: "en"',
    'sourceVideoUrl: "https://www.youtube.com/watch?v=vid12345"',
    'digVersion: { major: 1, minor: 0 }',
    'sections:',
    `  - sectionId: ${sectionId}`,
    `    startSec: ${startSec}`,
    '    title: "Introduction"',
    '    generatedAt: "2026-06-24T00:00:00.000Z"',
    '---',
    `<!-- dig-section: ${sectionId} -->`,
    '## Introduction',
    '',
    'Dug content for this section.',
    '<!-- /dig-section -->',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'wiki', name), content);
}

it('dig-deeper B1: dug+un-dug merged → all summary sections in output, 200', async () => {
  const summaryRel = writeSummaryMd('video.md');
  writeCompanionDoc('video-dig-deeper.md', 0, 0); // sectionId=0, won't match any section startSec
  writeIndex(video({ summaryMd: summaryRel, digDeeperMd: 'wiki/video-dig-deeper.md' }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  const body = await res.text();
  expect(body).toContain('Introduction');
  expect(body).toContain('Conclusion');
  expect(body).toContain('<!DOCTYPE html');
});

it('dig-deeper B2: digDeeperMd null → skeleton 200 (all summary sections rendered)', async () => {
  const summaryRel = writeSummaryMd('video.md');
  writeIndex(video({ summaryMd: summaryRel, digDeeperMd: null }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  const body = await res.text();
  expect(body).toContain('Introduction');
  expect(body).toContain('Conclusion');
});

it('dig-deeper B3: summary .md missing on disk → "Summary unavailable" 200', async () => {
  // summaryMd points to a file that does not exist on disk
  writeIndex(video({ summaryMd: 'wiki/nonexistent.md', digDeeperMd: null }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('Summary unavailable');
});

it('dig-deeper B4: model missing → skeleton (no gist) but 200', async () => {
  const summaryRel = writeSummaryMd('video.md');
  // No model written → readModelEnvelope returns null → all gists null
  writeIndex(video({ summaryMd: summaryRel, digDeeperMd: null }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(200);
  const body = await res.text();
  // Should have section headings without gist blocks
  expect(body).toContain('Introduction');
  // No .gist div since model is absent
  expect(body).not.toContain('class="gist"');
});

it('dig-deeper B5: path-traversal digDeeperMd → 400', async () => {
  // The base derived from a crafted digDeeperMd with ".." would escape outputFolder
  // Use a value that, when resolved, escapes the output folder
  writeIndex(video({
    summaryMd: 'wiki/video.md',
    digDeeperMd: '../../../etc/video-dig-deeper.md',
  }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(400);
});

it('dig-deeper B6: orphan companion section → orphan region rendered, 200', async () => {
  const summaryRel = writeSummaryMd('video.md');
  // sectionId=999 matches no summary section by startSec and title mismatch → orphan
  fs.mkdirSync(path.join(dir, 'wiki'), { recursive: true });
  const orphanContent = [
    '---',
    'title: "Test Video Title"',
    `videoId: "${VIDEO_ID}"`,
    'language: "en"',
    'sourceVideoUrl: "https://www.youtube.com/watch?v=vid12345"',
    'digVersion: { major: 1, minor: 0 }',
    'sections:',
    '  - sectionId: 999',
    '    startSec: 999',
    '    title: "Orphan Section"',
    '    generatedAt: "2026-06-24T00:00:00.000Z"',
    '---',
    '<!-- dig-section: 999 -->',
    '## Orphan Section',
    '',
    'Orphaned body content.',
    '<!-- /dig-section -->',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'wiki', 'video-dig-deeper.md'), orphanContent);
  writeIndex(video({ summaryMd: summaryRel, digDeeperMd: 'wiki/video-dig-deeper.md' }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('dg-orphans');
  expect(body).toContain('Orphan Section');
});

it('dig-deeper B7: digDeeperMd set but file absent on disk → skeleton 200 (not 500)', async () => {
  // Index says companion exists, but the file has been deleted from disk.
  // Route must NOT throw ENOENT → must return a valid skeleton HTML with all summary sections.
  const summaryRel = writeSummaryMd('video.md');
  writeIndex(video({
    summaryMd: summaryRel,
    digDeeperMd: 'wiki/video-dig-deeper.md', // set in index, but NOT written to disk
  }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('Introduction');
  expect(body).toContain('Conclusion');
  expect(body).toContain('<!DOCTYPE html');
});

it('dig-deeper B8: companion-path ALONE escapes outputFolder → 400 (companion assertWithin fires first)', async () => {
  // The route now checks digDeeperPath containment BEFORE deriving summaryMdPath,
  // so this test exercises the companion-path assertWithin independently.
  // summaryMd is safe; digDeeperMd escapes → companion assertWithin fires → 400.
  const summaryRel = writeSummaryMd('video.md');
  writeIndex(video({
    summaryMd: summaryRel,                         // safe: wiki/video.md → stays inside dir
    digDeeperMd: '../../../etc/companion.md',      // escapes outputFolder immediately
  }));
  const res = await GET(digDeeperUrl(), ctx);
  expect(res.status).toBe(400);
});

it('unknown type still 400 (B-2)', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const base = `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}`;
  const res = await GET(new Request(`${base}&type=banana`), ctx);
  expect(res.status).toBe(400);
});

// --- version-gated summary re-render (Task 5 behaviors) ---

function makeHtmlWithGenerator(generatorContent: string) {
  return `<!DOCTYPE html><html><head><meta name="generator" content="${generatorContent}"></head><body></body></html>`;
}

describe('version-gated summary re-render', () => {
  beforeEach(() => {
    mockReRender.mockReset();
    fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  });

  it('B1: current generator version → serves cached, does NOT call reRenderSummaryHtml', async () => {
    const cached = makeHtmlWithGenerator(GENERATOR_VERSION);
    fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), cached);
    writeIndex(video({ summaryHtml: 'htmls/a.html', summaryMd: 'wiki/a.md' }));

    const res = await GET(url(), ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('meta name="generator"');
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('B2: stale + rerendered → serves result.html from reRenderSummaryHtml', async () => {
    const staleCached = makeHtmlWithGenerator('magazine-skim v1');
    fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), staleCached);
    writeIndex(video({ summaryHtml: 'htmls/a.html', summaryMd: 'wiki/a.md' }));

    const freshHtml = `<!DOCTYPE html><html><head><meta name="generator" content="${GENERATOR_VERSION}"></head><body>fresh</body></html>`;
    mockReRender.mockReturnValue({ status: 'rerendered', htmlPath: 'htmls/a.html', html: freshHtml });

    const res = await GET(url(), ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('fresh');
    expect(mockReRender).toHaveBeenCalledWith(VIDEO_ID, dir);
  });

  it('B3: stale + skipped-drift → serves stale cached, 200, console.warn called', async () => {
    const staleCached = makeHtmlWithGenerator('magazine-skim v1');
    fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), staleCached);
    writeIndex(video({ summaryHtml: 'htmls/a.html', summaryMd: 'wiki/a.md' }));

    mockReRender.mockReturnValue({ status: 'skipped-drift', mdSections: ['A'], modelSections: ['B'] });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await GET(url(), ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('magazine-skim v1');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('B4: stale + skipped-no-model → serves stale cached, 200', async () => {
    const staleCached = makeHtmlWithGenerator('magazine-skim v1');
    fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), staleCached);
    writeIndex(video({ summaryHtml: 'htmls/a.html', summaryMd: 'wiki/a.md' }));

    mockReRender.mockReturnValue({ status: 'skipped-no-model' });

    const res = await GET(url(), ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('magazine-skim v1');
  });

  it('B5: missing file → 404 regardless of version logic', async () => {
    writeIndex(video({ summaryHtml: 'htmls/missing.html', summaryMd: 'wiki/a.md' }));
    // no file on disk
    const res = await GET(url(), ctx);
    expect(res.status).toBe(404);
    // rerender should not be called since file read throws
    expect(mockReRender).not.toHaveBeenCalled();
  });

  it('B6: null summaryHtml → 404', async () => {
    writeIndex(video({ summaryHtml: null }));
    const res = await GET(url(), ctx);
    expect(res.status).toBe(404);
    expect(mockReRender).not.toHaveBeenCalled();
  });
});
