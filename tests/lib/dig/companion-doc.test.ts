import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upsertDugSection, readDugSectionIds, parseDugSections } from '@/lib/dig/companion-doc';

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

// ── parseDugSections tests (pure string → DugSection[]) ──────────────────────
// Fixtures are built using upsertDugSection (real serializer), then read from
// disk as strings — not hand-rolled. (review L2 compliance)

describe('parseDugSections', () => {
  // Helper: write N sections via upsertDugSection, return the raw file string.
  async function buildFixture(
    sections: Array<{ sectionId: number; startSec: number; title: string; bodyMarkdown: string; generatedAt: string }>,
  ): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-parse-'));
    const p = path.join(dir, 'v-dig-deeper.md');
    for (const s of sections) {
      await upsertDugSection(base(p, s));
    }
    return readFile(p, 'utf8');
  }

  // Behavior 1: multi-block → N DugSections, ids in order, each with
  //             frontmatter startSec+generatedAt AND body title+bodyMarkdown.
  test('B1: multi-block → N sections, ids ordered, all fields populated', async () => {
    const content = await buildFixture([
      { sectionId: 312, startSec: 312, title: 'Loop', bodyMarkdown: 'loop body', generatedAt: '2024-01-01T00:00:00Z' },
      { sectionId: 100, startSec: 100, title: 'Intro', bodyMarkdown: 'intro body', generatedAt: '2024-01-02T00:00:00Z' },
    ]);

    const sections = parseDugSections(content);

    // ids in ascending startSec order (serializer sorts by startSec)
    expect(sections.map((s) => s.sectionId)).toEqual([100, 312]);

    // sectionId=100 (Intro)
    const intro = sections.find((s) => s.sectionId === 100)!;
    expect(intro.startSec).toBe(100);
    expect(intro.title).toBe('Intro');
    expect(intro.bodyMarkdown).toBe('intro body');
    expect(intro.generatedAt).toBe('2024-01-02T00:00:00Z');

    // sectionId=312 (Loop)
    const loop = sections.find((s) => s.sectionId === 312)!;
    expect(loop.startSec).toBe(312);
    expect(loop.title).toBe('Loop');
    expect(loop.bodyMarkdown).toBe('loop body');
    expect(loop.generatedAt).toBe('2024-01-01T00:00:00Z');
  });

  // Behavior 2: bodyMarkdown excludes the `## ` title line itself.
  test('B2: bodyMarkdown excludes the ## title line', async () => {
    const content = await buildFixture([
      { sectionId: 50, startSec: 50, title: 'MySection', bodyMarkdown: 'actual content here', generatedAt: 'T' },
    ]);

    const [section] = parseDugSections(content);
    expect(section.bodyMarkdown).not.toMatch(/^## MySection/m);
    expect(section.bodyMarkdown).toContain('actual content here');
  });

  // Behavior 3: ### subheadings inside bodyMarkdown are preserved.
  test('B3: ### subheadings inside bodyMarkdown are preserved', async () => {
    const bodyWithSubheadings = 'Intro.\n\n### Sub A\n\nContent A.\n\n### Sub B\n\nContent B.';
    const content = await buildFixture([
      { sectionId: 200, startSec: 200, title: 'Parent', bodyMarkdown: bodyWithSubheadings, generatedAt: 'T' },
    ]);

    const [section] = parseDugSections(content);
    expect(section.bodyMarkdown).toContain('### Sub A');
    expect(section.bodyMarkdown).toContain('### Sub B');
    expect(section.bodyMarkdown).toContain('Content A.');
    expect(section.bodyMarkdown).toContain('Content B.');
  });

  // Behavior 4: no sentinel blocks → returns [].
  test('B4: no sentinels → returns []', async () => {
    // A file without any sections key: frontmatter only, no dig-section sentinels
    const content = '---\ntitle: "X"\nvideoId: "abc"\nlanguage: "en"\nsourceVideoUrl: "https://yt/x"\ndigVersion: { major: 1, minor: 0 }\nsections: []\n---\n';
    const sections = parseDugSections(content);
    expect(sections).toEqual([]);
  });

  // Behavior 5: unclosed sentinel → that block is skipped, no throw.
  test('B5: unclosed sentinel is skipped, no throw', async () => {
    // Build a valid 2-section fixture first, then corrupt one sentinel to be unclosed
    const validContent = await buildFixture([
      { sectionId: 100, startSec: 100, title: 'Good', bodyMarkdown: 'good body', generatedAt: 'T1' },
      { sectionId: 200, startSec: 200, title: 'Bad', bodyMarkdown: 'bad body', generatedAt: 'T2' },
    ]);

    // Remove the closing sentinel of section 200 to make it unclosed
    // The serializer produces: <!-- /dig-section --> after each block
    // We'll remove the second closing sentinel
    const corrupted = validContent.replace(
      /<!-- dig-section: 200 -->([\s\S]*?)<!-- \/dig-section -->/,
      '<!-- dig-section: 200 -->\n## Bad\n\nbad body without closing sentinel',
    );

    // Should not throw; section 200 skipped (unclosed); section 100 still parsed
    let sections: ReturnType<typeof parseDugSections> = [];
    expect(() => { sections = parseDugSections(corrupted); }).not.toThrow();
    // Section 100 (properly closed) should still be returned
    const ids = sections.map((s) => s.sectionId);
    expect(ids).toContain(100);
    expect(ids).not.toContain(200);
  });

  // Behavior 6: parseDugSections(content).map(s=>s.sectionId) === readDugSectionIds content
  test('B6: sectionIds from parseDugSections match readDugSectionIds', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dig-parse-'));
    const p = path.join(dir, 'v-dig-deeper.md');

    await upsertDugSection(base(p, { sectionId: 50, startSec: 50, title: 'A', bodyMarkdown: 'a', generatedAt: 'T1' }));
    await upsertDugSection(base(p, { sectionId: 300, startSec: 300, title: 'C', bodyMarkdown: 'c', generatedAt: 'T2' }));
    await upsertDugSection(base(p, { sectionId: 150, startSec: 150, title: 'B', bodyMarkdown: 'b', generatedAt: 'T3' }));

    const content = await readFile(p, 'utf8');
    const fromParser = parseDugSections(content).map((s) => s.sectionId);
    const fromReader = await readDugSectionIds(p);

    expect(fromParser).toEqual(fromReader);
  });
});
