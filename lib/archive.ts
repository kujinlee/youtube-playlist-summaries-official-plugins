import fs from 'fs';
import path from 'path';
import { assertOutputFolder, assertVideoId, updateVideoFields } from './index-store';

const ARCHIVE_DIR = 'archived';
const FILE_SUFFIXES = ['.md', '.pdf', '-deep-dive.md', '-deep-dive.pdf'];

function filePairs(outputFolder: string, videoId: string) {
  return FILE_SUFFIXES.map((suffix) => ({
    root: path.join(outputFolder, `${videoId}${suffix}`),
    archived: path.join(outputFolder, ARCHIVE_DIR, `${videoId}${suffix}`),
  }));
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
// Returns true if the move was performed.
async function moveIfExists(src: string, dest: string): Promise<boolean> {
  try {
    await fs.promises.rename(src, dest);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') return false;
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

  for (const { root, archived } of filePairs(outputFolder, videoId)) {
    await moveIfExists(root, archived);
  }

  updateIndexIfKnown(outputFolder, videoId, { archived: true });
}

export async function unarchiveVideo(outputFolder: string, videoId: string): Promise<void> {
  // Validate before any filesystem operations (P1: validation-before-mutation)
  assertOutputFolder(outputFolder);
  assertVideoId(videoId);

  for (const { root, archived } of filePairs(outputFolder, videoId)) {
    await moveIfExists(archived, root);
  }

  updateIndexIfKnown(outputFolder, videoId, { archived: false });
}
