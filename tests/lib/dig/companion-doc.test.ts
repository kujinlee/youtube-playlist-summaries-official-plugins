import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upsertDugSection, readDugSectionIds } from '@/lib/dig/companion-doc';

const base = (p: string, section: any) => ({
  digDeeperPath: p,
  videoTitle: 'V',
  videoId: 'abc12345678',
  language: 'en' as const,
  sourceVideoUrl: 'https://yt/x',
  section,
});

test('first write creates frontmatter + block; readDugSectionIds reflects it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');
  await upsertDugSection(
    base(p, {
      sectionId: 312,
      startSec: 312,
      title: 'Loop',
      bodyMarkdown: 'x',
      generatedAt: 'T',
    }),
  );
  const md = await readFile(p, 'utf8');
  expect(md).toMatch(/## Loop/);
  expect(md).toMatch(/sectionId: 312/);
  // frontmatter delimiters present
  const fences = md.match(/^---$/gm);
  expect(fences).not.toBeNull();
  expect(fences!.length).toBeGreaterThanOrEqual(2);
  // readDugSectionIds re-reads from disk (not from memory)
  expect(await readDugSectionIds(p)).toEqual([312]);
});

test('second section ordered by startSec; re-dig replaces in place', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');
  await upsertDugSection(
    base(p, { sectionId: 312, startSec: 312, title: 'B', bodyMarkdown: 'b1', generatedAt: 'T' }),
  );
  await upsertDugSection(
    base(p, { sectionId: 100, startSec: 100, title: 'A', bodyMarkdown: 'a1', generatedAt: 'T' }),
  );
  await upsertDugSection(
    base(p, { sectionId: 312, startSec: 312, title: 'B', bodyMarkdown: 'b2', generatedAt: 'T' }),
  );
  const md = await readFile(p, 'utf8');
  // ordering: A (startSec=100) before B (startSec=312)
  expect(md.indexOf('## A')).toBeLessThan(md.indexOf('## B'));
  // re-dig: new body present, old body gone
  expect(md).toContain('b2');
  expect(md).not.toContain('b1');
  // section A body still present (other section untouched)
  expect(md).toContain('a1');
  // frontmatter sections sorted and deduplicated
  expect(await readDugSectionIds(p)).toEqual([100, 312]);
});

test('readDugSectionIds returns [] when file does not exist', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'nonexistent.md');
  expect(await readDugSectionIds(p)).toEqual([]);
});

test('readDugSectionIds returns [] when file has no sections key', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'empty.md');
  // write a file with frontmatter but no sections key
  const { writeFile } = await import('node:fs/promises');
  await writeFile(p, '---\ntitle: "X"\n---\n## Something\n\nBody text.\n', 'utf8');
  expect(await readDugSectionIds(p)).toEqual([]);
});

test('generatedAt is passed through from caller (not generated internally)', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');
  await upsertDugSection(
    base(p, {
      sectionId: 1,
      startSec: 1,
      title: 'T',
      bodyMarkdown: 'body',
      generatedAt: '2099-01-01T00:00:00Z',
    }),
  );
  const md = await readFile(p, 'utf8');
  expect(md).toContain('2099-01-01T00:00:00Z');
});

test('ordering in frontmatter sections matches body ordering', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');
  // Insert in reverse startSec order
  await upsertDugSection(
    base(p, { sectionId: 500, startSec: 500, title: 'C', bodyMarkdown: 'c', generatedAt: 'T1' }),
  );
  await upsertDugSection(
    base(p, { sectionId: 200, startSec: 200, title: 'B', bodyMarkdown: 'b', generatedAt: 'T2' }),
  );
  await upsertDugSection(
    base(p, { sectionId: 50, startSec: 50, title: 'A', bodyMarkdown: 'a', generatedAt: 'T3' }),
  );
  const md = await readFile(p, 'utf8');
  const idxA = md.indexOf('## A');
  const idxB = md.indexOf('## B');
  const idxC = md.indexOf('## C');
  expect(idxA).toBeLessThan(idxB);
  expect(idxB).toBeLessThan(idxC);
  // Frontmatter sections also sorted
  expect(await readDugSectionIds(p)).toEqual([50, 200, 500]);
});

test('re-dig does not duplicate frontmatter entry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');
  await upsertDugSection(
    base(p, { sectionId: 42, startSec: 42, title: 'X', bodyMarkdown: 'v1', generatedAt: 'T' }),
  );
  await upsertDugSection(
    base(p, { sectionId: 42, startSec: 42, title: 'X', bodyMarkdown: 'v2', generatedAt: 'T' }),
  );
  // Only one entry in ids list (no duplicate)
  expect(await readDugSectionIds(p)).toEqual([42]);
  // Only one ## X heading in body
  const md = await readFile(p, 'utf8');
  const matches = md.match(/^## X$/gm);
  expect(matches).toHaveLength(1);
});

// C1 — bodyMarkdown containing ## / ### does not corrupt other sections on second upsert
test('round-trip: ## and ### inside bodyMarkdown do not corrupt other sections', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');

  const bodyWithHeadings =
    'Intro paragraph.\n\n## Sub\n\nSub content.\n\n### Deeper\n\nDeeper content.\n';

  // Upsert section A with bodyMarkdown that contains ## and ###
  await upsertDugSection(
    base(p, {
      sectionId: 312,
      startSec: 312,
      title: 'SectionA',
      bodyMarkdown: bodyWithHeadings,
      generatedAt: 'T1',
    }),
  );

  // Upsert a different section B — this triggers a read→parse→modify→rewrite
  await upsertDugSection(
    base(p, {
      sectionId: 100,
      startSec: 100,
      title: 'SectionB',
      bodyMarkdown: 'plain body',
      generatedAt: 'T2',
    }),
  );

  // Re-read and verify both sections are intact
  const ids = await readDugSectionIds(p);
  expect(ids).toEqual([100, 312]);

  // Verify section A's bodyMarkdown is preserved (## Sub and ### Deeper intact)
  const md = await readFile(p, 'utf8');

  // Section A body must contain its internal headings verbatim
  expect(md).toContain('## Sub');
  expect(md).toContain('### Deeper');
  expect(md).toContain('Deeper content.');

  // Section B body must be present and uncontaminated
  expect(md).toContain('plain body');

  // Crucially: both sections must be individually resolvable (third upsert to verify round-trip)
  await upsertDugSection(
    base(p, {
      sectionId: 312,
      startSec: 312,
      title: 'SectionA',
      bodyMarkdown: bodyWithHeadings,
      generatedAt: 'T3',
    }),
  );
  const md2 = await readFile(p, 'utf8');
  expect(await readDugSectionIds(p)).toEqual([100, 312]);
  // Section B must still be intact after re-digging A
  expect(md2).toContain('plain body');
  // Section A's internal headings must still be intact
  expect(md2).toContain('## Sub');
  expect(md2).toContain('### Deeper');
});

// I3 — videoTitle with special chars (", :, #) survives write+read+rewrite
test('special-char videoTitle round-trip: quotes, colon, hash preserved', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');
  const specialTitle = 'Video "Title": #1 Best & Worst';

  await upsertDugSection({
    digDeeperPath: p,
    videoTitle: specialTitle,
    videoId: 'abc12345678',
    language: 'en',
    sourceVideoUrl: 'https://yt/x',
    section: { sectionId: 1, startSec: 1, title: 'T', bodyMarkdown: 'body', generatedAt: 'TS' },
  });

  // Second write to force read→parse→rewrite cycle
  await upsertDugSection({
    digDeeperPath: p,
    videoTitle: specialTitle,
    videoId: 'abc12345678',
    language: 'en',
    sourceVideoUrl: 'https://yt/x',
    section: { sectionId: 2, startSec: 2, title: 'U', bodyMarkdown: 'body2', generatedAt: 'TS2' },
  });

  const md = await readFile(p, 'utf8');
  // The title must be preserved exactly (both double-quotes in the YAML value)
  expect(md).toContain(`"${specialTitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
});

test('concurrent upserts for different sections on same path preserves both sections', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');

  // Fire both upserts simultaneously without awaiting the first
  const p1 = upsertDugSection(
    base(p, { sectionId: 100, startSec: 100, title: 'SectionA', bodyMarkdown: 'body-a', generatedAt: 'T1' }),
  );
  const p2 = upsertDugSection(
    base(p, { sectionId: 200, startSec: 200, title: 'SectionB', bodyMarkdown: 'body-b', generatedAt: 'T2' }),
  );

  await Promise.all([p1, p2]);

  const ids = await readDugSectionIds(p);
  expect(ids).toEqual([100, 200]);

  const md = await readFile(p, 'utf8');
  expect(md).toContain('body-a');
  expect(md).toContain('body-b');
});

test('M-4: bodyMarkdown containing sentinel strings survives round-trip without injecting extra sections', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-'));
  const p = path.join(dir, 'v-dig-deeper.md');

  const sentinelBody = 'Before\n<!-- /dig-section -->\n<!-- dig-section: 999 -->\nAfter';

  await upsertDugSection(
    base(p, { sectionId: 312, startSec: 312, title: 'SentinelTest', bodyMarkdown: sentinelBody, generatedAt: 'T1' }),
  );

  // Force round-trip by adding a second section
  await upsertDugSection(
    base(p, { sectionId: 600, startSec: 600, title: 'Other', bodyMarkdown: 'clean', generatedAt: 'T2' }),
  );

  // Only 2 sections should exist (no spurious 999 injected)
  const ids = await readDugSectionIds(p);
  expect(ids).toEqual([312, 600]);

  const md = await readFile(p, 'utf8');
  expect(md).toContain('clean');
});
