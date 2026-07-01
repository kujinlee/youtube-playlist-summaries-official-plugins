import { POST } from '../../app/api/videos/[id]/html-doc/route';
import * as ensure from '../../lib/html-doc/ensure';
import { CURRENT_DOC_VERSION } from '../../lib/doc-version';
import { _resetJobRegistry } from '../../lib/job-registry';

jest.mock('../../lib/html-doc/ensure');
const mockEnsure = ensure.ensureHtmlDoc as jest.Mock;

const HOME = (process.env.HOME ?? '/tmp') + '/x';
function req(body: unknown) {
  return new Request('http://localhost/api/videos/vid12345/html-doc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ id: 'vid12345' }) };

beforeEach(() => { jest.clearAllMocks(); _resetJobRegistry(); });

it('400s without outputFolder', async () => {
  expect((await POST(req({}), ctx)).status).toBe(400);
});

it('400s on an outputFolder outside home', async () => {
  expect((await POST(req({ outputFolder: '/etc' }), ctx)).status).toBe(400);
});

it('returns a jobId and starts the run (force defaults false)', async () => {
  mockEnsure.mockResolvedValueOnce(undefined);
  const json = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(typeof json.jobId).toBe('string');
  expect(mockEnsure).toHaveBeenCalledWith('vid12345', HOME, expect.any(Function), CURRENT_DOC_VERSION, false);
});

it('passes force=true when the body sets it (Re-summarize)', async () => {
  mockEnsure.mockResolvedValueOnce(undefined);
  await POST(req({ outputFolder: HOME, force: true }), ctx);
  expect(mockEnsure).toHaveBeenCalledWith('vid12345', HOME, expect.any(Function), CURRENT_DOC_VERSION, true);
});

it('409s a force POST while a job is live (must not silently join a non-force job)', async () => {
  mockEnsure.mockReturnValue(new Promise(() => {})); // stays active
  await POST(req({ outputFolder: HOME }), ctx);           // start a (non-force) job
  const res = await POST(req({ outputFolder: HOME, force: true }), ctx);
  expect(res.status).toBe(409);
  expect(mockEnsure).toHaveBeenCalledTimes(1);            // no 2nd run
});

it('a non-force duplicate still joins the active job (returns same jobId)', async () => {
  mockEnsure.mockReturnValue(new Promise(() => {}));
  const first = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  const second = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(second.jobId).toBe(first.jobId);
  expect(mockEnsure).toHaveBeenCalledTimes(1);
});

it('returns the SAME jobId for a concurrent duplicate submit (no second run)', async () => {
  mockEnsure.mockReturnValue(new Promise(() => {})); // never resolves → job stays active
  const first = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  const second = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(second.jobId).toBe(first.jobId);
  expect(mockEnsure).toHaveBeenCalledTimes(1);
});
