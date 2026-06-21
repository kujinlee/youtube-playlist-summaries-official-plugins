import { isOlder } from '../../lib/version';

describe('isOlder', () => {
  it('is true when major is smaller', () => {
    expect(isOlder({ major: 1, minor: 9 }, { major: 2, minor: 0 })).toBe(true);
  });
  it('is true when major equal and minor smaller', () => {
    expect(isOlder({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(true);
  });
  it('is false when equal', () => {
    expect(isOlder({ major: 2, minor: 1 }, { major: 2, minor: 1 })).toBe(false);
  });
  it('is false when newer', () => {
    expect(isOlder({ major: 3, minor: 0 }, { major: 2, minor: 9 })).toBe(false);
  });
});
