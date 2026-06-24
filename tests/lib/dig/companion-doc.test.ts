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
