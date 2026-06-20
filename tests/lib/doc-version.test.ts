import { CURRENT_DOC_VERSION, isOlder, needsResummarize } from '../../lib/doc-version';

describe('doc-version', () => {
  it('CURRENT_DOC_VERSION is 2.0 (timestamps = first major bump)', () => {
    expect(CURRENT_DOC_VERSION).toEqual({ major: 2, minor: 0 });
  });
  it('isOlder compares major then minor', () => {
    expect(isOlder({ major: 1, minor: 0 }, { major: 2, minor: 0 })).toBe(true);
    expect(isOlder({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(true);
    expect(isOlder({ major: 2, minor: 0 }, { major: 2, minor: 0 })).toBe(false);
    expect(isOlder({ major: 3, minor: 0 }, { major: 2, minor: 9 })).toBe(false);
  });
  it('needsResummarize is true only when the major advanced', () => {
    expect(needsResummarize({ major: 1, minor: 0 }, { major: 2, minor: 0 })).toBe(true);
    expect(needsResummarize({ major: 2, minor: 0 }, { major: 2, minor: 5 })).toBe(false);
    expect(needsResummarize({ major: 2, minor: 0 }, { major: 2, minor: 0 })).toBe(false);
  });
});
