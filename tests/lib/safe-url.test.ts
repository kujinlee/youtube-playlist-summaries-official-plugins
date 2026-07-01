import { safeHttpUrl } from '../../lib/safe-url';

describe('safeHttpUrl', () => {
  it('accepts https', () => expect(safeHttpUrl('https://youtube.com/playlist?list=PL1')).toBe('https://youtube.com/playlist?list=PL1'));
  it('accepts http', () => expect(safeHttpUrl('http://x.test/a')).toBe('http://x.test/a'));
  it('rejects javascript:', () => expect(safeHttpUrl('javascript:alert(1)')).toBeNull());
  it('rejects data:', () => expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull());
  it('rejects undefined and empty', () => { expect(safeHttpUrl()).toBeNull(); expect(safeHttpUrl('')).toBeNull(); });
  it('rejects a malformed string', () => expect(safeHttpUrl('not a url')).toBeNull());
});
