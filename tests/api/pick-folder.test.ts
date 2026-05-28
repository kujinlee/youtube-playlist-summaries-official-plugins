jest.mock('child_process');

import { execFileSync } from 'child_process';
import { GET } from '../../app/api/pick-folder/route';

const mockExecFileSync = jest.mocked(execFileSync);

describe('GET /api/pick-folder', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  function setPlatform(p: string) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  it('returns 501 on non-macOS', async () => {
    setPlatform('win32');
    const res = await GET();
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error).toMatch(/macOS/);
  });

  it('returns folderPath on success, strips trailing slash', async () => {
    setPlatform('darwin');
    mockExecFileSync.mockReturnValue('/Users/kujin/notes/\n' as unknown as ReturnType<typeof execFileSync>);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.folderPath).toBe('/Users/kujin/notes');
  });

  it('returns folderPath unchanged when no trailing slash present', async () => {
    setPlatform('darwin');
    mockExecFileSync.mockReturnValue('/Users/kujin/notes' as unknown as ReturnType<typeof execFileSync>);
    const res = await GET();
    const body = await res.json();
    expect(body.folderPath).toBe('/Users/kujin/notes');
  });

  it('returns { cancelled: true } when osascript throws (user cancelled)', async () => {
    setPlatform('darwin');
    mockExecFileSync.mockImplementation(() => { throw new Error('User canceled.'); });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cancelled).toBe(true);
  });
});
