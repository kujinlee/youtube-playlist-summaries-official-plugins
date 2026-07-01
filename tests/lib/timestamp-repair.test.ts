jest.mock('../../lib/html-doc/ensure');
jest.mock('../../lib/timestamp-audit', () => ({
  ...jest.requireActual('../../lib/timestamp-audit'),
  auditTimestamps: jest.fn(),
}));
import { ensureHtmlDoc } from '../../lib/html-doc/ensure';
import { auditTimestamps } from '../../lib/timestamp-audit';
import { repairTimestamps } from '../../lib/timestamp-repair';

const mockEnsure = jest.mocked(ensureHtmlDoc);
const mockAudit = jest.mocked(auditTimestamps);

beforeEach(() => {
  jest.clearAllMocks();
  mockAudit.mockReturnValue({
    folder: 'f',
    summaries: { total: 2, withTs: 0, noTsWouldRegen: 1, noTsStuck: 1, mdMissing: 0, stuckIds: ['s1'], wouldRegenIds: ['w1'] },
  });
  mockEnsure.mockResolvedValue(undefined);
});

it('dry-run lists targets and calls no ensure functions', async () => {
  const r = await repairTimestamps('f', { run: false, stuckOnly: false });
  expect(r.dryRun).toBe(true);
  expect(r.planned.map((p) => p.videoId).sort()).toEqual(['s1', 'w1']);
  expect(mockEnsure).not.toHaveBeenCalled();
});

it('--run --stuck-only forces re-gen of exactly the stuck summaries', async () => {
  await repairTimestamps('f', { run: true, stuckOnly: true });
  expect(mockEnsure).toHaveBeenCalledTimes(1);
  expect(mockEnsure).toHaveBeenCalledWith('s1', 'f', expect.any(Function), undefined, true);
});

it('a throwing ensure is skipped and the batch continues', async () => {
  mockEnsure.mockRejectedValueOnce(new Error('no transcript'));
  const r = await repairTimestamps('f', { run: true, stuckOnly: false });
  expect(r.skipped).toEqual([expect.objectContaining({ videoId: 's1', error: expect.stringContaining('no transcript') })]);
  expect(mockEnsure).toHaveBeenCalledTimes(2); // s1 (throws) + w1 (continues)
});

it('--ids filters to only the requested video ids', async () => {
  const r = await repairTimestamps('f', { run: false, stuckOnly: false, ids: ['w1'] });
  expect(r.planned.map((p) => p.videoId)).toEqual(['w1']);
  expect(mockEnsure).not.toHaveBeenCalled();
});

