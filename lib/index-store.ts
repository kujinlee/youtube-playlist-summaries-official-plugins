import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PlaylistIndex, Video } from '../types';

const INDEX_FILE = 'playlist-index.json';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;

export function assertOutputFolder(outputFolder: string): void {
  const resolved = path.resolve(outputFolder);
  const home = os.homedir();
  const withinHome = (p: string) => p === home || p.startsWith(home + path.sep);

  if (!withinHome(resolved)) {
    throw Object.assign(new Error(`outputFolder outside home directory: ${resolved}`), { statusCode: 400 });
  }

  // Also check the real path to catch symlinks that point outside home
  try {
    const real = fs.realpathSync.native(resolved);
    if (!withinHome(real)) {
      throw Object.assign(new Error(`outputFolder resolves outside home directory via symlink: ${real}`), { statusCode: 400 });
    }
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.statusCode === 400) throw err;
    // ENOENT means path doesn't exist yet — no symlink to follow, trust resolved path
    if (nodeErr.code !== 'ENOENT') throw err;
  }
}

export function assertVideoId(id: string): void {
  if (!VIDEO_ID_RE.test(id)) {
    throw Object.assign(new Error(`invalid videoId: ${id}`), { statusCode: 400 });
  }
}

function indexPath(outputFolder: string): string {
  return path.join(outputFolder, INDEX_FILE);
}

export function readIndex(outputFolder: string): PlaylistIndex {
  assertOutputFolder(outputFolder);
  const filePath = indexPath(outputFolder);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as PlaylistIndex;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      // Distinguish missing file from missing directory
      try { fs.lstatSync(outputFolder); } catch {
        throw Object.assign(new Error(`Output folder does not exist: ${outputFolder}`), { statusCode: 400, cause: err });
      }
      return { playlistUrl: '', outputFolder, videos: [] };
    }
    throw Object.assign(new Error(`Failed to read ${filePath}: ${nodeErr.message}`), { cause: err });
  }
}

export function writeIndex(outputFolder: string, index: PlaylistIndex): void {
  assertOutputFolder(outputFolder);
  for (const video of index.videos) {
    assertVideoId(video.id);
  }
  const filePath = indexPath(outputFolder);
  const tmpPath = filePath + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
    throw err;
  }
}

export function upsertVideo(outputFolder: string, video: Video): void {
  assertOutputFolder(outputFolder);
  assertVideoId(video.id);
  const index = readIndex(outputFolder);
  const i = index.videos.findIndex((v) => v.id === video.id);
  if (i === -1) {
    index.videos.push(video);
  } else {
    index.videos[i] = video;
  }
  writeIndex(outputFolder, index);
}

export function updateVideoFields(outputFolder: string, id: string, fields: Partial<Video>): void {
  assertOutputFolder(outputFolder);
  assertVideoId(id);
  const index = readIndex(outputFolder);
  const i = index.videos.findIndex((v) => v.id === id);
  if (i === -1) {
    throw new Error(`Video not found in index: ${id}`);
  }
  // Exclude id from fields — callers must not change a video's identity
  const { id: _discarded, ...safeFields } = fields;
  index.videos[i] = { ...index.videos[i], ...safeFields };
  writeIndex(outputFolder, index);
}
