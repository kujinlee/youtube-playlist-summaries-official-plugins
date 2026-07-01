import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildDocHtml } from '@/lib/html-doc/build-doc-html';
import { GENERATOR_VERSION } from '@/lib/html-doc/render';
import type { Video } from '@/types';

let dir: string;
const VIDEO_ID = 'vidbuild1';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

// assertOutputFolder (via reRenderSummaryHtml) requires paths under homedir on macOS.
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-builddoc-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('buildDocHtml — summary', () => {
  it('current summaryHtml → { ok:true, html }', async () => {
    fs.mkdirSync(path.join(dir, 'htmls'));
    fs.writeFileSync(path.join(dir, 'htmls', 'a.html'),
      `<!DOCTYPE html><head><meta name="generator" content="${GENERATOR_VERSION}"></head><title>ok</title>`);
    const r = await buildDocHtml(video({ summaryHtml: 'htmls/a.html' }), dir, 'summary');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain('<title>ok</title>');
  });

  it('no summaryHtml → { ok:false, missing-html }', async () => {
    const r = await buildDocHtml(video({ summaryHtml: null }), dir, 'summary');
    expect(r).toEqual({ ok: false, reason: 'missing-html' });
  });

  it('summaryHtml not under htmls/ (secret.html) → not served', async () => {
    fs.writeFileSync(path.join(dir, 'secret.html'), '<title>secret</title>');
    const r = await buildDocHtml(video({ summaryHtml: 'secret.html' }), dir, 'summary');
    expect(r.ok).toBe(false);
  });

  it('summaryHtml traversal (htmls/../secret.html) → not served', async () => {
    const r = await buildDocHtml(video({ summaryHtml: 'htmls/../secret.html' }), dir, 'summary');
    expect(r.ok).toBe(false);
  });

  it('summaryHtml file missing on disk → { ok:false, missing-html }', async () => {
    const r = await buildDocHtml(video({ summaryHtml: 'htmls/a.html' }), dir, 'summary');
    expect(r).toEqual({ ok: false, reason: 'missing-html' });
  });
});

describe('buildDocHtml — dig-deeper', () => {
  it('crafted digDeeperMd traversal → { ok:false, invalid-path }', async () => {
    const r = await buildDocHtml(video({ digDeeperMd: '../../../etc/x-dig-deeper.md' }), dir, 'dig-deeper');
    expect(r).toEqual({ ok: false, reason: 'invalid-path' });
  });

  it('missing summary md → { ok:true } skeleton', async () => {
    const r = await buildDocHtml(video({ digDeeperMd: 'x-dig-deeper.md' }), dir, 'dig-deeper');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain('Summary unavailable');
  });

  it('valid summary md, nothing dug → { ok:true } rendered doc', async () => {
    fs.writeFileSync(path.join(dir, 'x.md'), '# Title\n\n## Intro\n\nBody.\n');
    const r = await buildDocHtml(video({ summaryMd: 'x.md', digDeeperMd: 'x-dig-deeper.md' }), dir, 'dig-deeper');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.html).toContain('<!DOCTYPE html');
  });
});
