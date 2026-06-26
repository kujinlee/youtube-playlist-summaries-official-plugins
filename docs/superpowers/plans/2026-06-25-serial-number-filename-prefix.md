# Serial-Number Filename Prefix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefix every output filename for a video with a stable, write-once, monotonically-increasing serial (`NNN_<slug>.<ext>`) so files are easy to locate by number, without disturbing the live UI `playlistIndex`.

**Architecture:** A new write-once `serialNumber` field on `Video` is the source of truth for the number; the filename embeds it. New videos get `max+1` at ingest. Existing files are renamed by a two-phase, dry-run-default migration script (Phase A commits all serials atomically; Phase B renames files deterministically with a clobber-safe guard). The old prefix-stripper is removed.

**Tech Stack:** Next.js (custom build — see AGENTS.md), TypeScript, Zod, Jest (ts-jest/SWC), Playwright. `tsc --noEmit` is the real type gate (jest uses SWC, no typecheck).

**Spec:** `docs/superpowers/specs/2026-06-25-serial-number-filename-prefix-design.md` (APPROVED). **Adversarial review:** `docs/reviews/spec-serial-number-filename-prefix-review.md`.

## Global Constraints

- **`serialNumber` is write-once.** Never recompute for a video that already has one. Distinct from `playlistIndex` (current-position; untouched).
- **Filename format:** `NNN_<slug>.<ext>` — zero-pad to **minimum 3 digits**, underscore separator, auto-widen past 999. `String(n).padStart(3,'0')`.
- **Strip pattern is `^\d+_`** (underscore). Safe because `slugify` emits only lowercase alphanumerics + hyphens, never underscores — a slug like `2024-ai-predictions` can never be misread as a serial prefix.
- **The number source for `max` is the index `serialNumber` field, never the filename** (except orphan recovery, the one allowed filename→serial parse).
- **Provenance fix = `source-md` meta string-rewrite, NOT re-render** (re-render no-ops on pre-persisted-model summaries).
- **Migration is dry-run by default;** `--apply` to execute; `--folder <path>` to target one playlist.
- **8 index path-fields** that carry filenames: `summaryMd`, `summaryPdf`, `deepDiveMd`, `deepDivePdf`, `summaryHtml`, `deepDiveHtml`, `digDeeperMd`, `digDeeperHtml`. The `models/<base>.json` file is NOT an index field but IS renamed.
- **No external API calls in unit tests.** Use temp dirs for fs.
- **Run targeted jest first, then `npm test`, then `npx tsc --noEmit` before each commit.**

---

### Task 1: Add `serialNumber` to the Video schema

**Files:**
- Modify: `types/index.ts` (the `Video` Zod schema, near the existing `playlistIndex` at ~line 70)
- Test: `tests/lib/types.test.ts` (create if absent, else add a describe block)

**Interfaces:**
- Produces: `Video.serialNumber?: number` (positive int, optional)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/types.test.ts
import { VideoSchema } from '@/types'; // match the existing export name in types/index.ts

describe('Video.serialNumber', () => {
  const base = {
    id: 'vid123', title: 'T', youtubeUrl: 'https://youtube.com/watch?v=vid123',
    language: 'en', durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: 'a.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    processedAt: '2026-01-01T00:00:00.000Z',
  };
  it('accepts a positive integer serialNumber', () => {
    expect(VideoSchema.parse({ ...base, serialNumber: 7 }).serialNumber).toBe(7);
  });
  it('is optional (absent is valid)', () => {
    expect(VideoSchema.parse(base).serialNumber).toBeUndefined();
  });
  it('rejects zero / negative / non-integer', () => {
    expect(() => VideoSchema.parse({ ...base, serialNumber: 0 })).toThrow();
    expect(() => VideoSchema.parse({ ...base, serialNumber: -1 })).toThrow();
    expect(() => VideoSchema.parse({ ...base, serialNumber: 1.5 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx jest types.test -t serialNumber`
Expected: FAIL (serialNumber not on schema / passes through unvalidated). Confirm the import name (`VideoSchema`) matches `types/index.ts`; fix the import if the export differs.

- [ ] **Step 3: Add the field**

In `types/index.ts`, in the `Video` schema next to `playlistIndex`:
```ts
serialNumber: z.number().int().positive().optional(),
```

- [ ] **Step 4: Run test — verify pass**

Run: `npx jest types.test -t serialNumber` → PASS. Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add types/index.ts tests/lib/types.test.ts
git commit -m "feat(serial): add write-once serialNumber to Video schema"
```

---

### Task 2: Pure serial-filename helpers

**Files:**
- Create: `lib/serial-filename.ts`
- Test: `tests/lib/serial-filename.test.ts`

**Interfaces:**
- Produces:
  - `padSerial(n: number): string` — `padStart(3,'0')`, widens past 999.
  - `stripSerialPrefix(basename: string): string` — removes leading `^\d+_`.
  - `applySerial(relPath: string, serial: number): string` — preserves directory + extension + any `-deep-dive`/`-dig-deeper` suffix; strips an existing serial first (idempotent).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/serial-filename.test.ts
import { padSerial, stripSerialPrefix, applySerial } from '@/lib/serial-filename';

describe('padSerial', () => {
  it('zero-pads to 3 digits', () => { expect(padSerial(7)).toBe('007'); });
  it('keeps 3-digit as-is', () => { expect(padSerial(236)).toBe('236'); });
  it('widens past 999', () => { expect(padSerial(1000)).toBe('1000'); });
});

describe('stripSerialPrefix', () => {
  it('removes a leading NNN_ prefix', () => { expect(stripSerialPrefix('007_hello-world')).toBe('hello-world'); });
  it('leaves a hyphen-digit slug untouched (no underscore)', () => {
    expect(stripSerialPrefix('2024-ai-predictions')).toBe('2024-ai-predictions');
  });
  it('is a no-op when no prefix', () => { expect(stripSerialPrefix('hello-world')).toBe('hello-world'); });
});

describe('applySerial', () => {
  it('prefixes a bare md filename', () => { expect(applySerial('hello-world.md', 1)).toBe('001_hello-world.md'); });
  it('preserves a subdirectory', () => { expect(applySerial('pdfs/hello-world.pdf', 1)).toBe('pdfs/001_hello-world.pdf'); });
  it('preserves the -deep-dive suffix', () => { expect(applySerial('hello-world-deep-dive.md', 5)).toBe('005_hello-world-deep-dive.md'); });
  it('preserves the -dig-deeper suffix', () => { expect(applySerial('hello-world-dig-deeper.md', 5)).toBe('005_hello-world-dig-deeper.md'); });
  it('is idempotent (re-applying same serial)', () => { expect(applySerial('001_hello-world.md', 1)).toBe('001_hello-world.md'); });
  it('replaces an existing different serial', () => { expect(applySerial('002_hello-world.md', 7)).toBe('007_hello-world.md'); });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx jest serial-filename` → FAIL ("Cannot find module '@/lib/serial-filename'").

- [ ] **Step 3: Implement**

```ts
// lib/serial-filename.ts
import path from 'path';

const SERIAL_PREFIX = /^\d+_/;

/** Zero-pad to minimum 3 digits; widens automatically past 999. */
export function padSerial(n: number): string {
  return String(n).padStart(3, '0');
}

/** Remove a leading `NNN_` serial prefix from a basename (no-op if absent). */
export function stripSerialPrefix(basename: string): string {
  return basename.replace(SERIAL_PREFIX, '');
}

/**
 * Apply a serial prefix to a relative path, preserving directory + extension +
 * any `-deep-dive`/`-dig-deeper` suffix (those live in the basename already).
 * Strips any existing serial first → idempotent.
 */
export function applySerial(relPath: string, serial: number): string {
  const dir = path.dirname(relPath);   // '.' for bare names
  const base = path.basename(relPath);
  const prefixed = `${padSerial(serial)}_${stripSerialPrefix(base)}`;
  return dir === '.' ? prefixed : `${dir}/${prefixed}`;
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `npx jest serial-filename` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add lib/serial-filename.ts tests/lib/serial-filename.test.ts
git commit -m "feat(serial): pure filename prefix/strip/apply helpers"
```

---

### Task 3: Serial assignment helpers (`nextSerial`, `backfillOrder`)

**Files:**
- Create: `lib/serial-assign.ts`
- Test: `tests/lib/serial-assign.test.ts`

**Interfaces:**
- Consumes: `Video` from `@/types`.
- Produces:
  - `nextSerial(videos: Video[]): number` — `max(serialNumber over all videos, incl archived) + 1`, else `1`.
  - `backfillOrder(videos: Video[]): Video[]` — videos with `summaryMd != null` and no `serialNumber`, sorted by `processedAt` asc, tie-break `id`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/serial-assign.test.ts
import { nextSerial, backfillOrder } from '@/lib/serial-assign';
import type { Video } from '@/types';

const v = (over: Partial<Video>): Video => ({
  id: 'x', title: 'T', youtubeUrl: 'u', language: 'en', durationSeconds: 1, archived: false,
  ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
  overallScore: 3, summaryMd: 's.md', summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
  processedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('nextSerial', () => {
  it('is 1 when no video has a serial', () => { expect(nextSerial([v({}), v({ id: 'y' })])).toBe(1); });
  it('is max+1 including archived', () => {
    expect(nextSerial([v({ serialNumber: 3 }), v({ id: 'y', serialNumber: 9, archived: true })])).toBe(10);
  });
});

describe('backfillOrder', () => {
  it('orders by processedAt asc, tie-break id, only files-without-serial', () => {
    const out = backfillOrder([
      v({ id: 'b', processedAt: '2026-01-02T00:00:00.000Z' }),
      v({ id: 'a', processedAt: '2026-01-01T00:00:00.000Z' }),
      v({ id: 'c', processedAt: '2026-01-01T00:00:00.000Z' }),
      v({ id: 'has', serialNumber: 5 }),          // already has serial → excluded
      v({ id: 'nofile', summaryMd: null }),        // no file → excluded
    ]);
    expect(out.map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx jest serial-assign` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// lib/serial-assign.ts
import type { Video } from '@/types';

export function nextSerial(videos: Video[]): number {
  const max = videos.reduce((m, v) => (v.serialNumber && v.serialNumber > m ? v.serialNumber : m), 0);
  return max + 1;
}

export function backfillOrder(videos: Video[]): Video[] {
  return videos
    .filter((v) => v.summaryMd != null && v.serialNumber == null)
    .sort((a, b) =>
      a.processedAt < b.processedAt ? -1 :
      a.processedAt > b.processedAt ? 1 :
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
}
```

- [ ] **Step 4: Run test → PASS; `npx tsc --noEmit` → clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/serial-assign.ts tests/lib/serial-assign.test.ts
git commit -m "feat(serial): nextSerial + backfillOrder assignment helpers"
```

---

### Task 4: Assign + prefix at ingest (pipeline)

**Files:**
- Modify: `lib/pipeline.ts` (the new-video block ~331-371)
- Test: `tests/lib/pipeline.test.ts` (add a describe block; follow the existing mock setup for `writeSummaryDoc`/`upsertVideo`)

**Interfaces:**
- Consumes: `nextSerial` (Task 3), `applySerial`/`padSerial` (Task 2), `readIndex`/`upsertVideo` (`lib/index-store`).
- Produces: new videos carry `serialNumber` and all filename fields are `NNN_`-prefixed.

**Note:** compute the serial from a fresh `readIndex(outputFolder)` immediately before building `baseName` (the prefix must be on the filename before `writeSummaryDoc` writes it). The loop is sequential and `upsertVideo` updates the index each iteration, so `max+1` increments correctly within a run. Cross-process concurrency is the documented residual race (spec §5.1) — do not add locking.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/pipeline.test.ts (new describe)
it('assigns serialNumber=1 and prefixes filenames for the first ingested video', async () => {
  // Arrange: empty index in a temp outputFolder; mock writeSummaryDoc to write the md and
  // return its fields (mirror the existing pipeline.test mock). Run ingestion for one meta.
  // Assert on the upserted video:
  expect(mockUpsertVideo).toHaveBeenCalledWith(
    outputFolder,
    expect.objectContaining({ serialNumber: 1, summaryMd: '001_<expected-slug>.md' }),
  );
});

it('continues from max+1 when the index already has serials', async () => {
  // Arrange: seed index with a video { serialNumber: 41 }. Ingest a new video.
  expect(mockUpsertVideo).toHaveBeenCalledWith(
    outputFolder, expect.objectContaining({ serialNumber: 42, summaryMd: '042_<slug>.md' }),
  );
});
```

(Match the exact slug your test title produces via `slugify`. **The harness is mock-based:** `tests/lib/pipeline.test.ts` uses `jest.mock('../../lib/index-store')` with `mockReadIndex`/`mockUpsertVideo`/`mockWriteIndex` (~L7-29) and a `makeIndexedVideo` builder (~L60). Drive `mockReadIndex.mockReturnValue({ videos: [...] })` to set the existing serials, and assert on `mockUpsertVideo`. Do not invent a new harness. Task 5's `reconstructVideo` tests use a **real temp dir** for `mdPath`, ~L823-834.)

- [ ] **Step 2: Run test — verify it fails**

Run: `npx jest pipeline.test -t serialNumber` → FAIL (no serialNumber; filenames unprefixed).

- [ ] **Step 3: Implement**

In `lib/pipeline.ts`, in the new-video block, before the `baseName` collision loop:
```ts
import { nextSerial } from './serial-assign';
import { applySerial, padSerial } from './serial-filename';
// ...
const serial = nextSerial(readIndex(outputFolder).videos);
const slug = slugify(meta.title);
let baseSlug = slug;
let counter = 2;
// serial makes filenames unique; collision suffix kept for slug readability only.
while (fs.existsSync(path.join(outputFolder, applySerial(`${baseSlug}.md`, serial)))) {
  baseSlug = `${slug}-${counter}`;
  counter++;
}
const baseName = `${padSerial(serial)}_${baseSlug}`;   // writeSummaryDoc writes <baseName>.md
```
Then in the `video` literal, set `summaryMd: \`${baseName}.md\`` (already does), `summaryPdf: null` (already), and add `serialNumber: serial,`. `writeSummaryDoc({ ..., baseName })` is unchanged — it writes `<baseName>.md`, which now includes the prefix.

- [ ] **Step 4: Run test → PASS. Run full `npx jest pipeline.test` → no regressions. `npx tsc --noEmit` → clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "feat(serial): assign serialNumber + prefix filenames at ingest"
```

---

### Task 5: Orphan recovery adopts the serial from the filename

**Files:**
- Modify: `lib/pipeline.ts` (`reconstructVideo`, ~106-161)
- Test: `tests/lib/pipeline.test.ts`

**Interfaces:**
- Consumes: `stripSerialPrefix` is NOT needed here; parse the leading digits directly.
- Produces: a reconstructed video whose `serialNumber` matches a `NNN_` filename prefix when present.

- [ ] **Step 1: Write the failing test**

```ts
it('reconstructVideo adopts the NNN_ serial from a prefixed filename', () => {
  const md = '---\nvideo_id: vidABC\n---\n# Title\n';
  // file mtime needs a real path; reuse the test's temp-file helper for mdPath.
  const out = reconstructVideo(md, '007_some-slug.md', mdPathFor('007_some-slug.md', md));
  expect(out?.serialNumber).toBe(7);
});

it('reconstructVideo leaves serialNumber undefined for an unprefixed filename', () => {
  const md = '---\nvideo_id: vidABC\n---\n# Title\n';
  const out = reconstructVideo(md, 'some-slug.md', mdPathFor('some-slug.md', md));
  expect(out?.serialNumber).toBeUndefined();
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

In `reconstructVideo`, after computing `summaryMd = file;`:
```ts
const serialMatch = file.match(/^(\d+)_/);
const serialNumber = serialMatch ? parseInt(serialMatch[1], 10) : undefined;
```
and in the returned object add:
```ts
...(serialNumber !== undefined && { serialNumber }),
```

- [ ] **Step 4: Run test → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline.test.ts
git commit -m "feat(serial): orphan recovery adopts NNN_ serial from filename"
```

---

### Task 6: Remove the prefix-stripper

**Files:**
- Modify: `lib/pipeline.ts` (delete `migrateToSlugFilenames`, `RANK_PREFIX`, `FILENAME_FIELDS` at ~206-233)
- Modify: `app/api/videos/route.ts` — remove the `migrateToSlugFilenames(...)` call (~line 71) **AND drop it from the named import at line 3** (`import { recoverOrphanedVideos, migrateToSlugFilenames }` → `import { recoverOrphanedVideos }`); keep `recoverOrphanedVideos` (line 70) intact (L1)
- Test: delete the `migrateToSlugFilenames` describe block in `tests/lib/pipeline.test.ts` (~lines 952-1027) **and remove it from the test's import at ~line 12** (L2)

**Interfaces:**
- Removes: `migrateToSlugFilenames` (no other caller — verified).

- [ ] **Step 1: Find all references**

Run: `grep -rn "migrateToSlugFilenames" lib app tests`
Expected: the definition (`pipeline.ts`), the caller (`app/api/videos/route.ts`), and its tests.

- [ ] **Step 2: Delete the function + constants + caller + tests**

Remove `RANK_PREFIX`, `FILENAME_FIELDS`, the whole `migrateToSlugFilenames` function from `pipeline.ts`; remove its import + invocation line in `app/api/videos/route.ts` (leave the `recoverOrphanedVideos` try/catch intact); delete the `migrateToSlugFilenames` describe/it blocks from `pipeline.test.ts`.

- [ ] **Step 3: Run tests + typecheck**

Run: `npx jest pipeline.test` → PASS (no missing-symbol failures). `npx tsc --noEmit` → clean (catches any lingering reference).

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline.ts app/api/videos/route.ts tests/lib/pipeline.test.ts
git commit -m "feat(serial): remove NNN_ prefix-stripper (migrateToSlugFilenames)"
```

---

### Task 7: Provenance rewrite helpers

**Files:**
- Create: `lib/serial-provenance.ts`
- Test: `tests/lib/serial-provenance.test.ts`

**Interfaces:**
- Produces:
  - `rewriteSourceMdMeta(html: string, newMdName: string): string` — replaces the `content` of `<meta name="source-md" content="...">` (works for summary/deep-dive/dig-deeper HTML — all use the same meta tag).
  - `rewriteEnvelopeSourceMd(jsonText: string, newMdName: string): string` — replaces the top-level `"sourceMd"` value in a model-envelope JSON string.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/serial-provenance.test.ts
import { rewriteSourceMdMeta, rewriteEnvelopeSourceMd } from '@/lib/serial-provenance';

describe('rewriteSourceMdMeta', () => {
  it('rewrites the source-md meta content', () => {
    const html = '<meta name="source-md" content="hello-world.md">';
    expect(rewriteSourceMdMeta(html, '001_hello-world.md'))
      .toBe('<meta name="source-md" content="001_hello-world.md">');
  });
  it('escapes double quotes in the new name defensively', () => {
    expect(rewriteSourceMdMeta('<meta name="source-md" content="x">', 'a"b.md'))
      .toContain('content="a&quot;b.md"');
  });
  it('is a no-op when no source-md meta present', () => {
    expect(rewriteSourceMdMeta('<p>no meta</p>', '001_x.md')).toBe('<p>no meta</p>');
  });
});

describe('rewriteEnvelopeSourceMd', () => {
  it('rewrites the sourceMd JSON field', () => {
    const json = '{"sourceMd":"hello-world.md","generatedAt":"t"}';
    const out = JSON.parse(rewriteEnvelopeSourceMd(json, '001_hello-world.md'));
    expect(out.sourceMd).toBe('001_hello-world.md');
    expect(out.generatedAt).toBe('t');
  });
});
```

- [ ] **Step 2: Run test → FAIL (module missing).**

- [ ] **Step 3: Implement**

```ts
// lib/serial-provenance.ts
function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Rewrite the content of <meta name="source-md" content="..."> (no-op if absent). */
export function rewriteSourceMdMeta(html: string, newMdName: string): string {
  return html.replace(
    /(<meta name="source-md" content=")[^"]*(">)/,
    `$1${escAttr(newMdName)}$2`,
  );
}

/** Rewrite the top-level "sourceMd" string in a model-envelope JSON (parse→set→stringify). */
export function rewriteEnvelopeSourceMd(jsonText: string, newMdName: string): string {
  const obj = JSON.parse(jsonText) as Record<string, unknown>;
  obj.sourceMd = newMdName;
  return JSON.stringify(obj);
}
```

(Verify the exact meta markup against `lib/html-doc/render.ts:107` — adjust the regex if attribute order differs.)

- [ ] **Step 4: Run test → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/serial-provenance.ts tests/lib/serial-provenance.test.ts
git commit -m "feat(serial): source-md meta + envelope sourceMd rewrite helpers"
```

---

### Task 8: Pure migration planner (Phase A + Phase B plan)

**Files:**
- Create: `lib/serial-migrate.ts`
- Test: `tests/lib/serial-migrate.test.ts`

**Interfaces:**
- Consumes: `Video` (`@/types`), `nextSerial`/`backfillOrder` (Task 3), `applySerial` (Task 2).
- Produces:
  - `type RenameOp = { field: keyof Video | 'model'; from: string; to: string }`
  - `type VideoPlan = { id: string; serial: number; renames: RenameOp[] }`
  - `planMigration(videos: Video[]): { assignments: Array<{ id: string; serial: number }>; perVideo: VideoPlan[] }`
    - `assignments`: serials for videos in `backfillOrder`, starting at `nextSerial`.
    - `perVideo`: for **every** video that has a serial (existing or just-assigned), the rename ops for each of the 8 path-fields that are non-null, plus the derived `models/<base>.json` (from `summaryMd` base) and using `applySerial`. Skip a field whose value already equals its `applySerial` target (idempotent).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/serial-migrate.test.ts
import { planMigration } from '@/lib/serial-migrate';
import type { Video } from '@/types';
const v = (over: Partial<Video>): Video => ({ /* same builder as Task 3 */ } as Video);

it('assigns serials in backfill order and plans md+pdf+model renames', () => {
  const { assignments, perVideo } = planMigration([
    v({ id: 'a', processedAt: '2026-01-01T00:00:00.000Z', summaryMd: 'alpha.md', summaryPdf: 'pdfs/alpha.pdf' }),
  ]);
  expect(assignments).toEqual([{ id: 'a', serial: 1 }]);
  const ops = perVideo[0].renames;
  expect(ops).toContainEqual({ field: 'summaryMd', from: 'alpha.md', to: '001_alpha.md' });
  expect(ops).toContainEqual({ field: 'summaryPdf', from: 'pdfs/alpha.pdf', to: 'pdfs/001_alpha.pdf' });
  expect(ops).toContainEqual({ field: 'model', from: 'models/alpha.json', to: 'models/001_alpha.json' });
});

it('skips already-prefixed fields (idempotent)', () => {
  const { perVideo } = planMigration([v({ id: 'a', serialNumber: 1, summaryMd: '001_alpha.md' })]);
  expect(perVideo[0].renames.find((o) => o.field === 'summaryMd')).toBeUndefined();
});

it('continues max+1 over existing serials', () => {
  const { assignments } = planMigration([
    v({ id: 'old', serialNumber: 9 }),
    v({ id: 'new', summaryMd: 'n.md', processedAt: '2026-02-01T00:00:00.000Z' }),
  ]);
  expect(assignments).toEqual([{ id: 'new', serial: 10 }]);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/serial-migrate.ts
import type { Video } from '@/types';
import { nextSerial, backfillOrder } from './serial-assign';
import { applySerial } from './serial-filename';

const PATH_FIELDS = [
  'summaryMd', 'summaryPdf', 'deepDiveMd', 'deepDivePdf',
  'summaryHtml', 'deepDiveHtml', 'digDeeperMd', 'digDeeperHtml',
] as const;

export type RenameOp = { field: (typeof PATH_FIELDS)[number] | 'model'; from: string; to: string };
export type VideoPlan = { id: string; serial: number; renames: RenameOp[] };

export function planMigration(videos: Video[]): {
  assignments: Array<{ id: string; serial: number }>;
  perVideo: VideoPlan[];
} {
  const start = nextSerial(videos);
  const assignments = backfillOrder(videos).map((vid, i) => ({ id: vid.id, serial: start + i }));
  const serialById = new Map<string, number>(assignments.map((a) => [a.id, a.serial]));

  const perVideo: VideoPlan[] = [];
  for (const vid of videos) {
    const serial = vid.serialNumber ?? serialById.get(vid.id);
    if (serial == null) continue; // no file / not targeted
    const renames: RenameOp[] = [];
    for (const f of PATH_FIELDS) {
      const cur = vid[f] as string | null | undefined;
      if (!cur) continue;
      const to = applySerial(cur, serial);
      if (to !== cur) renames.push({ field: f, from: cur, to });
    }
    if (vid.summaryMd) {
      const base = vid.summaryMd.replace(/\.md$/, '');
      const modelFrom = `models/${base}.json`;
      const modelTo = applySerial(modelFrom, serial);
      if (modelTo !== modelFrom) renames.push({ field: 'model', from: modelFrom, to: modelTo });
    }
    perVideo.push({ id: vid.id, serial, renames });
  }
  return { assignments, perVideo };
}
```

- [ ] **Step 4: Run test → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/serial-migrate.ts tests/lib/serial-migrate.test.ts
git commit -m "feat(serial): pure migration planner (assignments + per-video rename ops)"
```

---

### Task 9: Migration executor — Phase A (assign, atomic index write)

**Files:**
- Create: `lib/serial-migrate-exec.ts` (start the file here; Phase B added in Task 10)
- Test: `tests/lib/serial-migrate-exec.test.ts`

**Interfaces:**
- Consumes: `readIndex`/`writeIndex` (`lib/index-store`), `planMigration` (Task 8).
- Produces: `runPhaseA(outputFolder: string): { assigned: number }` — reads index, applies `assignments` (sets `serialNumber` on each), writes the index **once** atomically. Idempotent (videos with a serial already are not in `assignments`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/serial-migrate-exec.test.ts — use a real temp outputFolder with a writeIndex seed
it('Phase A assigns serials to all file-bearing videos in one write and is idempotent', () => {
  // seed index with 2 videos (summaryMd set, no serialNumber), processedAt ordered
  const r1 = runPhaseA(outputFolder);
  expect(r1.assigned).toBe(2);
  const after = readIndex(outputFolder).videos.map((v) => v.serialNumber).sort();
  expect(after).toEqual([1, 2]);
  const r2 = runPhaseA(outputFolder);     // idempotent
  expect(r2.assigned).toBe(0);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/serial-migrate-exec.ts
import { readIndex, writeIndex } from './index-store';
import { planMigration } from './serial-migrate';

export function runPhaseA(outputFolder: string): { assigned: number } {
  const index = readIndex(outputFolder);
  const { assignments } = planMigration(index.videos);
  if (assignments.length === 0) return { assigned: 0 };
  const serialById = new Map(assignments.map((a) => [a.id, a.serial]));
  const videos = index.videos.map((v) =>
    serialById.has(v.id) ? { ...v, serialNumber: serialById.get(v.id)! } : v,
  );
  writeIndex(outputFolder, { ...index, videos });   // single atomic write (temp→rename)
  return { assigned: assignments.length };
}
```

- [ ] **Step 4: Run test → PASS. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/serial-migrate-exec.ts tests/lib/serial-migrate-exec.test.ts
git commit -m "feat(serial): migration Phase A — atomic serial assignment"
```

---

### Task 10: Migration executor — Phase B (guarded rename + provenance + per-video index update)

**Files:**
- Modify: `lib/serial-migrate-exec.ts`
- Test: `tests/lib/serial-migrate-exec.test.ts`

**Interfaces:**
- Consumes: `planMigration` (Task 8), `updateVideoFields`/`readIndex` (`lib/index-store`), `rewriteSourceMdMeta`/`rewriteEnvelopeSourceMd` (Task 7).
- Produces: `runPhaseB(outputFolder: string): { renamed: number; conflicts: string[] }`.

**Behavior (from spec §6):** for each `VideoPlan`, resolve each artifact at its actual on-disk location (root **or** `archived/<relPath>`); rename only if `exists(src) && !exists(dst)`; if `dst` exists and is the intended target, skip; if `dst` exists with different content, push the videoId to `conflicts` and skip that video (no clobber). After renames for a video succeed: rewrite `<meta name="source-md">` in any renamed HTML to its new `.md` name; rewrite the model envelope's `sourceMd`; then `updateVideoFields(outputFolder, id, <new path fields>)` (per-video write — bounded blast radius). Re-running is idempotent (already-renamed targets skipped).

- [ ] **Step 1: Write the failing tests**

```ts
it('Phase B renames md+pdf+model and updates the 8 index fields per video', () => {
  // seed: index video {id:'a', serialNumber:1, summaryMd:'alpha.md', summaryPdf:'pdfs/alpha.pdf'};
  // create files alpha.md, pdfs/alpha.pdf, models/alpha.json on disk.
  const r = runPhaseB(outputFolder);
  expect(fs.existsSync(path.join(outputFolder, '001_alpha.md'))).toBe(true);
  expect(fs.existsSync(path.join(outputFolder, 'pdfs/001_alpha.pdf'))).toBe(true);
  expect(fs.existsSync(path.join(outputFolder, 'models/001_alpha.json'))).toBe(true);
  expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md');
  expect(r.conflicts).toEqual([]);
});

it('aborts a video (conflict, no clobber) when target exists with different content', () => {
  // seed video {serialNumber:1, summaryMd:'alpha.md'}; create alpha.md ("new") AND 001_alpha.md ("OTHER")
  const r = runPhaseB(outputFolder);
  expect(r.conflicts).toContain('a');
  expect(fs.readFileSync(path.join(outputFolder, '001_alpha.md'), 'utf8')).toBe('OTHER'); // untouched
});

it('rewrites source-md meta in renamed summary HTML', () => {
  // seed video with summaryHtml:'htmls/alpha.html' whose content has
  // <meta name="source-md" content="alpha.md">; serialNumber:1
  runPhaseB(outputFolder);
  const html = fs.readFileSync(path.join(outputFolder, 'htmls/001_alpha.html'), 'utf8');
  expect(html).toContain('content="001_alpha.md"');
});

it('is idempotent on re-run (already-prefixed → no-op)', () => {
  runPhaseB(outputFolder);
  const r2 = runPhaseB(outputFolder);
  expect(r2.renamed).toBe(0);
});

// B1: archived file is renamed UNDER archived/, but the index field stays ROOT-relative.
it('renames archived files under archived/ and stores a root-relative index field', () => {
  // seed archived video {serialNumber:1, summaryMd:'alpha.md'}; file at archived/alpha.md
  runPhaseB(outputFolder);
  expect(fs.existsSync(path.join(outputFolder, 'archived/001_alpha.md'))).toBe(true);
  // CRITICAL: index field must be '001_alpha.md', NOT 'archived/001_alpha.md'
  // (unarchiveVideo reconstructs the archived/ path from a root-relative field).
  expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md');
});

// B2: crash mid-video (file renamed, index not yet updated) → re-run must converge the index.
it('repairs a stale index field when the file was already renamed by a crashed run', () => {
  // seed video {id:'a', serialNumber:1, summaryMd:'alpha.md'} but the file on disk is ALREADY '001_alpha.md'
  // (simulating: Phase A committed serial; a prior Phase B renamed the file then crashed before updateVideoFields)
  const r = runPhaseB(outputFolder);
  expect(r.renamed).toBe(0); // nothing to physically rename
  expect(readIndex(outputFolder).videos[0].summaryMd).toBe('001_alpha.md'); // index converged
  expect(r.conflicts).toEqual([]);
});
```

- [ ] **Step 2: Run tests → FAIL.**

- [ ] **Step 3: Implement**

```ts
// add to lib/serial-migrate-exec.ts
import fs from 'fs';
import path from 'path';
import { updateVideoFields } from './index-store';
import { rewriteSourceMdMeta, rewriteEnvelopeSourceMd } from './serial-provenance';
import type { RenameOp } from './serial-migrate';

/** Resolve a relPath to its actual on-disk absolute path (root or archived/). Null if neither exists. */
function resolveOnDisk(outputFolder: string, relPath: string): { abs: string; rel: string } | null {
  const root = path.join(outputFolder, relPath);
  if (fs.existsSync(root)) return { abs: root, rel: relPath };
  const arch = path.join(outputFolder, 'archived', relPath);
  if (fs.existsSync(arch)) return { abs: arch, rel: `archived/${relPath}` };
  return null;
}

/** Physical dst path that mirrors src's actual location (root or archived/), with the new basename. */
function physicalDst(src: { abs: string }, op: { to: string }): string {
  return path.join(path.dirname(src.abs), path.basename(op.to));
}

export function runPhaseB(outputFolder: string): { renamed: number; conflicts: string[] } {
  const index = readIndex(outputFolder);
  const { perVideo } = planMigration(index.videos);
  let renamed = 0;
  const conflicts: string[] = [];

  for (const plan of perVideo) {
    if (plan.renames.length === 0) continue;

    // ── Pass 1: clobber-conflict check (only when BOTH src present AND a different dst exists). ──
    let aborted = false;
    for (const op of plan.renames) {
      const src = resolveOnDisk(outputFolder, op.from);
      if (!src) continue;                                  // src gone → not a conflict (see B2)
      const dstAbs = physicalDst(src, op);
      if (fs.existsSync(dstAbs) && fs.realpathSync(dstAbs) !== fs.realpathSync(src.abs)) {
        conflicts.push(plan.id); aborted = true; break;    // different file at target → never clobber
      }
    }
    if (aborted) continue;

    // ── Pass 2: rename (or recognise already-renamed) + collect index updates + provenance targets. ──
    const fieldUpdates: Record<string, string> = {};       // index value is ALWAYS op.to (root-relative) — B1
    const htmlTargetsAbs: string[] = [];
    let mdNewName: string | null = null;
    let modelTargetAbs: string | null = null;

    for (const op of plan.renames) {
      let targetAbs: string | null = null;
      const src = resolveOnDisk(outputFolder, op.from);
      if (src) {
        const dstAbs = physicalDst(src, op);
        if (!fs.existsSync(dstAbs)) { fs.renameSync(src.abs, dstAbs); renamed++; }
        targetAbs = dstAbs;
      } else {
        // B2: src missing — a prior crashed run may have already renamed it. Probe the target.
        const done = resolveOnDisk(outputFolder, op.to);
        if (done) targetAbs = done.abs;                    // already-renamed → still converge the index
        // else: artifact simply doesn't exist → skip entirely
      }
      if (targetAbs === null) continue;

      if (op.field !== 'model') fieldUpdates[op.field] = op.to;   // ROOT-relative — B1
      if (op.field === 'summaryMd') mdNewName = path.basename(op.to);
      if (op.field === 'model') modelTargetAbs = targetAbs;
      if (op.field === 'summaryHtml' || op.field === 'deepDiveHtml' || op.field === 'digDeeperHtml') {
        htmlTargetsAbs.push(targetAbs);
      }
    }

    // ── Provenance: rewrite source-md meta in the renamed HTML + the envelope sourceMd. Best-effort. ──
    if (mdNewName) {
      for (const h of htmlTargetsAbs) {
        try { fs.writeFileSync(h, rewriteSourceMdMeta(fs.readFileSync(h, 'utf8'), mdNewName)); } catch { /* no-op */ }
      }
      if (modelTargetAbs) {
        try { fs.writeFileSync(modelTargetAbs, rewriteEnvelopeSourceMd(fs.readFileSync(modelTargetAbs, 'utf8'), mdNewName)); } catch { /* no-op */ }
      }
    }

    // ── Per-video index update (bounded blast radius — B1/B2 convergence). ──
    if (Object.keys(fieldUpdates).length > 0) updateVideoFields(outputFolder, plan.id, fieldUpdates);
  }
  return { renamed, conflicts };
}
```

(Note — review M1: `digDeeperHtml` is **currently never persisted** to the index — dig-deeper HTML is re-rendered fresh on every GET (`app/api/html/[id]/route.ts:195`). So its rename op never finds a file and its provenance branch never fires today. Keeping `digDeeperHtml` in the field list is harmless and future-proof. Also: the dig-deeper renderer is called with the **summary** `mdPath`, so its `source-md` already points at the summary md — `mdNewName` is correct as-is, no per-HTML special case needed.)

- [ ] **Step 4: Run tests → PASS. Full `npm test`. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add lib/serial-migrate-exec.ts tests/lib/serial-migrate-exec.test.ts
git commit -m "feat(serial): migration Phase B — guarded rename + provenance + per-video index update"
```

---

### Task 11: Migration CLI script (dry-run default, --apply, --folder)

**Files:**
- Create: `scripts/backfill-serial-prefix.ts`
- Modify: `package.json` — add a script entry **matching the existing `scripts/` runner** (repo uses `ts-node` with a CommonJS override; `tsx` is NOT installed):
  ```json
  "backfill-serial": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/backfill-serial-prefix.ts"
  ```
- Test: `tests/scripts/backfill-serial-prefix.test.ts` (import the planner + a `dryRunReport(outputFolder)` pure function; smoke-test the report)

**Interfaces:**
- Consumes: `planMigration` (Task 8), `runPhaseA`/`runPhaseB` (Tasks 9-10), `readIndex`.
- Produces: a CLI that prints the plan by default and only mutates with `--apply`.

- [ ] **Step 1: Write the failing test (pure report function)**

```ts
// tests/scripts/backfill-serial-prefix.test.ts
import { dryRunReport } from '@/scripts/backfill-serial-prefix';
it('dry-run report lists planned renames without touching disk', () => {
  // seed temp index + files; call dryRunReport(outputFolder)
  const report = dryRunReport(outputFolder);
  expect(report).toContain('001_alpha.md');
  // assert no file was renamed
  expect(fs.existsSync(path.join(outputFolder, 'alpha.md'))).toBe(true);
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

```ts
// scripts/backfill-serial-prefix.ts
// NOTE: relative imports — ts-node (CommonJS override) does NOT resolve `@/*` at runtime
// (only jest's moduleNameMapper does). Scripts in this repo all use relative imports.
import { readIndex } from '../lib/index-store';
import { planMigration } from '../lib/serial-migrate';
import { runPhaseA, runPhaseB } from '../lib/serial-migrate-exec';

export function dryRunReport(outputFolder: string): string {
  const { assignments, perVideo } = planMigration(readIndex(outputFolder).videos);
  const lines: string[] = [`DRY RUN — ${assignments.length} new serial(s) to assign`];
  for (const p of perVideo) for (const op of p.renames) lines.push(`  [${p.serial}] ${op.from}  ->  ${op.to}`);
  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const folderArg = args.indexOf('--folder');
  const outputFolder = folderArg !== -1 ? args[folderArg + 1] : process.cwd();
  if (!apply) { console.log(dryRunReport(outputFolder)); console.log('\n(dry run — pass --apply to execute. Do NOT run concurrently with ingestion.)'); return; }
  const a = runPhaseA(outputFolder);
  const b = runPhaseB(outputFolder);
  console.log(`Applied: assigned ${a.assigned}, renamed ${b.renamed}, conflicts ${b.conflicts.length}`);
  if (b.conflicts.length) console.error('Conflicts (not renamed):', b.conflicts.join(', '));
}

// Run only when invoked directly (not when imported by tests).
if (require.main === module) main();
```

- [ ] **Step 4: Run test → PASS. Manual dry-run smoke on a COPY of a real folder; verify the report; then `--apply` on the copy and confirm renames + index + a served HTML resolve. `npx tsc --noEmit` clean.**

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-serial-prefix.ts package.json tests/scripts/backfill-serial-prefix.test.ts
git commit -m "feat(serial): dry-run-default backfill CLI (Phase A + Phase B)"
```

---

## Self-Review

**Spec coverage** (spec §-by-§):
- §3 data model → Task 1. §4 filename format → Task 2 (+ used in 4, 8). §5.1 ingest → Task 4. §5.2 backfill order → Task 3. §5.3 monotonic/no-reuse → Task 3 (`nextSerial` over all incl archived) + §5.3 orphan adoption → Task 5. §6 Phase A → Task 9; Phase B (guard, archived, per-video write) → Task 10; planner → Task 8; stripper removal → Task 6. §7 references (meta/envelope) → Task 7 (helpers) + Task 10 (applied); Obsidian/dig-name/serve-route need no code (index-derived). §9 testing → each task's tests + Task 11 smoke. §10 O-1/O-2 → format in Task 2 / provenance in Tasks 7+10.
- **Gap check (resolved):** the earlier dig-deeper-provenance worry was a non-issue — `digDeeperHtml` is never persisted, and the dig-deeper renderer receives the summary `mdPath`, so `source-md` is already correct (review M1). No extra task needed.

**Placeholder scan:** No "TBD"/"handle edge cases" — each step has concrete code or an exact command. Integration tests (Tasks 4, 10) reference the existing test harness ("reuse the file's temp-folder + mock setup") rather than reproducing it — acceptable since those harnesses already exist in `pipeline.test.ts`/repo.

**Type consistency:** `serialNumber?: number` (Task 1) used consistently; `applySerial(relPath, serial)` signature stable across Tasks 2/4/8; `RenameOp`/`VideoPlan` defined in Task 8 and consumed in 9/10; `runPhaseA`/`runPhaseB` signatures stable across 9/10/11.

---

## Execution Handoff

After plan approval, this plan is executed via **superpowers:subagent-driven-development** (the project default — see `docs/dev-process.md`): a fresh subagent per task with Claude + adversarial review between tasks. Per the Post-Plan Gate (`docs/dev-process.md`): run a Codex (or Claude-fallback) adversarial review of THIS plan and save to `docs/reviews/plan-serial-number-filename-prefix-*.md` before dispatching Task 1.
