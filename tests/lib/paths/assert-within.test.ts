import { assertIndexRelPathWithin } from '@/lib/paths/assert-within';

const ROOT = '/data/pl/raw';

describe('assertIndexRelPathWithin', () => {
  it('returns the resolved absolute path for a safe rel', () => {
    expect(assertIndexRelPathWithin(ROOT, 'htmls/275_x.html')).toBe('/data/pl/raw/htmls/275_x.html');
  });

  it('admits Unicode (Korean) filenames', () => {
    expect(assertIndexRelPathWithin(ROOT, 'raw/건강.md')).toBe('/data/pl/raw/raw/건강.md');
  });

  it('rejects ../ traversal with a 400 statusCode', () => {
    expect(() => assertIndexRelPathWithin(ROOT, '../../etc/passwd')).toThrow();
    try {
      assertIndexRelPathWithin(ROOT, '../x');
    } catch (e) {
      expect((e as { statusCode?: number }).statusCode).toBe(400);
    }
  });

  it('rejects an absolute-path escape', () => {
    expect(() => assertIndexRelPathWithin(ROOT, '/etc/passwd')).toThrow();
  });

  it('enforces allowedExt when provided', () => {
    expect(() => assertIndexRelPathWithin(ROOT, 'htmls/x.html', '.md')).toThrow();
    expect(assertIndexRelPathWithin(ROOT, 'raw/x.md', '.md')).toBe('/data/pl/raw/raw/x.md');
  });

  it('allows the root itself', () => {
    expect(assertIndexRelPathWithin(ROOT, '.')).toBe('/data/pl/raw');
  });
});
