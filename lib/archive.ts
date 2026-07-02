import fs from 'fs';
import path from 'path';
import { assertVideoId } from './index-store';
import { getPrincipal, getMetadataStore } from '@/lib/storage/resolve';
import type { MetadataStore } from '@/lib/storage/metadata-store';
import type { Principal } from '@/lib/storage/principal';

const ARCHIVE_DIR = 'archived';

type FilePair = { root: string; archived: string };

// Resolve actual on-disk paths from the video's index entry.
// Files are named with title slugs (not videoId).
// Returns only paths that are safely within outputFolder (path traversal guard).
function getFilePairs(principal: Principal, store: MetadataStore, videoId: string): FilePair[] {
  const index = store.readIndex(principal);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) return [];

  const base = path.resolve(principal.outputFolder);
  const pairs: FilePair[] = [];

  for (const relPath of [video.summaryMd]) {
    if (!relPath) continue;
    const root = path.resolve(path.join(base, relPath));
    // Guard: resolved root must stay within outputFolder
    if (!root.startsWith(base + path.sep) && root !== base) continue;
    pairs.push({
      root,
      archived: path.join(base, ARCHIVE_DIR, relPath),
    });
  }

  return pairs;
}

async function ensureArchiveDir(outputFolder: string): Promise<void> {
  const archivePath = path.join(outputFolder, ARCHIVE_DIR);
  await fs.promises.mkdir(archivePath, { recursive: true });
  // Reject symlinked archive directory — it could redirect writes outside outputFolder
  const stat = await fs.promises.lstat(archivePath);
  if (!stat.isDirectory()) {
    throw new Error(`archived/ path is not a real directory: ${archivePath}`);
  }
}

// Moves src to dest only if src exists and dest does not (no-clobber).
// Creates the dest parent directory as needed (handles subdir-nested paths).
// Returns true if the move was performed.
async function moveIfExists(src: string, dest: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.rename(src, dest);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') return false; // src does not exist — skip
    if (nodeErr.code === 'EEXIST') return false; // dest already exists — skip
    throw new Error(`Failed to move ${src} to ${dest}`, { cause: err });
  }
}

// Cached HTML files for a video: htmls/<summaryBase>.html.
// Returns only paths safely within outputFolder.
function getCachedHtmlPaths(principal: Principal, store: MetadataStore, videoId: string): string[] {
  const index = store.readIndex(principal);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) return [];
  const base = path.resolve(principal.outputFolder);
  const out: string[] = [];
  for (const md of [video.summaryMd]) {
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

function updateIndexIfKnown(principal: Principal, store: MetadataStore, videoId: string, fields: Partial<{ archived: boolean; summaryHtml: string | null }>): void {
  try {
    store.updateVideoFields(principal, videoId, fields);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('Video not found in index')) return;
    throw err;
  }
}

export async function archiveVideo(outputFolder: string, videoId: string): Promise<void> {
  // Validate before any filesystem operations (P1: validation-before-mutation)
  const principal = getPrincipal(outputFolder); // replaces assertOutputFolder; guards + preserves raw string
  assertVideoId(videoId);
  const store = getMetadataStore();

  // Delete cached HTML BEFORE moving files — index paths are still root-relative at this point.
  for (const p of getCachedHtmlPaths(principal, store, videoId)) unlinkIfExists(p);

  await ensureArchiveDir(outputFolder);

  for (const { root, archived } of getFilePairs(principal, store, videoId)) {
    await moveIfExists(root, archived);
  }

  updateIndexIfKnown(principal, store, videoId, { archived: true, summaryHtml: null });
}

export async function unarchiveVideo(outputFolder: string, videoId: string): Promise<void> {
  // Validate before any filesystem operations (P1: validation-before-mutation)
  const principal = getPrincipal(outputFolder); // replaces assertOutputFolder; guards + preserves raw string
  assertVideoId(videoId);
  const store = getMetadataStore();

  for (const { root, archived } of getFilePairs(principal, store, videoId)) {
    await moveIfExists(archived, root);
  }

  // Defensively clear any cached HTML — it may reference stale pre-archive paths.
  for (const p of getCachedHtmlPaths(principal, store, videoId)) unlinkIfExists(p);

  updateIndexIfKnown(principal, store, videoId, { archived: false, summaryHtml: null });
}
