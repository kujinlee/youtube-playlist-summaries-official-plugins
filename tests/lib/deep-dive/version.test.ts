import { CURRENT_DEEP_DIVE_VERSION, needsRegenerate } from '../../../lib/deep-dive/version';
import { isOlder } from '../../../lib/version';

describe('deep-dive version', () => {
  it('current deep-dive version is 2.3', () => {
    expect(CURRENT_DEEP_DIVE_VERSION).toEqual({ major: 2, minor: 3 });
  });
  it('needsRegenerate when stored major is behind', () => {
    expect(needsRegenerate({ major: 1, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(true);
  });
  it('treats a 2.0 deep dive as older (cheap re-render needed)', () => {
    expect(isOlder({ major: 2, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(true);
    expect(needsRegenerate({ major: 2, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(false);
  });
  it('does NOT need regenerate on a minor-only gap', () => {
    expect(needsRegenerate({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(false);
  });
  it('does NOT need regenerate when already at current version', () => {
    expect(needsRegenerate(CURRENT_DEEP_DIVE_VERSION, CURRENT_DEEP_DIVE_VERSION)).toBe(false);
  });
});
