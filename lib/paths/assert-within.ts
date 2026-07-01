import path from 'path';

/**
 * Resolve an index-derived relative path against outputFolder and assert containment.
 *
 * Throws `Object.assign(new Error(...), { statusCode: 400 })` if the resolved path escapes
 * outputFolder, or (when `allowedExt` is given, e.g. `'.md'`) the extension differs.
 * Returns the resolved absolute path on success.
 *
 * Use this before every read of an index-supplied relative path (summaryMd, digDeeperMd,
 * models/*.json, etc.) so a crafted index field cannot reach files outside the output folder.
 */
export function assertIndexRelPathWithin(outputFolder: string, rel: string, allowedExt?: string): string {
  const root = path.resolve(outputFolder);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error(`path outside output folder: ${rel}`), { statusCode: 400 });
  }
  if (allowedExt && path.extname(abs).toLowerCase() !== allowedExt.toLowerCase()) {
    throw Object.assign(new Error(`unexpected extension for ${rel}`), { statusCode: 400 });
  }
  return abs;
}
