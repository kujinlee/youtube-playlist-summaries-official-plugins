import { EventEmitter } from 'events';
import type { ProgressEvent } from '../types';

interface Job {
  emitter: EventEmitter;
  // Events are buffered so a late-subscribing SSE client can replay missed events
  buffer: ProgressEvent[];
}

const registry = new Map<string, Job>();

export function createJob(jobId: string): void {
  registry.set(jobId, { emitter: new EventEmitter(), buffer: [] });
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

export function deleteJob(jobId: string): void {
  registry.delete(jobId);
}

export function _resetJobRegistry(): void {
  registry.clear();
}
