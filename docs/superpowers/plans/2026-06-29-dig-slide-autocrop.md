# Dig Slide Vertical Auto-Crop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim the dead vertical band above each dark-themed slide's heading (and the near-black band below its lowest content) at render time, as a non-destructive CSS display-crop, with the lightbox always showing the full original.

**Architecture:** A pure `computeTrim` over two ffmpeg row-brightness profiles (top@120 anchors the bright heading, bottom@40 trims only near-black so dim content incl. footer survives). An async `prepareSlideCropMap` runs in the API route (`renderDigDeeperDoc` stays synchronous) and passes a `Map<absPath, CropBox|null>` into the renderer, whose image rule emits a `<figure>` cover-crop wrapper. Results are cached in a per-deck sidecar keyed by file size+mtime+algoVersion.

**Tech Stack:** TypeScript, Next.js (existing), markdown-it, ffmpeg/ffprobe CLIs (already required), Jest+ts-jest, Playwright.

**Design spec:** `docs/superpowers/specs/2026-06-28-dig-slide-autocrop-design.md`
**Adversarial review (addressed):** `docs/reviews/spec-dig-slide-autocrop-codex.md`

## Global Constraints

- **No new npm dependency.** Use the `ffmpeg`/`ffprobe` CLIs via `node:child_process` (project pattern; jimp/sharp deliberately absent).
- **Render-only.** No `DIG_GENERATOR_VERSION` / `doc-version` bump, no re-dig, no asset mutation.
- **Non-destructive.** Crop is CSS display-only; the lightbox `<img>` must have no `.dig-slide-crop` ancestor and carry the original data URI.
- **Fail-closed.** Any detection error (ffmpeg/ffprobe failure, length mismatch, malformed cache) → `null` (uncropped render). A crop failure must never throw out of the render path.
- **Spike-locked constants:** `THR_TOP=120`, `THR_BOT=40`, `CONTENT_FRAC=0.004`, `PAD_FRAC=0.015`, `MIN_RETAIN=0.30`, `MIN_TRIM=0.04`, `ALGO_VERSION=1`. `DIG_CROP` env defaults ON; `DIG_CROP=off` disables.
- **Tests:** mock the ffmpeg boundary in unit tests; no real CLI calls except the one Task-2 fixture integration test.

---

### Task 1: `computeTrim` pure function + types + constants

**Files:**
- Create: `lib/dig/slide-crop.ts`
- Test: `lib/dig/slide-crop.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface CropBox { trimTop: number; trimBot: number }` (fractions of height, ∈ [0,1))
  - `export interface ComputeOpts { contentFrac?: number; padFrac?: number; minRetain?: number; minTrim?: number }`
  - `export function computeTrim(topProfile: number[], botProfile: number[], opts?: ComputeOpts): CropBox | null`
  - `export const ALGO_VERSION = 1`
  - threshold constants `THR_TOP`, `THR_BOT`, and the defaults above.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dig/slide-crop.test.ts
import { computeTrim } from './slide-crop';

// Helper: build a height-H profile where rows in [from,to) have the given fraction.
const prof = (H: number, bands: Array<[number, number, number]>): number[] => {
  const a = new Array(H).fill(0);
  for (const [from, to, frac] of bands) for (let i = from; i < to; i++) a[i] = frac;
  return a;
};

describe('computeTrim', () => {
  const H = 720;

  it('letterboxed bright-heading slide → trims top dead band, keeps content+footer', () => {
    // heading rows 200-230 bright (top@120); content+footer down to row 690 (bottom@40)
    const top = prof(H, [[200, 230, 0.1], [300, 460, 0.2]]);
    const bot = prof(H, [[200, 690, 0.2]]);
    const box = computeTrim(top, bot)!;
    expect(box).not.toBeNull();
    expect(box.trimTop).toBeGreaterThan(0.2);   // ~28% above heading removed
    expect(box.trimTop).toBeLessThan(0.3);
    expect(box.trimBot).toBeLessThan(0.06);      // only near-black below footer
  });

  it('all-dim slide (nothing above THR_TOP) → null', () => {
    const top = prof(H, []);                      // no bright rows
    const bot = prof(H, [[100, 600, 0.2]]);
    expect(computeTrim(top, bot)).toBeNull();
  });

  it('retained band below MIN_RETAIN → null', () => {
    const top = prof(H, [[350, 360, 0.1]]);       // single thin band
    const bot = prof(H, [[350, 360, 0.1]]);       // keep ≈ (10+pad)/720 < 0.30
    expect(computeTrim(top, bot)).toBeNull();
  });

  it('total trim below MIN_TRIM → null', () => {
    const top = prof(H, [[5, 715, 0.2]]);         // content fills frame
    const bot = prof(H, [[5, 715, 0.2]]);
    expect(computeTrim(top, bot)).toBeNull();
  });

  it('REGRESSION (160-214-222): dim card content below last bright row is NOT cut', () => {
    // bright card titles end at row 430; dim descriptions extend to 470 (only in bottom@40 profile)
    const top = prof(H, [[180, 210, 0.1], [300, 430, 0.2]]);
    const bot = prof(H, [[180, 470, 0.2], [660, 695, 0.05]]); // ...incl. footer band
    const box = computeTrim(top, bot)!;
    // bottom anchored on the footer (row ~695), so descriptions (≤470) are safely inside the kept band
    expect((1 - box.trimBot) * H).toBeGreaterThan(470);
  });

  it('mismatched profile lengths → null', () => {
    expect(computeTrim([0, 0, 0], [0, 0])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest slide-crop -t computeTrim`
Expected: FAIL — "Cannot find module './slide-crop'" / `computeTrim is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/dig/slide-crop.ts
export interface CropBox { trimTop: number; trimBot: number }
export interface ComputeOpts { contentFrac?: number; padFrac?: number; minRetain?: number; minTrim?: number }

export const ALGO_VERSION = 1;
export const THR_TOP = 120;            // anchor on the bright heading
export const THR_BOT = 40;             // trim only near-pure-black
const CONTENT_FRAC = 0.004;            // row is "content" if >0.4% of pixels bright
const PAD_FRAC = 0.015;                // padding above/below the content band
const MIN_RETAIN = 0.30;               // kept band < 30% of H → no-op
const MIN_TRIM = 0.04;                 // total trim < 4% → no-op

/**
 * Derive a vertical trim box from two per-row bright-fraction profiles.
 * `topProfile` (high threshold) locates the first bright row; `botProfile`
 * (low threshold) locates the last non-black row, so dim content/footer survive.
 * Returns trim fractions of height, or null (no-op) when uncertain.
 */
export function computeTrim(
  topProfile: number[],
  botProfile: number[],
  opts: ComputeOpts = {},
): CropBox | null {
  const contentFrac = opts.contentFrac ?? CONTENT_FRAC;
  const padFrac = opts.padFrac ?? PAD_FRAC;
  const minRetain = opts.minRetain ?? MIN_RETAIN;
  const minTrim = opts.minTrim ?? MIN_TRIM;

  const H = topProfile.length;
  if (H === 0 || botProfile.length !== H) return null;

  let t = topProfile.findIndex((f) => f > contentFrac);
  if (t < 0) return null;                                   // nothing bright → no-op

  let b = -1;
  for (let i = H - 1; i >= 0; i--) { if (botProfile[i] > contentFrac) { b = i; break; } }
  if (b < 0) return null;

  const pad = Math.round(padFrac * H);
  t = Math.max(0, t - pad);
  b = Math.min(H - 1, b + pad);

  const keepH = b - t + 1;
  if (keepH / H < minRetain) return null;                   // suspect → no-op

  const trimTop = t / H;
  const trimBot = (H - 1 - b) / H;
  if (trimTop + trimBot < minTrim) return null;             // not worth it → no-op

  return { trimTop, trimBot };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest slide-crop -t computeTrim`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/slide-crop.ts lib/dig/slide-crop.test.ts
git commit -m "feat(dig): computeTrim pure vertical-crop logic (TDD)"
```

---

### Task 2: ffmpeg/ffprobe wrappers + `resolveCropBox` (fail-closed)

**Files:**
- Modify: `lib/dig/slide-crop.ts` (append wrappers)
- Test: `lib/dig/slide-crop.integration.test.ts` (new — real ffmpeg, one committed fixture)
- Create fixture: `lib/dig/__fixtures__/letterbox.png` (generated in Step 1)

**Interfaces:**
- Consumes: `computeTrim`, `THR_TOP`, `THR_BOT` (Task 1).
- Produces:
  - `export async function imageHeight(assetPath: string): Promise<number>`
  - `export async function profileRows(assetPath: string, threshold: number): Promise<number[]>`
  - `export async function resolveCropBox(assetPath: string): Promise<CropBox | null>`

- [ ] **Step 1: Create a real fixture image**

Run (generates a 1280×720 image: black top band, a white bar mid-top, gray content block, black bottom):
```bash
mkdir -p lib/dig/__fixtures__
ffmpeg -y -f lavfi -i color=c=black:s=1280x720 \
  -vf "drawbox=x=300:y=200:w=680:h=20:color=white:t=fill,drawbox=x=300:y=300:w=680:h=160:color=gray:t=fill" \
  -frames:v 1 lib/dig/__fixtures__/letterbox.png
```

- [ ] **Step 2: Write the failing integration test**

```ts
// lib/dig/slide-crop.integration.test.ts
import path from 'node:path';
import { imageHeight, profileRows, resolveCropBox, THR_TOP } from './slide-crop';

const FIX = path.join(__dirname, '__fixtures__', 'letterbox.png');

describe('ffmpeg profile (integration — real ffmpeg)', () => {
  it('imageHeight returns 720', async () => {
    expect(await imageHeight(FIX)).toBe(720);
  });

  it('profileRows length === height and separates the white bar from black bands', async () => {
    const rows = await profileRows(FIX, THR_TOP);
    expect(rows.length).toBe(720);
    expect(rows[0]).toBe(0);                          // black top
    expect(Math.max(...rows.slice(200, 220))).toBeGreaterThan(0); // white bar registers
  });

  it('resolveCropBox crops the dead top/bottom bands of the fixture', async () => {
    const box = await resolveCropBox(FIX);
    expect(box).not.toBeNull();
    expect(box!.trimTop).toBeGreaterThan(0.1);
  });

  it('resolveCropBox returns null on a missing/garbage path (fail-closed)', async () => {
    expect(await resolveCropBox('/no/such/file.png')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest slide-crop.integration`
Expected: FAIL — `imageHeight is not a function`.

- [ ] **Step 4: Implement the wrappers**

```ts
// append to lib/dig/slide-crop.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Image height in pixels via ffprobe. Throws on failure (callers fail closed). */
export async function imageHeight(assetPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=height', '-of', 'csv=p=0', assetPath,
  ]);
  const h = parseInt(String(stdout).trim(), 10);
  if (!Number.isFinite(h) || h <= 0) throw new Error(`imageHeight: bad output "${stdout}"`);
  return h;
}

/** Per-row fraction (0..1) of pixels brighter than `threshold`, length = image height. */
export async function profileRows(assetPath: string, threshold: number): Promise<number[]> {
  const vf =
    `format=gray,geq=lum='if(gte(lum(X\\,Y)\\,${threshold})\\,255\\,0)',scale=1:ih:flags=area`;
  const { stdout } = await execFileAsync('ffmpeg', [
    '-v', 'error', '-i', assetPath, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ], { encoding: 'buffer', maxBuffer: 1 << 24 });
  return Array.from(stdout as Buffer).map((v) => v / 255);
}

/** Resolve a crop box for one asset. Fail-closed: any error or length mismatch → null. */
export async function resolveCropBox(assetPath: string): Promise<CropBox | null> {
  let h: number;
  try { h = await imageHeight(assetPath); } catch { return null; }
  let top: number[];
  let bot: number[];
  try {
    [top, bot] = await Promise.all([
      profileRows(assetPath, THR_TOP),
      profileRows(assetPath, THR_BOT),
    ]);
  } catch { return null; }
  if (top.length !== h || bot.length !== h) return null;     // M1: fail closed on mismatch
  return computeTrim(top, bot);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest slide-crop.integration`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/dig/slide-crop.ts lib/dig/slide-crop.integration.test.ts lib/dig/__fixtures__/letterbox.png
git commit -m "feat(dig): ffmpeg row-profile wrappers + resolveCropBox (fail-closed)"
```

---

### Task 3: Sidecar cache (`lookupOrComputeBox`) — size+mtime key, atomic write, per-path mutex

**Files:**
- Create: `lib/dig/slide-crop-cache.ts`
- Test: `lib/dig/slide-crop-cache.test.ts`

**Interfaces:**
- Consumes: `CropBox`, `ALGO_VERSION`, `resolveCropBox` (Tasks 1–2).
- Produces:
  - `export type CropResult = CropBox | null | 'missing'`
  - `export async function lookupOrComputeBox(assetPath: string, resolve?: (p: string) => Promise<CropBox | null>): Promise<CropResult>` (the optional `resolve` param exists for test injection; defaults to `resolveCropBox`).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dig/slide-crop-cache.test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { lookupOrComputeBox } from './slide-crop-cache';

const mkAsset = (dir: string, name: string, bytes = 'x') => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
};

describe('lookupOrComputeBox', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crop-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('computes once, then serves from cache (resolve called once)', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg');
    const resolve = jest.fn().mockResolvedValue({ trimTop: 0.2, trimBot: 0.05 });
    const a = await lookupOrComputeBox(asset, resolve);
    const b = await lookupOrComputeBox(asset, resolve);
    expect(a).toEqual({ trimTop: 0.2, trimBot: 0.05 });
    expect(b).toEqual(a);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(dir, '.crop-cache.json'))).toBe(true);
  });

  it('recomputes when the file changes under the same name (H1 guard)', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg', 'aaa');
    const resolve = jest.fn()
      .mockResolvedValueOnce({ trimTop: 0.2, trimBot: 0.05 })
      .mockResolvedValueOnce({ trimTop: 0.3, trimBot: 0.06 });
    await lookupOrComputeBox(asset, resolve);
    fs.writeFileSync(asset, 'bbbbbb');                // size+mtime change
    const second = await lookupOrComputeBox(asset, resolve);
    expect(second).toEqual({ trimTop: 0.3, trimBot: 0.06 });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('caches a null (no-op) result so it is not recomputed', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg');
    const resolve = jest.fn().mockResolvedValue(null);
    await lookupOrComputeBox(asset, resolve);
    await lookupOrComputeBox(asset, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('returns "missing" for an absent file and does NOT write a cache entry (M3)', async () => {
    const resolve = jest.fn();
    const r = await lookupOrComputeBox(path.join(dir, 'gone.jpg'), resolve);
    expect(r).toBe('missing');
    expect(resolve).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, '.crop-cache.json'))).toBe(false);
  });

  it('rebuilds on malformed cache JSON instead of throwing', async () => {
    const asset = mkAsset(dir, '0-1-2.jpg');
    fs.writeFileSync(path.join(dir, '.crop-cache.json'), '{ not json');
    const resolve = jest.fn().mockResolvedValue({ trimTop: 0.2, trimBot: 0.05 });
    const r = await lookupOrComputeBox(asset, resolve);
    expect(r).toEqual({ trimTop: 0.2, trimBot: 0.05 });
  });

  it('serializes concurrent writes without losing entries', async () => {
    const a1 = mkAsset(dir, '0-1-2.jpg');
    const a2 = mkAsset(dir, '0-3-4.jpg');
    const resolve = jest.fn().mockResolvedValue({ trimTop: 0.2, trimBot: 0.05 });
    await Promise.all([lookupOrComputeBox(a1, resolve), lookupOrComputeBox(a2, resolve)]);
    const cache = JSON.parse(fs.readFileSync(path.join(dir, '.crop-cache.json'), 'utf8'));
    expect(Object.keys(cache).sort()).toEqual(['0-1-2.jpg', '0-3-4.jpg']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest slide-crop-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the cache**

```ts
// lib/dig/slide-crop-cache.ts
import fs from 'node:fs';
import path from 'node:path';
import { ALGO_VERSION, resolveCropBox, type CropBox } from './slide-crop';

export type CropResult = CropBox | null | 'missing';

interface CacheEntry { algoVersion: number; size: number; mtimeMs: number; box: CropBox | null }
type CacheFile = Record<string, CacheEntry>;

// Per-cache-file promise chain → serialize read-modify-write within this process.
const writeChains = new Map<string, Promise<void>>();

const cachePath = (assetDir: string) => path.join(assetDir, '.crop-cache.json');

function readCache(cf: string): CacheFile {
  try { return JSON.parse(fs.readFileSync(cf, 'utf8')) as CacheFile; }
  catch { return {}; }                                   // missing OR malformed → rebuild
}

function writeEntry(cf: string, name: string, entry: CacheEntry): Promise<void> {
  const prev = writeChains.get(cf) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => {
    const cache = readCache(cf);
    cache[name] = entry;
    const tmp = `${cf}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, cf);                            // atomic commit
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      console.warn('[dig-crop-cache] write failed:', (e as Error).message);
    }
  });
  writeChains.set(cf, next);
  return next;
}

/**
 * Resolve a crop box for `assetPath`, memoized in the per-deck sidecar cache.
 * Returns 'missing' when the file is absent (caller renders a placeholder).
 * `resolve` is injectable for tests; defaults to resolveCropBox.
 */
export async function lookupOrComputeBox(
  assetPath: string,
  resolve: (p: string) => Promise<CropBox | null> = resolveCropBox,
): Promise<CropResult> {
  let st: fs.Stats;
  try { st = fs.statSync(assetPath); } catch { return 'missing'; }

  const dir = path.dirname(assetPath);
  const name = path.basename(assetPath);
  const cf = cachePath(dir);

  const hit = readCache(cf)[name];
  if (hit && hit.algoVersion === ALGO_VERSION && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
    return hit.box;
  }

  const box = await resolve(assetPath);
  await writeEntry(cf, name, { algoVersion: ALGO_VERSION, size: st.size, mtimeMs: st.mtimeMs, box });
  return box;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest slide-crop-cache`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/slide-crop-cache.ts lib/dig/slide-crop-cache.test.ts
git commit -m "feat(dig): slide-crop sidecar cache (size+mtime key, atomic, serialized)"
```

---

### Task 4: `prepareSlideCropMap` — collect asset refs (markdown-it tokens), dedupe, resolve

**Files:**
- Create: `lib/dig/slide-crop-map.ts`
- Test: `lib/dig/slide-crop-map.test.ts`

**Interfaces:**
- Consumes: `lookupOrComputeBox`/`CropResult` (Task 3), `CropBox` (Task 1), `DugSection` (`lib/dig/companion-doc`, has `bodyMarkdown: string`).
- Produces: `export async function prepareSlideCropMap(dug: DugSection[], mdPath: string, lookup?: (p: string) => Promise<CropResult>): Promise<Map<string, CropBox | null>>` (map key = resolved absolute asset path; missing files are omitted; `lookup` injectable for tests).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/dig/slide-crop-map.test.ts
import path from 'node:path';
import { prepareSlideCropMap } from './slide-crop-map';
import type { DugSection } from './companion-doc';

const mdPath = '/data/deck/raw/275_x-dig-deeper.md';
const docDir = path.dirname(mdPath);
const sec = (bodyMarkdown: string): DugSection =>
  ({ sectionId: 0, title: 't', genVersion: 8, bodyMarkdown } as unknown as DugSection);

describe('prepareSlideCropMap', () => {
  it('collects assets/ refs, resolves to abs paths, dedupes', async () => {
    const dug = [
      sec('text ![a](assets/v/0-1-2.jpg) more ![dup](assets/v/0-1-2.jpg)'),
      sec('![b](assets/v/0-3-4.jpg)'),
    ];
    const lookup = jest.fn().mockResolvedValue({ trimTop: 0.2, trimBot: 0.05 });
    const map = await prepareSlideCropMap(dug, mdPath, lookup);
    expect(new Set(map.keys())).toEqual(new Set([
      path.resolve(docDir, 'assets/v/0-1-2.jpg'),
      path.resolve(docDir, 'assets/v/0-3-4.jpg'),
    ]));
    expect(lookup).toHaveBeenCalledTimes(2);              // dedup → 2, not 3
  });

  it('ignores external URLs and path-traversal refs', async () => {
    const dug = [sec('![x](https://e.com/i.png) ![bad](assets/../../etc/passwd)')];
    const lookup = jest.fn().mockResolvedValue(null);
    const map = await prepareSlideCropMap(dug, mdPath, lookup);
    expect(map.size).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('omits missing assets from the map (render falls back to placeholder)', async () => {
    const dug = [sec('![m](assets/v/gone.jpg)')];
    const lookup = jest.fn().mockResolvedValue('missing');
    const map = await prepareSlideCropMap(dug, mdPath, lookup);
    expect(map.size).toBe(0);
  });

  it('returns an empty map when DIG_CROP=off', async () => {
    const prev = process.env.DIG_CROP;
    process.env.DIG_CROP = 'off';
    try {
      const lookup = jest.fn().mockResolvedValue({ trimTop: 0.2, trimBot: 0.05 });
      const map = await prepareSlideCropMap([sec('![a](assets/v/0-1-2.jpg)')], mdPath, lookup);
      expect(map.size).toBe(0);
      expect(lookup).not.toHaveBeenCalled();
    } finally { process.env.DIG_CROP = prev; }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest slide-crop-map`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/dig/slide-crop-map.ts
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type { DugSection } from './companion-doc';
import { lookupOrComputeBox, type CropResult } from './slide-crop-cache';
import type { CropBox } from './slide-crop';

/** Recursively collect every image `src` from a markdown-it token tree. */
function collectImageSrcs(tokens: Token[], out: string[] = []): string[] {
  for (const tok of tokens) {
    if (tok.type === 'image') {
      const src = tok.attrGet('src');
      if (src) out.push(src);
    }
    if (tok.children) collectImageSrcs(tok.children, out);
  }
  return out;
}

/**
 * Build the render-time crop map for a dig-deeper doc. Mirrors the renderer's
 * inlining rule: only `assets/…` refs that resolve inside `<docDir>/assets`.
 * Map key = resolved absolute path; value = CropBox | null. Missing files are
 * omitted (renderer shows its placeholder). Empty map when DIG_CROP=off.
 */
export async function prepareSlideCropMap(
  dug: DugSection[],
  mdPath: string,
  lookup: (p: string) => Promise<CropResult> = lookupOrComputeBox,
): Promise<Map<string, CropBox | null>> {
  const map = new Map<string, CropBox | null>();
  if (process.env.DIG_CROP === 'off') return map;

  const docDir = path.dirname(mdPath);
  const assetsRoot = path.resolve(docDir, 'assets');
  const md = new MarkdownIt({ html: false });

  const absPaths = new Set<string>();
  for (const section of dug) {
    for (const src of collectImageSrcs(md.parse(section.bodyMarkdown ?? '', {}))) {
      if (!src.startsWith('assets/')) continue;
      const abs = path.resolve(docDir, src);
      if (!abs.startsWith(assetsRoot + path.sep)) continue;   // containment (matches renderer)
      absPaths.add(abs);
    }
  }

  await Promise.all([...absPaths].map(async (abs) => {
    const r = await lookup(abs);
    if (r !== 'missing') map.set(abs, r);
  }));
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest slide-crop-map`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/dig/slide-crop-map.ts lib/dig/slide-crop-map.test.ts
git commit -m "feat(dig): prepareSlideCropMap — token-walk asset refs → crop map"
```

---

### Task 5: Render integration — `<figure>` cover-crop wrapper + CSS + route wiring

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (`buildRenderer` signature + image rule ~94-126; CSS ~135; `renderDigDeeperDoc` signature ~172-181)
- Modify: `app/api/html/[id]/route.ts:195` (await `prepareSlideCropMap`, pass `cropMap`)
- Test: `lib/html-doc/render-dig-deeper.crop.test.ts` (new)

**Interfaces:**
- Consumes: `prepareSlideCropMap` (Task 4), `CropBox` (Task 1).
- Produces: `renderDigDeeperDoc(args)` gains required field `cropMap: Map<string, CropBox | null>`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/html-doc/render-dig-deeper.crop.test.ts
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { renderDigDeeperDoc } from './render-dig-deeper';
import type { CropBox } from '../dig/slide-crop';

// Minimal harness: a doc dir with one real asset the renderer can inline.
function makeDoc(): { mdPath: string; assetAbs: string; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digdoc-'));
  fs.mkdirSync(path.join(dir, 'assets', 'v'), { recursive: true });
  const assetAbs = path.join(dir, 'assets', 'v', '0-1-2.jpg');
  fs.writeFileSync(assetAbs, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // tiny fake jpeg bytes
  return { mdPath: path.join(dir, 'x-dig-deeper.md'), assetAbs, dir };
}

const baseArgs = (mdPath: string, cropMap: Map<string, CropBox | null>) => ({
  summary: { title: 'T', sections: [] } as any,
  envelope: null,
  dug: [{ sectionId: 0, title: 'S', genVersion: 8, bodyMarkdown: '![a](assets/v/0-1-2.jpg)' }] as any,
  mdPath, videoId: 'v', language: 'en' as const, cropMap,
});

describe('renderDigDeeperDoc crop wrapper', () => {
  it('wraps a slide with a crop box in <figure class="dig-slide-crop"> with aspect-ratio + object-position', () => {
    const { mdPath, assetAbs } = makeDoc();
    const cropMap = new Map<string, CropBox | null>([[assetAbs, { trimTop: 0.25, trimBot: 0.05 }]]);
    const html = renderDigDeeperDoc(baseArgs(mdPath, cropMap));
    expect(html).toContain('class="dig-slide-crop"');
    expect(html).toMatch(/aspect-ratio:\s*\d/);
    // P% = 0.25/(0.25+0.05)*100 = 83.33
    expect(html).toMatch(/object-position:\s*0 83\.3/);
    expect(html).toContain('<img class="dig-slide"');
  });

  it('renders a plain dig-slide img (no wrapper) when the box is null or absent', () => {
    const { mdPath, assetAbs } = makeDoc();
    const cropMap = new Map<string, CropBox | null>([[assetAbs, null]]);
    const html = renderDigDeeperDoc(baseArgs(mdPath, cropMap));
    expect(html).not.toContain('dig-slide-crop');
    expect(html).toContain('<img class="dig-slide"');
  });

  it('includes the .dig-slide-crop CSS contract that overrides the bare img cap', () => {
    const { mdPath, assetAbs } = makeDoc();
    const html = renderDigDeeperDoc(baseArgs(mdPath, new Map([[assetAbs, { trimTop: 0.25, trimBot: 0.05 }]])));
    expect(html).toContain('.dig-slide-crop');
    expect(html).toMatch(/\.dig-slide-crop\s*>\s*img\.dig-slide\{[^}]*object-fit:cover/);
    expect(html).toMatch(/\.dig-slide-crop\s*>\s*img\.dig-slide\{[^}]*max-height:none/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest render-dig-deeper.crop`
Expected: FAIL — `cropMap` not used; no `dig-slide-crop` in output (and a TS error until the arg type is added).

- [ ] **Step 3: Thread `cropMap` into `buildRenderer` and emit the wrapper**

In `lib/html-doc/render-dig-deeper.ts`:

(a) Change `buildRenderer` to accept the map:
```ts
function buildRenderer(mdPath: string, cropMap: Map<string, import('../dig/slide-crop').CropBox | null>): MarkdownIt {
```

(b) Replace the success `return` of the image rule (currently line 119) — keep the containment check (line 109) and the missing-file placeholder (line 116) exactly as they are:
```ts
      const b64 = data.toString('base64');
      const box = cropMap.get(absPath) ?? null;
      if (box) {
        const keepFrac = 1 - box.trimTop - box.trimBot;
        const posPct = (box.trimTop / (box.trimTop + box.trimBot)) * 100;
        // aspect-ratio uses a unit width (1) : kept-height ratio; object-position selects the band.
        const ar = `1 / ${keepFrac.toFixed(4)}`;
        return `<figure class="dig-slide-crop" style="aspect-ratio:${ar}">` +
               `<img class="dig-slide" style="object-position:0 ${posPct.toFixed(1)}%" ` +
               `src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}"></figure>`;
      }
      return `<img class="dig-slide" src="data:image/jpeg;base64,${b64}" alt="${esc(altAttr)}">`;
```

(c) Update the call site (line 181) `const renderer = buildRenderer(mdPath);` →
```ts
  const renderer = buildRenderer(mdPath, cropMap);
```

(d) Add `cropMap` to the args type + destructure (lines 172-180):
```ts
export function renderDigDeeperDoc(args: {
  summary: ParsedSummary;
  envelope: ModelEnvelope | null;
  dug: DugSection[];
  mdPath: string;
  videoId: string;
  language?: 'en' | 'ko';
  cropMap: Map<string, import('../dig/slide-crop').CropBox | null>;
}): string {
  const { summary, envelope, dug, mdPath, videoId, language = 'en', cropMap } = args;
```

- [ ] **Step 4: Add the CSS contract**

In the `DIG_DOC_CSS` template (after line 135, the existing `.dg img.dig-slide` rule), add:
```ts
.dg figure.dig-slide-crop{display:block;overflow:hidden;margin:2em auto;max-width:100%;width:min(100%,640px);border:1px solid var(--rule);border-radius:6px;cursor:zoom-in}
.dg figure.dig-slide-crop>img.dig-slide{display:block;width:100%;height:100%;max-height:none;margin:0;border:0;border-radius:0;object-fit:cover;cursor:zoom-in}
```

- [ ] **Step 5: Wire the route**

In `app/api/html/[id]/route.ts` — add the import and build the map before render. Replace line 195:
```ts
import { prepareSlideCropMap } from '../../../../lib/dig/slide-crop-map';
// …
    const cropMap = await prepareSlideCropMap(dug, summaryMdPath);
    return serveHtml(renderDigDeeperDoc({ summary: parsed, envelope, dug, mdPath: summaryMdPath, videoId, language: video.language, cropMap }));
```
(`summaryMdPath` is the existing `mdPath` already passed to the renderer at line 195.)

- [ ] **Step 6: Run the crop tests + the existing dig-deeper suite**

Run: `npx jest render-dig-deeper`
Expected: PASS — new crop tests green; pre-existing render-dig-deeper tests still green (they must now pass `cropMap: new Map()` — update those call sites if the suite constructs args directly).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (jest uses SWC and won't catch type breaks — tsc is the real gate).

- [ ] **Step 8: Commit**

```bash
git add lib/html-doc/render-dig-deeper.ts lib/html-doc/render-dig-deeper.crop.test.ts app/api/html/[id]/route.ts
git commit -m "feat(dig): emit non-destructive CSS crop wrapper; wire prepareSlideCropMap in route"
```

---

### Task 6: E2E — cropped in flow, full original on zoom (L1)

**Files:**
- Create/Modify: `e2e/dig-slide-crop.spec.ts` (new Playwright spec; follow the existing dig E2E fixture pattern in `e2e/`)

**Interfaces:**
- Consumes: the running app + a fixture companion doc with one letterboxed slide (crop box) and one slide whose detection is `null`.

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/dig-slide-crop.spec.ts
import { test, expect } from '@playwright/test';
// Reuse the project's existing dig-deeper fixture harness (see sibling specs in e2e/).
// Assumes a served dig-deeper doc at the fixture route with at least one cropped slide.

test('cropped slide shows a crop wrapper in flow', async ({ page }) => {
  await page.goto('/api/html/<FIXTURE_ID>?type=dig-deeper&outputFolder=<FIXTURE_FOLDER>');
  const fig = page.locator('figure.dig-slide-crop').first();
  await expect(fig).toBeVisible();
  await expect(fig).toHaveCSS('overflow', 'hidden');
  const img = fig.locator('img.dig-slide');
  await expect(img).toHaveCSS('object-fit', 'cover');
});

test('clicking a cropped slide opens the lightbox with the FULL uncropped original (L1)', async ({ page }) => {
  await page.goto('/api/html/<FIXTURE_ID>?type=dig-deeper&outputFolder=<FIXTURE_FOLDER>');
  const inFlow = page.locator('figure.dig-slide-crop img.dig-slide').first();
  const src = await inFlow.getAttribute('src');
  await inFlow.click();
  const zoom = page.locator('.dg-zoom[data-open] img');
  await expect(zoom).toBeVisible();
  // same data URI, and NOT inside a crop wrapper
  await expect(zoom).toHaveAttribute('src', src!);
  expect(await zoom.evaluate((el) => !!el.closest('.dig-slide-crop'))).toBe(false);
});
```

- [ ] **Step 2: Fill in the fixture id/folder**

Replace `<FIXTURE_ID>`/`<FIXTURE_FOLDER>` using the same fixture-doc setup the existing dig E2E specs use (grep `e2e/` for `type=dig-deeper`). The fixture's companion `.md` must reference one letterboxed slide (produces a crop box) and one full-bleed/null slide.

- [ ] **Step 3: Run the E2E spec**

Run: `npx playwright test dig-slide-crop`
Expected: PASS (2 tests).

- [ ] **Step 4: Full suite + typecheck before final commit**

Run: `npm test && npx tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 5: Commit**

```bash
git add e2e/dig-slide-crop.spec.ts
git commit -m "test(dig): E2E — crop wrapper in flow + full original on zoom (L1)"
```

---

## Self-Review

**Spec coverage:**
- §Architecture units 1/2/3 → Tasks 1, 2, 5. ✓
- §Detection params (120/40, fracs, ALGO_VERSION) → Task 1 constants. ✓
- §Caching (size+mtime key H1, atomic+mutex H2, missing≠no-op M3) → Task 3. ✓
- §Render integration (async prepareSlideCropMap B2, token walk M2, figure/CSS B1, alt L3) → Tasks 4, 5. ✓
- §Eligibility/`DIG_CROP` default ON, `off` kill switch → Task 4 (env gate) + Global Constraints. ✓
- §Error handling (fail-closed M1) → Task 2 (`resolveCropBox`, length validation). ✓
- §Testing table incl. 160-214-222 regression + L1 + adversarial fixtures → Tasks 1, 5, 6. (Light/photo *visual* fixtures from spike are documented; profile-level coverage is in Task 1.)

**Placeholder scan:** No TBD/TODO; every code step shows full code. E2E fixture ids are explicit placeholders the implementer fills from the existing harness (Step 2 says how) — unavoidable without the live fixture, and called out.

**Type consistency:** `CropBox {trimTop,trimBot}` used identically in Tasks 1/2/3/4/5. `CropResult = CropBox|null|'missing'` (Task 3) consumed by Task 4. `computeTrim`, `profileRows`, `imageHeight`, `resolveCropBox`, `lookupOrComputeBox`, `prepareSlideCropMap` signatures match across producer/consumer blocks. `cropMap` arg type identical in renderer + route.
