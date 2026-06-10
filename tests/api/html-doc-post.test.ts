import { POST } from '../../app/api/videos/[id]/html-doc/route';
import * as generate from '../../lib/html-doc/generate';
import { _resetJobRegistry } from '../../lib/job-registry';

jest.mock('../../lib/html-doc/generate');
const mockRun = generate.runHtmlDoc as jest.Mock;

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

it('returns a jobId and starts the run', async () => {
  mockRun.mockResolvedValueOnce(undefined);
  const json = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(typeof json.jobId).toBe('string');
  expect(mockRun).toHaveBeenCalledWith('vid12345', HOME, expect.any(Function));
});

it('returns the SAME jobId for a concurrent duplicate submit (no second run)', async () => {
  mockRun.mockReturnValue(new Promise(() => {})); // never resolves → job stays active
  const first = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  const second = await (await POST(req({ outputFolder: HOME }), ctx)).json();
  expect(second.jobId).toBe(first.jobId);
  expect(mockRun).toHaveBeenCalledTimes(1);
});
