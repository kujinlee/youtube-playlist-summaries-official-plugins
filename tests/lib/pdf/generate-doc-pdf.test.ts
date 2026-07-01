import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock the chromium driver so no real browser launches in unit tests.
jest.mock('playwright', () => {
  const pdf = jest.fn(async () => Buffer.from('%PDF-1.7 fake pdf body'));
  const page = {
    setContent: jest.fn(async () => {}),
    emulateMedia: jest.fn(async () => {}),
    pdf,
    close: jest.fn(async () => {}),
    setDefaultTimeout: jest.fn(),
    route: jest.fn(async () => {}),
  };
  const context = { newPage: jest.fn(async () => page), close: jest.fn(async () => {}) };
  const browser = { newContext: jest.fn(async () => context), close: jest.fn(async () => {}) };
  const chromium = { launch: jest.fn(async () => browser) };
  return { chromium, __mock: { page, context, browser, pdf, chromium } };
});

import { generateDocPdf } from '@/lib/pdf/generate-doc-pdf';

interface PwMock {
  page: { setContent: jest.Mock; emulateMedia: jest.Mock; pdf: jest.Mock; close: jest.Mock; setDefaultTimeout: jest.Mock; route: jest.Mock };
  context: { newPage: jest.Mock; close: jest.Mock };
  browser: { newContext: jest.Mock; close: jest.Mock };
  pdf: jest.Mock;
  chromium: { launch: jest.Mock };
}
const { __mock } = jest.requireMock('playwright') as { __mock: PwMock };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  __mock.pdf.mockClear();
  __mock.page.setContent.mockClear();
  __mock.page.emulateMedia.mockClear();
  __mock.page.close.mockClear();
  __mock.context.close.mockClear();
  __mock.browser.close.mockClear();
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('generateDocPdf', () => {
  it('writes a %PDF- file and creates the pdfs/ dir', async () => {
    const out = path.join(dir, 'pdfs', 'x.pdf');
    await generateDocPdf('<html></html>', out);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('emulates print media, prints background, and closes page+context+browser', async () => {
    await generateDocPdf('<html></html>', path.join(dir, 'pdfs', 'y.pdf'));
    expect(__mock.page.emulateMedia).toHaveBeenCalledWith({ media: 'print' });
    expect(__mock.pdf).toHaveBeenCalledWith(expect.objectContaining({ printBackground: true }));
    expect(__mock.page.close).toHaveBeenCalled();
    expect(__mock.context.close).toHaveBeenCalled();
    expect(__mock.browser.close).toHaveBeenCalled();
  });

  it('leaves no .tmp file after success', async () => {
    await generateDocPdf('<html></html>', path.join(dir, 'pdfs', 'z.pdf'));
    const leftovers = fs.readdirSync(path.join(dir, 'pdfs')).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('rejects and cleans up when render hangs (overall timeout)', async () => {
    __mock.pdf.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const out = path.join(dir, 'pdfs', 'hang.pdf');
    await expect(generateDocPdf('<html></html>', out, { timeoutMs: 50 })).rejects.toThrow(/timed out/);
    expect(fs.existsSync(out)).toBe(false);
  });
});
