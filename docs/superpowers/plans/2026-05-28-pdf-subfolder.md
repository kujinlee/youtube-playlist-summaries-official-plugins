# PDF Subfolder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all generated PDF files into a `pdfs/` subdirectory within each playlist folder so Obsidian no longer shows duplicate titles for each video.

**Architecture:** Three isolated changes plus a migration script. `lib/pipeline.ts` changes where summary PDFs are written and what path is stored in the index. `lib/deep-dive.ts` does the same for deep-dive PDFs. A migration script moves existing PDF files and updates indexes for already-ingested playlists. The `/api/pdf` route requires no changes — it already resolves `path.join(outputFolder, pdfFile)` where `pdfFile` is the index-stored relative path.

**Tech Stack:** Node.js `fs`, TypeScript, Jest/ts-jest. No new dependencies.

---

## File Map

| File | Change |
|---|---|
| `lib/pipeline.ts` | `reconstructVideo`: check `pdfs/` for PDF; `runIngestion`: write PDF to `pdfs/`, store `pdfs/slug.pdf` |
| `lib/deep-dive.ts` | Write deep-dive PDF to `pdfs/`, store `pdfs/slug-deep-dive.pdf` |
| `scripts/migrate-pdfs-to-subfolder.ts` | New: moves existing PDFs to `pdfs/` subfolder, updates indexes |
| `tests/lib/pipeline.test.ts` | Update `summaryPdf` assertions; update `reconstructVideo` PDF path test |
| `tests/lib/deep-dive.test.ts` | Update `deepDivePdf` assertions |
| `tests/lib/migrate-pdfs-to-subfolder.test.ts` | New: tests for migration script logic |
| `jest.config.ts` | No change — migration tests live in `tests/lib/` |

---

### Task 1: `lib/pipeline.ts` — write PDFs to `pdfs/` subfolder

**Files:**
- Modify: `lib/pipeline.ts:57-59` (`reconstructVideo`)
- Modify: `lib/pipeline.ts:215,263` (`runIngestion`)
- Test: `tests/lib/pipeline.test.ts`

#### Context

`reconstructVideo` (line 57–59) probes the filesystem to detect an existing PDF:

```ts
// CURRENT
const pdfFilename = file.replace(/\.md$/, '.pdf');
const pdfPath = path.join(path.dirname(mdPath), pdfFilename);
const summaryPdf = fs.existsSync(pdfPath) ? pdfFilename : null;
```

`runIngestion` (lines 214–215, 263) writes the PDF and stores its name:

```ts
// CURRENT
const mdPath = path.join(outputFolder, `${baseName}.md`);
const pdfPath = path.join(outputFolder, `${baseName}.pdf`);
// ...
summaryPdf: `${baseName}.pdf`,
```

- [ ] **Step 1: Update `runIngestion` summaryPdf assertions (RED)**

In `tests/lib/pipeline.test.ts`, change lines 207 and 227 from the bare filename to the `pdfs/`-prefixed path:

```ts
// line ~207 — "uses slug-only filename" test
expect(mockUpsertVideo).toHaveBeenCalledWith(
  outputFolder,
  expect.objectContaining({
    summaryMd: 'hello-world.md',
    summaryPdf: 'pdfs/hello-world.pdf',   // was: 'hello-world.pdf'
  }),
);

// line ~227 — "appends -2 suffix" test
expect(mockUpsertVideo).toHaveBeenCalledWith(
  outputFolder,
  expect.objectContaining({
    summaryMd: 'hello-world-2.md',
    summaryPdf: 'pdfs/hello-world-2.pdf',  // was: 'hello-world-2.pdf'
  }),
);
```

- [ ] **Step 2: Update `reconstructVideo` PDF test (RED)**

In `tests/lib/pipeline.test.ts`, around line 639, replace the existing "sets summaryPdf" test so it creates the PDF in the `pdfs/` subfolder and expects the prefixed path:

```ts
it('sets summaryPdf to pdfs/-prefixed path when PDF exists in pdfs/ subfolder', () => {
  const pdfsDir = path.join(tempDir, 'pdfs');
  fs.mkdirSync(pdfsDir, { recursive: true });
  fs.writeFileSync(path.join(pdfsDir, '001_test-video-title.pdf'), '%PDF');
  const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
  expect(video!.summaryPdf).toBe('pdfs/001_test-video-title.pdf');
});

it('sets summaryPdf to null when PDF is absent from pdfs/ subfolder', () => {
  // No PDF file created — neither at root nor in pdfs/
  const video = reconstructVideo(SAMPLE_MD, '001_test-video-title.md', mdPath);
  expect(video!.summaryPdf).toBeNull();
});
```

(The second test replaces the existing "absent" test — behavior is unchanged, the test name is updated for clarity.)

- [ ] **Step 3: Run tests — confirm RED**

```bash
npx jest pipeline.test --no-coverage 2>&1 | grep -E "FAIL|PASS|✓|✗|●" | head -20
```

Expected: failures on the 3 updated assertions, all other tests pass.

- [ ] **Step 4: Update `reconstructVideo` in `lib/pipeline.ts`**

Replace lines 57–59:

```ts
// BEFORE
const pdfFilename = file.replace(/\.md$/, '.pdf');
const pdfPath = path.join(path.dirname(mdPath), pdfFilename);
const summaryPdf = fs.existsSync(pdfPath) ? pdfFilename : null;

// AFTER
const pdfFilename = file.replace(/\.md$/, '.pdf');
const pdfPath = path.join(path.dirname(mdPath), 'pdfs', pdfFilename);
const summaryPdf = fs.existsSync(pdfPath) ? `pdfs/${pdfFilename}` : null;
```

- [ ] **Step 5: Update `runIngestion` in `lib/pipeline.ts`**

Replace the two lines that set `mdPath`/`pdfPath` (around line 214):

```ts
// BEFORE
const mdPath = path.join(outputFolder, `${baseName}.md`);
const pdfPath = path.join(outputFolder, `${baseName}.pdf`);

// AFTER
const mdPath = path.join(outputFolder, `${baseName}.md`);
fs.mkdirSync(path.join(outputFolder, 'pdfs'), { recursive: true });
const pdfPath = path.join(outputFolder, 'pdfs', `${baseName}.pdf`);
```

And update the `summaryPdf` field in the `Video` object (around line 263):

```ts
// BEFORE
summaryPdf: `${baseName}.pdf`,

// AFTER
summaryPdf: `pdfs/${baseName}.pdf`,
```

- [ ] **Step 6: Run tests — confirm GREEN**

```bash
npx jest pipeline.test --no-coverage 2>&1 | tail -6
```

Expected: all pipeline tests pass.

- [ ] **Step 7: Run full suite — confirm no regressions**

```bash
npm test 2>&1 | tail -6
```

Expected: same pass count as before this task (413), no new failures.

- [ ] **Step 8: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "feat(pipeline): write summary PDFs to pdfs/ subfolder

- reconstructVideo: check pdfs/<slug>.pdf instead of root <slug>.pdf
- runIngestion: mkdir pdfs/, write there, store 'pdfs/<slug>.pdf' in index
- Fixes Obsidian showing duplicate titles for .md + .pdf pairs"
```

---

### Task 2: `lib/deep-dive.ts` — write deep-dive PDFs to `pdfs/` subfolder

**Files:**
- Modify: `lib/deep-dive.ts:64,106-108`
- Test: `tests/lib/deep-dive.test.ts`

#### Context

`runDeepDive` (lines 64, 106–112) currently writes the PDF next to the MD at the folder root:

```ts
// CURRENT
const pdfFilename = `${base}-deep-dive.pdf`;
// ...
const pdfPath = path.join(outputFolder, pdfFilename);
onProgress({ type: 'step', videoId, step: 'Generating PDF…', current: 3, total: 3 });
await generatePdf(mdContent, pdfPath);

updateVideoFields(outputFolder, videoId, {
  deepDiveMd: mdFilename,
  deepDivePdf: pdfFilename,
});
```

`SUMMARY_BASE` in the tests is `'001_test-video'`, so `deepDivePdf` is currently expected as `'001_test-video-deep-dive.pdf'`.

- [ ] **Step 1: Update `deepDivePdf` assertions in deep-dive tests (RED)**

In `tests/lib/deep-dive.test.ts`, update all three `deepDivePdf` assertions to the `pdfs/`-prefixed path:

```ts
// line ~144 — "updates index after success"
expect(mockUpdateVideoFields).toHaveBeenCalledWith(
  outputFolder,
  VIDEO_ID,
  expect.objectContaining({
    deepDiveMd: `${SUMMARY_BASE}-deep-dive.md`,
    deepDivePdf: `pdfs/${SUMMARY_BASE}-deep-dive.pdf`,  // was: `${SUMMARY_BASE}-deep-dive.pdf`
  }),
);

// line ~185 — "updates index after fallback success"
expect(mockUpdateVideoFields).toHaveBeenCalledWith(
  outputFolder,
  VIDEO_ID,
  expect.objectContaining({
    deepDiveMd: `${SUMMARY_BASE}-deep-dive.md`,
    deepDivePdf: `pdfs/${SUMMARY_BASE}-deep-dive.pdf`,  // was: `${SUMMARY_BASE}-deep-dive.pdf`
  }),
);

// line ~244 — "falls back to videoId base when summaryMd is null"
expect(mockUpdateVideoFields).toHaveBeenCalledWith(
  outputFolder,
  VIDEO_ID,
  expect.objectContaining({
    deepDiveMd: `${VIDEO_ID}-deep-dive.md`,
    deepDivePdf: `pdfs/${VIDEO_ID}-deep-dive.pdf`,  // was: `${VIDEO_ID}-deep-dive.pdf`
  }),
);
```

- [ ] **Step 2: Run tests — confirm RED**

```bash
npx jest deep-dive.test --no-coverage 2>&1 | grep -E "FAIL|●" | head -10
```

Expected: 3 failures on the updated `deepDivePdf` assertions.

- [ ] **Step 3: Update `lib/deep-dive.ts`**

Change line 64 to add the `pdfs/` prefix:

```ts
// BEFORE
const pdfFilename = `${base}-deep-dive.pdf`;

// AFTER
const pdfFilename = `pdfs/${base}-deep-dive.pdf`;
```

Insert `mkdir` call and keep `pdfPath` as-is (since `path.join(outputFolder, 'pdfs/slug.pdf')` resolves correctly):

```ts
// BEFORE (lines 106-108)
const pdfPath = path.join(outputFolder, pdfFilename);
onProgress({ type: 'step', videoId, step: 'Generating PDF…', current: 3, total: 3 });
await generatePdf(mdContent, pdfPath);

// AFTER
await fs.promises.mkdir(path.join(outputFolder, 'pdfs'), { recursive: true });
const pdfPath = path.join(outputFolder, pdfFilename);
onProgress({ type: 'step', videoId, step: 'Generating PDF…', current: 3, total: 3 });
await generatePdf(mdContent, pdfPath);
```

(`path.join('/base/folder', 'pdfs/slug-deep-dive.pdf')` = `/base/folder/pdfs/slug-deep-dive.pdf` — the join handles the embedded `/` correctly.)

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
npx jest deep-dive.test --no-coverage 2>&1 | tail -5
```

Expected: all deep-dive tests pass.

- [ ] **Step 5: Run full suite — confirm no regressions**

```bash
npm test 2>&1 | tail -6
```

Expected: still 413 passing.

- [ ] **Step 6: Commit**

```bash
git add lib/deep-dive.ts tests/lib/deep-dive.test.ts
git commit -m "feat(deep-dive): write deep-dive PDFs to pdfs/ subfolder

- mkdir pdfs/ before writing
- deepDivePdf stored as 'pdfs/<slug>-deep-dive.pdf'
- Consistent with Task 1 pipeline change"
```

---

### Task 3: Migration script + run on real data

**Files:**
- Create: `scripts/migrate-pdfs-to-subfolder.ts`
- Create: `tests/lib/migrate-pdfs-to-subfolder.test.ts`

#### Context

Existing playlists have PDFs at the folder root (`slug.pdf`) with `summaryPdf: 'slug.pdf'` in their indexes. The migration must:
1. For each playlist folder under `baseOutputFolder`, scan the index
2. For each video where `summaryPdf`/`deepDivePdf` does **not** start with `pdfs/`:
   - Create `pdfs/` dir
   - Move the file (if it exists on disk)
   - Update the index field to `pdfs/<filename>`
3. Write updated index atomically (tmp→rename)
4. Be idempotent: already-migrated playlists are skipped

The script exports `migratePdfsInPlaylistFolder` so it can be tested without subprocess invocation.

- [ ] **Step 1: Write failing migration tests (RED)**

Create `tests/lib/migrate-pdfs-to-subfolder.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests — confirm RED**

```bash
npx jest migrate-pdfs --no-coverage 2>&1 | tail -10
```

Expected: `Cannot find module '../../scripts/migrate-pdfs-to-subfolder'` (script doesn't exist yet).

- [ ] **Step 3: Create `scripts/migrate-pdfs-to-subfolder.ts`**

```ts
/**
 * migrate-pdfs-to-subfolder.ts
 *
 * Moves existing PDF files from the playlist root into a pdfs/ subdirectory
 * and updates playlist-index.json accordingly.
 *
 * This is a one-time migration — run it after deploying the pipeline change
 * that writes new PDFs to pdfs/. Existing playlists are left unchanged until
 * this script runs; the app continues to serve PDFs correctly in the interim
 * because /api/pdf reads the path from the index.
 *
 * Usage (run from project root):
 *   npx ts-node scripts/migrate-pdfs-to-subfolder.ts [baseOutputFolder]
 *
 * If baseOutputFolder is omitted, the script reads it from settings.json.
 */

import * as fs from 'fs';
import * as path from 'path';

interface VideoEntry {
  summaryPdf?: string | null;
  deepDivePdf?: string | null;
  [key: string]: unknown;
}

interface PlaylistIndex {
  videos: VideoEntry[];
  [key: string]: unknown;
}

/**
 * Migrates PDFs in a single playlist folder.
 * Returns true if any changes were made, false if the folder was already up-to-date.
 */
export function migratePdfsInPlaylistFolder(playlistFolder: string): boolean {
  const indexPath = path.join(playlistFolder, 'playlist-index.json');
  if (!fs.existsSync(indexPath)) return false;

  const index: PlaylistIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const pdfsDir = path.join(playlistFolder, 'pdfs');
  let anyChanged = false;

  const videos = index.videos.map((video) => {
    const updates: Partial<VideoEntry> = {};

    for (const field of ['summaryPdf', 'deepDivePdf'] as const) {
      const current = video[field];
      if (!current || current.startsWith('pdfs/')) continue;

      const src = path.join(playlistFolder, current);
      const dest = path.join(playlistFolder, 'pdfs', current);

      if (fs.existsSync(src)) {
        fs.mkdirSync(pdfsDir, { recursive: true });
        fs.renameSync(src, dest);
      }
      updates[field] = `pdfs/${current}`;
    }

    if (Object.keys(updates).length > 0) {
      anyChanged = true;
      return { ...video, ...updates };
    }
    return video;
  });

  if (anyChanged) {
    const updated = JSON.stringify({ ...index, videos }, null, 2) + '\n';
    const tmpPath = `${indexPath}.tmp`;
    fs.writeFileSync(tmpPath, updated, 'utf-8');
    fs.renameSync(tmpPath, indexPath);
  }

  return anyChanged;
}

// CLI entry point — only runs when invoked directly
if (require.main === module) {
  function getBaseFolder(): string {
    const arg = process.argv[2];
    if (arg) return arg;
    try {
      const settings = JSON.parse(fs.readFileSync('settings.json', 'utf-8'));
      const folder = settings.baseOutputFolder ?? settings.outputFolder;
      if (!folder) throw new Error('no folder found in settings.json');
      return folder;
    } catch {
      throw new Error(
        'Pass base folder as first argument, or run from project root with settings.json present.\n' +
        'Usage: npx ts-node scripts/migrate-pdfs-to-subfolder.ts [baseOutputFolder]',
      );
    }
  }

  const baseFolder = getBaseFolder();
  console.log(`Migrating PDFs under: ${baseFolder}\n`);

  const entries = fs.readdirSync(baseFolder, { withFileTypes: true });
  let migratedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const playlistFolder = path.join(baseFolder, entry.name);
    try {
      const changed = migratePdfsInPlaylistFolder(playlistFolder);
      if (changed) {
        console.log(`  ✓ ${entry.name}`);
        migratedCount++;
      }
    } catch (err) {
      console.error(`  ✗ ${entry.name}: ${err}`);
    }
  }

  console.log(`\nDone. ${migratedCount} playlist(s) migrated.`);
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
npx jest migrate-pdfs --no-coverage 2>&1 | tail -8
```

Expected: all 6 migration tests pass.

- [ ] **Step 5: Run full suite — confirm no regressions**

```bash
npm test 2>&1 | tail -6
```

Expected: 419 passing (413 + 6 new migration tests).

- [ ] **Step 6: Run migration on real data**

```bash
npx ts-node scripts/migrate-pdfs-to-subfolder.ts
```

Expected output lists each migrated playlist, e.g.:
```
Migrating PDFs under: /Users/.../youtube-playlist-summaries-official-plugins-data

  ✓ agentic-ai-claude-code
  ✓ cs146s-the-modern-software-development

Done. 2 playlist(s) migrated.
```

Verify manually:
```bash
ls /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data/agentic-ai-claude-code/pdfs/ | head -5
ls /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins-data/agentic-ai-claude-code/*.pdf 2>&1
# Expected: pdfs/ contains .pdf files; no .pdf at root
```

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate-pdfs-to-subfolder.ts tests/lib/migrate-pdfs-to-subfolder.test.ts
git commit -m "feat: migrate existing PDFs to pdfs/ subfolder

- migratePdfsInPlaylistFolder() exported for testing
- Handles missing files gracefully (updates index, skips rename)
- Idempotent: skips videos already in pdfs/ format
- Atomic index write (tmp then rename)
- CLI reads baseOutputFolder from settings.json if not passed as argument"
```
