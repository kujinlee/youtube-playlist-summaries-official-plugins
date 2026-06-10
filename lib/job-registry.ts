import { EventEmitter } from 'events';
import type { ProgressEvent } from '../types';

interface Job {
  emitter: EventEmitter;
  // Events are buffered so a late-subscribing SSE client can replay missed events
  buffer: ProgressEvent[];
  controller: AbortController;
}

const registry = new Map<string, Job>();
// Tracks which outputFolder has an active ingestion job, preventing concurrent runs.
const activeByFolder = new Map<string, string>(); // folder → jobId
const jobFolders = new Map<string, string>();     // jobId → folder (for cleanup in deleteJob)

export function createJob(jobId: string, outputFolder?: string): void {
  registry.set(jobId, { emitter: new EventEmitter(), buffer: [], controller: new AbortController() });
  if (outputFolder) {
    activeByFolder.set(outputFolder, jobId);
    jobFolders.set(jobId, outputFolder);
  }
}

export function isIngestionRunning(outputFolder: string): boolean {
  return activeByFolder.has(outputFolder);
}

export function emitJobEvent(jobId: string, event: ProgressEvent): void {
  const job = registry.get(jobId);
  if (!job) return;
  job.buffer.push(event);
  job.emitter.emit('progress', event);
}

// Replays any buffered events synchronously before subscribing to new ones.
// Returns a cleanup function, or null if the job does not exist.
export function subscribeJob(
  jobId: string,
  listener: (event: ProgressEvent) => void,
): (() => void) | null {
  const job = registry.get(jobId);
  if (!job) return null;
  for (const event of job.buffer) listener(event);
  job.emitter.on('progress', listener);
  return () => job.emitter.removeListener('progress', listener);
}

// Abort the job's signal. Returns true if found and aborted, false if not found.
export function cancelJob(jobId: string): boolean {
  const job = registry.get(jobId);
  if (!job) return false;
  job.controller.abort();
  return true;
}

// Returns the AbortSignal for the job, or undefined if not found.
export function getJobSignal(jobId: string): AbortSignal | undefined {
  return registry.get(jobId)?.controller.signal;
}

export function deleteJob(jobId: string): void {
  const folder = jobFolders.get(jobId);
  if (folder) {
    activeByFolder.delete(folder);
    jobFolders.delete(jobId);
  }
  registry.delete(jobId);
}

export function _resetJobRegistry(): void {
  registry.clear();
  activeByFolder.clear();
  jobFolders.clear();
}

/** Returns the jobId currently holding the lock for `key`, or undefined. */
export function getActiveJob(key: string): string | undefined {
  return activeByFolder.get(key);
}

/**
 * Release a job's lock key WITHOUT deleting its registry entry, so late SSE
 * subscribers can still replay buffered terminal events. Pair with a deferred
 * deleteJob() for eventual cleanup.
 */
export function releaseJobLock(jobId: string): void {
  const folder = jobFolders.get(jobId);
  if (folder) {
    activeByFolder.delete(folder);
    jobFolders.delete(jobId);
  }
}
