import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, readIndex, updateVideoFields } from './index-store';

const ARCHIVE_DIR = 'archived';

type FilePair = { root: string; archived: string };

// Resolve actual on-disk paths from the video's index entry.
// Files are named with title slugs (not videoId) and PDFs live under pdfs/.
// Returns only paths that are safely within outputFolder (path traversal guard).
function getFilePairs(outputFolder: string, videoId: string): FilePair[] {
  const index = readIndex(outputFolder);
  const video = index.videos.find((v) => v.id === videoId);
  if (!video) return [];

  const base = path.resolve(outputFolder);
  const pairs: FilePair[] = [];

  for (const relPath of [video.summaryMd, video.summaryPdf, video.deepDiveMd, video.deepDivePdf]) {
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
// Creates the dest parent directory as needed (handles pdfs/ and other subdirs).
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

function updateIndexIfKnown(outputFolder: string, videoId: string, fields: { archived: boolean }): void {
  try {
    updateVideoFields(outputFolder, videoId, fields);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('Video not found in index')) return;
    throw err;
  }
}

export async function archiveVideo(outputFolder: string, videoId: string): Promise<void> {
  // Validate before any filesystem operations (P1: validation-before-mutation)
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  await ensureArchiveDir(outputFolder);

  for (const { root, archived } of getFilePairs(outputFolder, videoId)) {
    await moveIfExists(root, archived);
  }

  updateIndexIfKnown(outputFolder, videoId, { archived: true });
}

export async function unarchiveVideo(outputFolder: string, videoId: string): Promise<void> {
  // Validate before any filesystem operations (P1: validation-before-mutation)
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  for (const { root, archived } of getFilePairs(outputFolder, videoId)) {
    await moveIfExists(archived, root);
  }

  updateIndexIfKnown(outputFolder, videoId, { archived: false });
}
