import { createJob, getActiveJob, releaseJobLock, deleteJob, _resetJobRegistry } from '../../lib/job-registry';

beforeEach(() => _resetJobRegistry());

it('getActiveJob returns the jobId holding a key, undefined otherwise', () => {
  expect(getActiveJob('k')).toBeUndefined();
  createJob('job1', 'k');
  expect(getActiveJob('k')).toBe('job1');
});

it('releaseJobLock frees the key but keeps the job subscribable', () => {
  createJob('job1', 'k');
  releaseJobLock('job1');
  expect(getActiveJob('k')).toBeUndefined();   // lock freed → a new submit may start
  // registry entry still present: deleteJob is what removes it
  deleteJob('job1');
  expect(getActiveJob('k')).toBeUndefined();
});
