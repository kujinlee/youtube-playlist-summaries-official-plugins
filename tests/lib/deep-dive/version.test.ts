import { CURRENT_DEEP_DIVE_VERSION, needsRegenerate } from '../../../lib/deep-dive/version';

describe('deep-dive version', () => {
  it('CURRENT is {2,0}', () => {
    expect(CURRENT_DEEP_DIVE_VERSION).toEqual({ major: 2, minor: 0 });
  });
  it('needsRegenerate when stored major is behind', () => {
    expect(needsRegenerate({ major: 1, minor: 0 }, CURRENT_DEEP_DIVE_VERSION)).toBe(true);
  });
  it('does NOT need regenerate on a minor-only gap', () => {
    expect(needsRegenerate({ major: 2, minor: 0 }, { major: 2, minor: 1 })).toBe(false);
  });
  it('does NOT need regenerate when already at current version', () => {
    expect(needsRegenerate(CURRENT_DEEP_DIVE_VERSION, CURRENT_DEEP_DIVE_VERSION)).toBe(false);
  });
});
