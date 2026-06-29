// lib/dig/slide-crop-cache.ts
import fs from 'node:fs';
import path from 'node:path';
import { ALGO_VERSION, resolveCropBox, type CropBox } from './slide-crop';

export type CropResult = CropBox | null | 'missing';

interface CacheEntry { algoVersion: number; size: number; mtimeMs: number; box: CropBox | null }
type CacheFile = Record<string, CacheEntry>;

const writeChains = new Map<string, Promise<void>>();   // per-cache-file serialization
const cachePath = (assetDir: string) => path.join(assetDir, '.crop-cache.json');

function readCache(cf: string): CacheFile {
  try { return JSON.parse(fs.readFileSync(cf, 'utf8')) as CacheFile; }
  catch { return {}; }                                  // missing OR malformed → rebuild
}

function writeEntry(cf: string, name: string, entry: CacheEntry): Promise<void> {
  const prev = writeChains.get(cf) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => {
    const cache = readCache(cf);
    cache[name] = entry;
    const tmp = `${cf}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, cf);                           // atomic commit
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      console.warn('[dig-crop-cache] write failed:', (e as Error).message);
    }
  });
  writeChains.set(cf, next);
  return next;
}

/**
 * Resolve a crop box for `assetPath`, memoized in the per-deck sidecar.
 * 'missing' when the file is absent (caller renders a placeholder).
 * `resolve` injectable for tests; defaults to resolveCropBox.
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
