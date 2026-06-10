# Deep-Dive HTML Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "View Deep Dive HTML" menu action that lazily renders a video's deep-dive `.md` faithfully to a self-contained, styled HTML page (ASCII diagrams preserved in monospace), cached on first view.

**Architecture:** A pure `markdown-it` (`html:false`) renderer converts the deep-dive markdown to a self-contained HTML document. The serve route `GET /api/html/[id]?type=deep-dive` serves the cached file or generates it on first view (atomic write, no index field, no Gemini, no SSE). Staleness handled by deleting the cache on deep-dive regeneration and on archive.

**Tech Stack:** Next.js (App Router), TypeScript, `markdown-it` (new dep), Jest + ts-jest, @testing-library/react, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-09-deep-dive-html-export-design.md` (revised per adversarial review).

**Key conventions (mirror these):**
- The shipped summary HTML feature: `lib/html-doc/{render,generate}.ts`, serve route `app/api/html/[id]/route.ts`.
- Atomic write = temp file (`crypto.randomUUID()` suffix) → `fs.renameSync` (see `lib/html-doc/generate.ts`).
- Tests that touch the index/fs seed a temp dir **under `$HOME`** (e.g. `fs.mkdtempSync(path.join(os.homedir(), '.tmp-…'))`) because `assertOutputFolder` rejects paths outside home on macOS.
- `base = deepDiveMd.replace(/\.md$/, '')` already ends in `-deep-dive`; the cache file is `htmls/<base>.html` (NOT a doubled suffix).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/html-doc/render-deep-dive.ts` (create) | Pure `renderDeepDiveHtml(md, sourceMd) → string`. markdown-it (`html:false`) → self-contained HTML + CSS. |
| `lib/html-doc/generate-deep-dive.ts` (create) | `runDeepDiveHtml(videoId, outputFolder) → Promise<string>`. Read deep-dive md → render → atomic-write `htmls/<base>.html` → return HTML string. No index write. |
| `app/api/html/[id]/route.ts` (modify) | Widen `type` to `summary\|deep-dive`; Unicode path regex (B-1); deep-dive lazy-generate-on-view serving in-memory bytes (H-2). |
| `lib/deep-dive.ts` (modify) | On (re)generation, delete stale `htmls/<base>.html`. |
| `lib/archive.ts` (modify) | On archive/unarchive, delete the video's cached `htmls/*.html` and clear `summaryHtml` (H-3). |
| `components/VideoMenu.tsx` (modify) | Add "View Deep Dive HTML" link (enabled when `deepDiveMd` set). |
| `package.json` (modify) | Add `markdown-it` + `@types/markdown-it`. |

---

## Task 1: Add the `markdown-it` dependency

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

Run:
```bash
npm install markdown-it@14 && npm install -D @types/markdown-it
```
Expected: both added to `package.json`; lockfile updated.

- [ ] **Step 2: Verify it imports and types resolve**

Run:
```bash
node -e "const M=require('markdown-it'); console.log(typeof new M().render)"
```
Expected: prints `function`.

Run: `npx tsc --noEmit`
Expected: clean (no missing-types error for `markdown-it`).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add markdown-it + @types/markdown-it for deep-dive HTML"
```

---

## Task 2: `render-deep-dive.ts` — pure faithful renderer

**Files:**
- Create: `lib/html-doc/render-deep-dive.ts`
- Test: `tests/lib/html-doc/render-deep-dive.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/html-doc/render-deep-dive.test.ts`:

```ts
import { renderDeepDiveHtml } from '../../../lib/html-doc/render-deep-dive';

const MD = `---
tags:
  - deep-dive
video_id: "rjoMZyxncUI"
lang: EN
score: 4.4
---

# The ABCs of agent building (Deep Dive)

**Channel:** Google Cloud Tech | **Duration:** 13:54 | **URL:** https://youtu.be/rjoMZyxncUI

---

Of course. Here is a comprehensive deep-dive analysis.

### **1. High-Level Summary**
The video explains agent protocols.

\`\`\`ascii
+--------+      +--------+
| Agent  | ---> | Tool   |
+--------+      +--------+
\`\`\`

#### Sub-point
- bullet one
- bullet two

A link: [click](javascript:alert(1)) and <script>alert(2)</script> inline.
`;

describe('renderDeepDiveHtml', () => {
  const html = renderDeepDiveHtml(MD, 'the-abcs-deep-dive.md');

  it('is a self-contained document with inlined CSS and provenance', () => {
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<style>');
    expect(html).not.toContain('<link');
    expect(html).toContain('<meta name="generator" content="deep-dive-html v1">');
    expect(html).toContain('<meta name="source-md" content="the-abcs-deep-dive.md">');
    expect(html).toContain('<meta name="video-id" content="rjoMZyxncUI">');
    expect(html).toContain('<html lang="en">');
  });

  it('strips YAML frontmatter from the body', () => {
    expect(html).not.toContain('video_id:');
    expect(html).not.toContain('tags:');
  });

  it('renders headings (h1–h4) including bold-in-heading', () => {
    expect(html).toContain('<h1>The ABCs of agent building (Deep Dive)</h1>');
    expect(html).toMatch(/<h3><strong>1\. High-Level Summary<\/strong><\/h3>/);
    expect(html).toContain('<h4>Sub-point</h4>');
  });

  it('preserves an ASCII diagram in a <pre><code> block', () => {
    expect(html).toMatch(/<pre><code[^>]*>[\s\S]*Agent[\s\S]*Tool[\s\S]*<\/code><\/pre>/);
  });

  it('keeps the conversational preamble (faithful render)', () => {
    expect(html).toContain('Of course. Here is a comprehensive deep-dive analysis.');
  });

  it('escapes raw HTML (html:false) — no injection', () => {
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a javascript: link href (markdown-it validateLink)', () => {
    expect(html).not.toContain('href="javascript:');
  });

  it('renders Korean content', () => {
    const ko = renderDeepDiveHtml(
      `---\nvideo_id: "k1"\nlang: KO\n---\n\n# 한국어 (Deep Dive)\n\n### **1. 개요**\n본문입니다.\n`,
      'ko-deep-dive.md',
    );
    expect(ko).toContain('<html lang="ko">');
    expect(ko).toContain('본문입니다.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/html-doc/render-deep-dive.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `render-deep-dive.ts`**

Create `lib/html-doc/render-deep-dive.ts`:

```ts
import MarkdownIt from 'markdown-it';

// html:false → raw HTML in the (Gemini-generated) markdown is escaped, not passed through.
// markdown-it's default validateLink already blocks javascript:/vbscript:/data: (non-image) hrefs.
const md = new MarkdownIt({ html: false });

function frontmatterField(src: string, key: string): string | null {
  const m = src.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'));
  return m?.[1]?.trim() ?? null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#f3f4f6;color:#1e1e22;line-height:1.65;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",'Apple SD Gothic Neo','Malgun Gothic',Helvetica,Arial,sans-serif}
.dd{max-width:52rem;margin:0 auto;background:#fff;padding:2.6rem 3rem 4rem;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.dd h1{font-size:1.9rem;line-height:1.25;margin:.2em 0 .5em;color:#111}
.dd h2{font-size:1.4rem;margin:1.8em 0 .4em;color:#5b46d6}
.dd h3{font-size:1.18rem;margin:1.5em 0 .3em;color:#2a2540}
.dd h4{font-size:1.02rem;margin:1.2em 0 .3em;color:#3a3550}
.dd p{margin:.7em 0}
.dd a{color:#5b46d6}
.dd ul,.dd ol{padding-left:1.4em}
.dd li{margin:.3em 0}
.dd hr{border:0;border-top:1px solid #e6e6ea;margin:1.6em 0}
.dd strong{color:#111}
.dd code{font-family:'SF Mono',Menlo,Monaco,Consolas,monospace;font-size:.88em;background:#f5f4fb;padding:.1em .35em;border-radius:4px}
.dd pre{background:#f5f4fb;border:1px solid #e6e6ea;border-radius:8px;padding:1em;overflow:auto;line-height:1.4}
.dd pre code{background:none;padding:0;font-size:.85em;white-space:pre}
.dd blockquote{border-left:3px solid #5b46d6;margin:1em 0;padding:.2em 1em;color:#6b7280}
@media print{body{background:#fff}.dd{box-shadow:none}}
`;

/** Faithfully render a deep-dive markdown document into a self-contained HTML page. */
export function renderDeepDiveHtml(mdContent: string, sourceMd: string): string {
  const lang = (frontmatterField(mdContent, 'lang') ?? 'EN').toLowerCase();
  const videoId = frontmatterField(mdContent, 'video_id') ?? '';
  // Strip the leading YAML frontmatter block, then render the body faithfully.
  const body = mdContent.replace(/^---\n[\s\S]*?\n---\n/, '');
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Deep Dive';
  const bodyHtml = md.render(body);

  return `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="deep-dive-html v1">
<meta name="source-md" content="${esc(sourceMd)}">
<meta name="video-id" content="${esc(videoId)}">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<article class="dd">
${bodyHtml}</article>
</body>
</html>`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/html-doc/render-deep-dive.test.ts`
Expected: PASS (8 tests). If the heading test fails, inspect markdown-it's exact output for `### **1. X**` and adjust the test's expected markup to match the real renderer output (do not weaken the escaping/injection assertions).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/render-deep-dive.ts tests/lib/html-doc/render-deep-dive.test.ts
git commit -m "feat(deep-dive-html): faithful markdown-it renderer (html:false)"
```

---

## Task 3: `generate-deep-dive.ts` — lazy orchestrator (no index write)

**Files:**
- Create: `lib/html-doc/generate-deep-dive.ts`
- Test: `tests/lib/html-doc/generate-deep-dive.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/html-doc/generate-deep-dive.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDeepDiveHtml } from '../../../lib/html-doc/generate-deep-dive';

let dir: string;
const VIDEO_ID = 'vidDD1234';

const DD_MD = `---
video_id: "vidDD1234"
lang: EN
score: 4
---

# A Title (Deep Dive)

**Channel:** Chan | **Duration:** 1:00 | **URL:** https://youtu.be/x

---

### **1. Overview**
Body text.
`;

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2));
}
function baseVideo() {
  return {
    id: VIDEO_ID, title: 'A Title', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a-title.md', summaryPdf: null,
    deepDiveMd: 'a-title-deep-dive.md', deepDivePdf: null, summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z',
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddhtml-'));
  fs.writeFileSync(path.join(dir, 'a-title-deep-dive.md'), DD_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('renders, atomic-writes htmls/<base>.html, and returns the HTML string', async () => {
  const html = await runDeepDiveHtml(VIDEO_ID, dir);
  expect(html).toContain('A Title (Deep Dive)');
  expect(html).toContain('Body text.');

  const out = path.join(dir, 'htmls', 'a-title-deep-dive.html'); // no doubled -deep-dive
  expect(fs.existsSync(out)).toBe(true);
  expect(fs.readFileSync(out, 'utf-8')).toBe(html);
});

it('does NOT write the index (no deepDiveHtml field, summaryHtml untouched)', async () => {
  await runDeepDiveHtml(VIDEO_ID, dir);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBeNull();
  expect('deepDiveHtml' in idx.videos[0]).toBe(false);
});

it('throws when the video has no deepDiveMd', async () => {
  writeIndex([{ ...baseVideo(), deepDiveMd: null }]);
  await expect(runDeepDiveHtml(VIDEO_ID, dir)).rejects.toThrow(/deep dive|deepDiveMd/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/html-doc/generate-deep-dive.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `generate-deep-dive.ts`**

Create `lib/html-doc/generate-deep-dive.ts`:

```ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { assertOutputFolder, assertVideoId, readIndex } from '../index-store';
import { renderDeepDiveHtml } from './render-deep-dive';

/**
 * Render a video's deep-dive markdown to a self-contained HTML page, atomic-write it to
 * htmls/<base>.html (base = deepDiveMd minus .md), and return the rendered HTML string.
 * Does NOT touch the index — the serve route keys on the cache file's existence.
 */
export async function runDeepDiveHtml(videoId: string, outputFolder: string): Promise<string> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) throw new Error(`Video not found in index: ${videoId}`);
  if (!video.deepDiveMd) throw new Error('deep dive not available: video has no deepDiveMd');

  const mdPath = path.join(outputFolder, video.deepDiveMd);
  const mdContent = fs.readFileSync(mdPath, 'utf-8');
  const html = renderDeepDiveHtml(mdContent, video.deepDiveMd);

  const base = video.deepDiveMd.replace(/\.md$/, '');
  const htmlDir = path.join(outputFolder, 'htmls');
  fs.mkdirSync(htmlDir, { recursive: true });
  const finalPath = path.join(htmlDir, `${base}.html`);
  const tmpPath = `${finalPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, html, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
  return html;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/html-doc/generate-deep-dive.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/html-doc/generate-deep-dive.ts tests/lib/html-doc/generate-deep-dive.test.ts
git commit -m "feat(deep-dive-html): lazy orchestrator (render + atomic write, no index)"
```

---

## Task 4: Serve route — `type=deep-dive` branch + Unicode path regex (B-1)

**Files:**
- Modify: `app/api/html/[id]/route.ts`
- Test: `tests/api/html-serve.test.ts` (update existing) + new deep-dive cases

- [ ] **Step 1: Update + extend the serve tests**

In `tests/api/html-serve.test.ts`:

(a) The existing test "400s when type is missing or not summary" currently uses `&type=deep-dive` to
assert 400 — but deep-dive is now a VALID type. Change that test to use an unsupported value:

```ts
it('400s when type is missing or unsupported', async () => {
  writeIndex(video({ summaryHtml: 'htmls/a.html' }));
  const base = `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}`;
  expect((await GET(new Request(base), ctx)).status).toBe(400);                 // missing type
  expect((await GET(new Request(`${base}&type=bogus`), ctx)).status).toBe(400); // unsupported type
});
```

(b) Add a Korean-slug regression test for the SUMMARY path (B-1):

```ts
it('serves a summary HTML whose filename has a Korean slug (B-1)', async () => {
  const koFile = 'htmls/모든-곳에-구글이-있었다.html';
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, koFile), '<!DOCTYPE html><title>ko</title>');
  writeIndex(video({ summaryHtml: koFile }));
  const res = await GET(new Request(
    `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=summary`), ctx);
  expect(res.status).toBe(200); // was 404 before the Unicode-regex fix
});
```

(c) Create `tests/api/html-serve-deep-dive.test.ts` for the deep-dive branch:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';

let dir: string;
const VIDEO_ID = 'vidDD1234';
const DD_MD = `---\nvideo_id: "vidDD1234"\nlang: EN\n---\n\n# T (Deep Dive)\n\n---\n\n### **1. Overview**\nBody.\n`;

function writeIndex(v: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null,
    deepDiveMd: 'a-deep-dive.md', deepDivePdf: null, summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };
const ddReq = () => new Request(
  `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=deep-dive`);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddserve-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('lazily generates and serves the deep-dive HTML when not cached', async () => {
  fs.writeFileSync(path.join(dir, 'a-deep-dive.md'), DD_MD);
  writeIndex(video());
  const res = await GET(ddReq(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
  expect(await res.text()).toContain('T (Deep Dive)');
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-deep-dive.html'))).toBe(true); // cached
});

it('serves the cached deep-dive HTML when present', async () => {
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'htmls', 'a-deep-dive.html'), '<!DOCTYPE html><title>cached</title>');
  fs.writeFileSync(path.join(dir, 'a-deep-dive.md'), DD_MD);
  writeIndex(video());
  expect(await (await GET(ddReq(), ctx)).text()).toContain('cached');
});

it('404s when the video has no deepDiveMd', async () => {
  writeIndex(video({ deepDiveMd: null }));
  expect((await GET(ddReq(), ctx)).status).toBe(404);
});

it('serves a deep-dive HTML whose filename has a Korean slug (B-1)', async () => {
  writeIndex(video({ deepDiveMd: '모든-곳에-구글-deep-dive.md' }));
  fs.writeFileSync(path.join(dir, '모든-곳에-구글-deep-dive.md'), DD_MD);
  const res = await GET(ddReq(), ctx);
  expect(res.status).toBe(200); // unicode regex admits the KO filename
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/api/html-serve-deep-dive.test.ts tests/api/html-serve.test.ts`
Expected: deep-dive suite FAILs (route lacks the branch); the summary KO test FAILs (ASCII regex).

- [ ] **Step 3: Rewrite the serve route**

Replace the body of `app/api/html/[id]/route.ts` with:

```ts
import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex } from '../../../../lib/index-store';
import { runDeepDiveHtml } from '../../../../lib/html-doc/generate-deep-dive';

type Params = { params: Promise<{ id: string }> };

// B-1: Unicode-aware so Korean-slug filenames are admitted. The resolved-path containment check
// below is the real traversal backstop; this regex still forbids slashes (no "../").
const HTML_REL_RE = /^htmls\/[\p{L}\p{N}._-]+\.html$/u;

export async function GET(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const { searchParams } = new URL(request.url);
  const outputFolder = searchParams.get('outputFolder');

  if (!outputFolder) {
    return new Response(JSON.stringify({ error: 'outputFolder is required' }), { status: 400 });
  }
  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid request' }), { status: 400 });
  }

  const type = searchParams.get('type');
  if (type !== 'summary' && type !== 'deep-dive') {
    return new Response(JSON.stringify({ error: 'unsupported or missing type' }), { status: 400 });
  }

  let video;
  try {
    const index = readIndex(outputFolder);
    video = index.videos.find((v) => v.id === videoId);
    if (!video) return new Response(JSON.stringify({ error: 'video not found' }), { status: 404 });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) return new Response(JSON.stringify({ error: e.message }), { status: 400 });
    throw err;
  }

  const htmlDir = path.resolve(outputFolder, 'htmls');
  // Returns an error Response if the relative path is unsafe, else null.
  const guard = (rel: string): Response | null => {
    if (!HTML_REL_RE.test(rel)) {
      return new Response(JSON.stringify({ error: 'html not available' }), { status: 404 });
    }
    const abs = path.resolve(outputFolder, rel);
    if (abs !== htmlDir && !abs.startsWith(htmlDir + path.sep)) {
      return new Response(JSON.stringify({ error: 'invalid path' }), { status: 400 });
    }
    return null;
  };
  const serveHtml = (body: Buffer | string) =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  if (type === 'summary') {
    const htmlFile = video.summaryHtml;
    if (!htmlFile) return new Response(JSON.stringify({ error: 'html not available' }), { status: 404 });
    const bad = guard(htmlFile);
    if (bad) return bad;
    try {
      return serveHtml(fs.readFileSync(path.resolve(outputFolder, htmlFile)));
    } catch {
      return new Response(JSON.stringify({ error: 'file not found' }), { status: 404 });
    }
  }

  // type === 'deep-dive' — lazy generate-on-view, no index field.
  if (!video.deepDiveMd) {
    return new Response(JSON.stringify({ error: 'deep dive not available' }), { status: 404 });
  }
  const base = video.deepDiveMd.replace(/\.md$/, '');
  const rel = `htmls/${base}.html`;
  const bad = guard(rel);
  if (bad) return bad;

  try {
    return serveHtml(fs.readFileSync(path.resolve(outputFolder, rel))); // cached
  } catch {
    // Not cached → render now, serve the in-memory bytes (H-2: no write-then-re-read).
    try {
      const html = await runDeepDiveHtml(videoId, outputFolder);
      return serveHtml(html);
    } catch {
      return new Response(JSON.stringify({ error: 'failed to render deep dive html' }), { status: 500 });
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/api/html-serve.test.ts tests/api/html-serve-deep-dive.test.ts tests/api/html-doc-pipeline.test.ts`
Expected: all PASS (summary path incl. KO, deep-dive lazy/cached/404/KO, and the existing summary integration test).

- [ ] **Step 5: Commit**

```bash
git add app/api/html/[id]/route.ts tests/api/html-serve.test.ts tests/api/html-serve-deep-dive.test.ts
git commit -m "feat(deep-dive-html): serve route deep-dive branch + Unicode path regex (fixes KO 404)"
```

---

## Task 5: `lib/deep-dive.ts` — delete stale HTML on regeneration

**Files:**
- Modify: `lib/deep-dive.ts`
- Test: `tests/lib/deep-dive-html-stale.test.ts` (NEW, separate file)

- [ ] **Step 1: Write the failing test**

> **Do NOT add this to the existing `tests/lib/deep-dive.test.ts`** — that suite mocks `lib/index-store`,
> so a real-filesystem assertion grafted into it would false-green. Create a **separate** real-fs test
> file `tests/lib/deep-dive-html-stale.test.ts` (it mocks only `./gemini`, `./pdf`, `./youtube`, and
> uses a real temp dir + real `index-store`):

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runDeepDive } from '../../lib/deep-dive';

jest.mock('../../lib/gemini', () => ({
  generateDeepDive: jest.fn().mockResolvedValue('# x\n\n### **1. New**\nnew body.'),
  generateDeepDiveFromTranscript: jest.fn(),
}));
jest.mock('../../lib/pdf', () => ({ generatePdf: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../lib/youtube', () => ({ fetchTranscript: jest.fn() }));

let dir: string;
const VIDEO_ID = 'vidDD1234';

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddstale-'));
  writeIndex([{
    id: VIDEO_ID, title: 'A', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z',
  }]);
  // a stale cached deep-dive HTML from a previous run
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'htmls', 'a-deep-dive.html'), '<!DOCTYPE html><title>stale</title>');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('removes the stale cached deep-dive HTML when the deep-dive is regenerated', async () => {
  await runDeepDive(VIDEO_ID, dir, () => {});
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-deep-dive.html'))).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/deep-dive-html-stale.test.ts`
Expected: FAIL (stale file still present).

- [ ] **Step 3: Implement — delete the stale HTML in `runDeepDive`**

In `lib/deep-dive.ts`, the function already computes `const base = (video.summaryMd ?? videoId).replace(/\.md$/, '');` and `const mdFilename = \`${base}-deep-dive.md\`;`. Immediately after the `mdFilename`/`pdfFilename` are derived (before or after writing the md is fine), add a best-effort delete of the stale cached HTML:

```ts
  // Invalidate any cached deep-dive HTML so the next view regenerates from the new markdown.
  try { fs.unlinkSync(path.join(outputFolder, 'htmls', `${base}-deep-dive.html`)); }
  catch { /* no cached html — fine */ }
```

(`fs` and `path` are already imported in this file.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/deep-dive-html-stale.test.ts`
Expected: PASS. Then run `npx jest tests/lib/deep-dive` (any existing deep-dive suite) → no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/deep-dive.ts tests/lib/deep-dive-html-stale.test.ts
git commit -m "fix(deep-dive-html): invalidate cached deep-dive HTML on regeneration"
```

---

## Task 6: `lib/archive.ts` — delete cached HTML + clear summaryHtml (H-3)

**Files:**
- Modify: `lib/archive.ts`
- Test: `tests/lib/archive.test.ts` (extend) or `tests/lib/archive-html.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/archive-html.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { archiveVideo } from '../../lib/archive';

let dir: string;
const VIDEO_ID = 'vidAR1234';

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-arhtml-'));
  fs.mkdirSync(path.join(dir, 'htmls'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.md'), '# a');
  fs.writeFileSync(path.join(dir, 'a-deep-dive.md'), '# a dd');
  fs.writeFileSync(path.join(dir, 'htmls', 'a.html'), 'summary html');
  fs.writeFileSync(path.join(dir, 'htmls', 'a-deep-dive.html'), 'deep dive html');
  writeIndex([{
    id: VIDEO_ID, title: 'A', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null,
    deepDiveMd: 'a-deep-dive.md', deepDivePdf: null,
    summaryHtml: 'htmls/a.html', processedAt: '2026-06-09T00:00:00.000Z',
  }]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('deletes cached summary + deep-dive HTML and clears summaryHtml on archive', async () => {
  await archiveVideo(dir, VIDEO_ID);
  expect(fs.existsSync(path.join(dir, 'htmls', 'a.html'))).toBe(false);
  expect(fs.existsSync(path.join(dir, 'htmls', 'a-deep-dive.html'))).toBe(false);
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'playlist-index.json'), 'utf-8'));
  expect(idx.videos[0].summaryHtml).toBeNull();
  expect(idx.videos[0].archived).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/lib/archive-html.test.ts`
Expected: FAIL (html files still present / summaryHtml not cleared).

- [ ] **Step 3: Implement the cache cleanup**

In `lib/archive.ts`:

(a) Add a helper that lists the cached HTML absolute paths for a video, near `getFilePairs`:

```ts
// Cached HTML files for a video: htmls/<summaryBase>.html and htmls/<deepDiveBase>.html.
// Returns only paths safely within outputFolder.
function getCachedHtmlPaths(outputFolder: string, videoId: string): string[] {
  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) return [];
  const base = path.resolve(outputFolder);
  const out: string[] = [];
  for (const md of [video.summaryMd, video.deepDiveMd]) {
    if (!md) continue;
    const rel = path.join('htmls', `${md.replace(/\.md$/, '')}.html`);
    const abs = path.resolve(base, rel);
    if (abs.startsWith(base + path.sep)) out.push(abs);
  }
  return out;
}

function unlinkIfExists(p: string): void {
  try { fs.unlinkSync(p); } catch { /* not present — fine */ }
}
```

(b) Change `updateIndexIfKnown`'s signature to accept arbitrary fields so it can clear `summaryHtml`:

```ts
function updateIndexIfKnown(outputFolder: string, videoId: string, fields: Partial<{ archived: boolean; summaryHtml: string | null }>): void {
  try {
    updateVideoFields(outputFolder, videoId, fields);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('Video not found in index')) return;
    throw err;
  }
}
```

(c) In `archiveVideo`, BEFORE moving files (so we read the index while paths are still root-relative),
delete the cached HTML; and clear `summaryHtml` in the index update:

```ts
export async function archiveVideo(outputFolder: string, videoId: string): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  for (const p of getCachedHtmlPaths(outputFolder, videoId)) unlinkIfExists(p);

  await ensureArchiveDir(outputFolder);
  for (const { root, archived } of getFilePairs(outputFolder, videoId)) {
    await moveIfExists(root, archived);
  }
  updateIndexIfKnown(outputFolder, videoId, { archived: true, summaryHtml: null });
}
```

(d) In `unarchiveVideo`, also delete any cached HTML (defensive) and clear `summaryHtml`:

```ts
export async function unarchiveVideo(outputFolder: string, videoId: string): Promise<void> {
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  for (const { root, archived } of getFilePairs(outputFolder, videoId)) {
    await moveIfExists(archived, root);
  }
  for (const p of getCachedHtmlPaths(outputFolder, videoId)) unlinkIfExists(p);
  updateIndexIfKnown(outputFolder, videoId, { archived: false, summaryHtml: null });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/lib/archive-html.test.ts tests/lib/archive` (the existing archive suite)
Expected: all PASS (no regression in existing archive tests).

- [ ] **Step 5: Commit**

```bash
git add lib/archive.ts tests/lib/archive-html.test.ts
git commit -m "fix(html-doc): clear cached HTML + summaryHtml on archive/unarchive (H-3)"
```

---

## Task 7: VideoMenu — "View Deep Dive HTML" link

**Files:**
- Modify: `components/VideoMenu.tsx`
- Test: `tests/components/VideoMenu.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Add to `tests/components/VideoMenu.test.tsx`:

```ts
it('shows an enabled "View Deep Dive HTML" link when deepDiveMd is set', () => {
  renderMenu(video({ deepDiveMd: 'a-deep-dive.md' }));
  const link = screen.getByRole('link', { name: /view deep dive html/i });
  const href = link.getAttribute('href')!;
  const u = new URL(href, 'http://localhost');
  expect(u.pathname).toBe('/api/html/v');
  expect(u.searchParams.get('outputFolder')).toBe('/home/u/p');
  expect(u.searchParams.get('type')).toBe('deep-dive');
});

it('disables "View Deep Dive HTML" when there is no deepDiveMd', () => {
  renderMenu(video({ deepDiveMd: null }));
  expect(screen.queryByRole('link', { name: /view deep dive html/i })).not.toBeInTheDocument();
  expect(screen.getByText(/view deep dive html/i)).toHaveAttribute('aria-disabled', 'true');
});
```

(If the shared `video()` helper in this file does not already default `deepDiveMd`, ensure it is
included so other tests are unaffected.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/components/VideoMenu.test.tsx`
Expected: FAIL (link not rendered).

- [ ] **Step 3: Implement the menu item**

In `components/VideoMenu.tsx`:

(a) After the `htmlViewHref` line (~47), add:

```ts
  const deepDiveHtmlHref = `/api/html/${encodeURIComponent(video.id)}?outputFolder=${encodeURIComponent(outputFolder)}&type=deep-dive`;
```

(b) Immediately after the "View Deep Dive PDF" `<li>` (the block ending around line 114), add:

```tsx
      <li role="none">
        {hasDeepDive ? (
          <a href={deepDiveHtmlHref} onClick={onClose} target="_blank" rel="noopener noreferrer" className={itemClass}>
            View Deep Dive HTML
          </a>
        ) : (
          <a
            href="#"
            aria-disabled="true"
            tabIndex={-1}
            onClick={(e) => e.preventDefault()}
            className={disabledClass}
          >
            View Deep Dive HTML
          </a>
        )}
      </li>
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/components/VideoMenu.test.tsx`
Expected: PASS. Then `npx jest tests/components` → no regressions.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add components/VideoMenu.tsx tests/components/VideoMenu.test.tsx
git commit -m "feat(deep-dive-html): VideoMenu 'View Deep Dive HTML' link"
```

---

## Task 8: Integration test — real deep-dive markdown → serve route (incl. KO)

**Files:**
- Create: `tests/api/deep-dive-html-pipeline.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/api/deep-dive-html-pipeline.test.ts`:

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';

let dir: string;
const VIDEO_ID = 'vidDDpipe1';

// A realistic deep-dive body: ### bold-numbered headings + an ```ascii diagram + KO-friendly text.
const DD_MD = `---
video_id: "vidDDpipe1"
lang: EN
score: 4.4
---

# The ABCs (Deep Dive)

**Channel:** Google Cloud Tech | **Duration:** 13:54 | **URL:** https://youtu.be/x

---

Of course. Here is a comprehensive analysis.

### **1. Architecture**
The protocol routes messages.

\`\`\`ascii
+--------+      +--------+
| Agent  | ---> | Tool   |
+--------+      +--------+
\`\`\`
`;

function writeIndex(v: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md', summaryPdf: null,
    deepDiveMd: 'abc-deep-dive.md', deepDivePdf: null, summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };
const req = () => new Request(
  `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=deep-dive`);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddpipe-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('renders a real deep-dive end-to-end: ASCII preserved in <pre>, frontmatter gone', async () => {
  fs.writeFileSync(path.join(dir, 'abc-deep-dive.md'), DD_MD);
  writeIndex(video());
  const res = await GET(req(), ctx);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/<pre><code[^>]*>[\s\S]*Agent[\s\S]*Tool[\s\S]*<\/code><\/pre>/); // ascii monospace
  expect(html).not.toContain('video_id:'); // frontmatter stripped
  expect(html).toContain('Of course. Here is a comprehensive analysis.'); // faithful
});

it('works for a Korean-slug deep-dive filename (B-1)', async () => {
  writeIndex(video({ deepDiveMd: '모든-곳에-구글-deep-dive.md' }));
  fs.writeFileSync(path.join(dir, '모든-곳에-구글-deep-dive.md'), DD_MD);
  expect((await GET(req(), ctx)).status).toBe(200);
});
```

- [ ] **Step 2: Run**

Run: `npx jest tests/api/deep-dive-html-pipeline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/api/deep-dive-html-pipeline.test.ts
git commit -m "test(deep-dive-html): integration — real md → serve route, ascii + KO"
```

---

## Task 9: E2E — "View Deep Dive HTML"

**Files:**
- Create: `tests/e2e/deep-dive-html.spec.ts`

> Mirror the conventions in `tests/e2e/html-doc.spec.ts` (route-boundary stubbing via `page.route`,
> temp-folder seeding). Read it first.

- [ ] **Step 1: Write the E2E spec**

Create `tests/e2e/deep-dive-html.spec.ts` with two scenarios (use the existing harness helpers):

```ts
import { test, expect } from '@playwright/test';

// Fixture set MUST include: a video with deepDiveMd set, and one without.

test('the deep-dive HTML link carries both params and serves HTML', async ({ page }) => {
  // seed a video with deepDiveMd set; stub GET /api/html/<id>?...type=deep-dive → returns HTML.
  await page.goto('/');
  // open the row menu, locate the "View Deep Dive HTML" link
  // const href = await link.getAttribute('href');
  // const u = new URL(href!, page.url());
  // expect(u.searchParams.get('outputFolder')).toBe(<seeded folder>);
  // expect(u.searchParams.get('type')).toBe('deep-dive');
});

test('the deep-dive HTML item is disabled when the video has no deep-dive', async ({ page }) => {
  // seed a video with deepDiveMd: null; open menu; assert the item is aria-disabled, not a link
});
```

- [ ] **Step 2: Run**

Run: `npx playwright test tests/e2e/deep-dive-html.spec.ts`
Expected: PASS (2 scenarios). Assert BOTH link params.

- [ ] **Step 3: Full suite + commit**

Run: `npm test` (jest), then `npx tsc --noEmit && npm run build`.
Expected: all green.

```bash
git add tests/e2e/deep-dive-html.spec.ts
git commit -m "test(deep-dive-html): E2E link params + disabled state"
```

---

## Self-Review

**Spec coverage:**
- Faithful render via markdown-it (html:false) → Task 2. ✓
- Lazy generate-on-view, no index field, in-memory serve (H-1/H-2) → Tasks 3, 4. ✓
- Unicode path regex, fixes KO 404 for deep-dive AND summary (B-1) → Task 4 (+ summary KO test). ✓
- Output file `htmls/<base>.html` (no doubled suffix), provenance `source-md`=`deepDiveMd` (M-2) → Tasks 2, 3. ✓
- CSS heading levels h1–h4, monospace pre, KO font (M-3) → Task 2. ✓
- Security: raw-HTML escaped + `javascript:` link blocked (M-1) → Task 2 tests. ✓
- Preamble kept (H-4) → Task 2 test. ✓
- Staleness on regen → Task 5; archive cleanup + clear summaryHtml (H-3) → Task 6. ✓
- Menu link → Task 7; integration (ascii + KO) → Task 8; E2E → Task 9. ✓
- Dependency markdown-it + @types → Task 1. ✓

**Placeholder scan:** none. The E2E (Task 9) intentionally provides scenario scaffolds to be filled
against the project's existing Playwright harness (matching how the summary E2E task was specified) —
the assertions and required cases are explicit.

**Type consistency:** `renderDeepDiveHtml(md, sourceMd)`, `runDeepDiveHtml(videoId, outputFolder) →
Promise<string>`, cache path `htmls/<base>.html` with `base = deepDiveMd` minus `.md`, serve `type`
∈ {summary, deep-dive}, `HTML_REL_RE` Unicode — consistent across Tasks 2–8.

**Note for the implementer:** Task 4 rewrites the whole serve route; run the existing summary serve
test (`tests/api/html-serve.test.ts`) AND the summary integration test
(`tests/api/html-doc-pipeline.test.ts`) after, to confirm the summary path is unregressed.
