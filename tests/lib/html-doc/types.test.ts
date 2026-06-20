import { MagazineModelSchema } from '../../../lib/html-doc/types';

const b = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, text: `t${i}` }));

describe('MagazineModelSchema', () => {
  it('accepts a valid model (3 bullets)', () => {
    const ok = MagazineModelSchema.parse({ sections: [{ lead: 'A thesis.', bullets: b(3) }] });
    expect(ok.sections).toHaveLength(1);
  });

  it('accepts 7 bullets (upper bound)', () => {
    expect(() => MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(7) }] })).not.toThrow();
  });

  it('rejects fewer than 3 bullets', () => {
    expect(() => MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(2) }] })).toThrow();
  });

  it('rejects more than 7 bullets', () => {
    expect(() => MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(8) }] })).toThrow();
  });

  it('rejects empty sections', () => {
    expect(() => MagazineModelSchema.parse({ sections: [] })).toThrow();
  });

  it('rejects a bullet missing text', () => {
    expect(() =>
      MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: [{ label: 'L' }, { label: 'M' }, { label: 'N' }] }] }),
    ).toThrow();
  });

  it('rejects unknown top-level keys (strict)', () => {
    expect(() =>
      MagazineModelSchema.parse({ sections: [{ lead: 'x', bullets: b(3) }], extra: 1 }),
    ).toThrow();
  });
});

import type { SectionTimeRange, ParsedSection } from '../../../lib/html-doc/types';

describe('SectionTimeRange / ParsedSection.timeRange', () => {
  it('accepts a section carrying a time range', () => {
    const tr: SectionTimeRange = {
      startSec: 135,
      endSec: 330,
      label: '2:15–5:30',
      url: 'https://www.youtube.com/watch?v=vid123&t=135s',
    };
    const section: ParsedSection = { numeral: '1', title: 'A', prose: 'body', timeRange: tr };
    expect(section.timeRange?.startSec).toBe(135);
  });

  it('accepts a section with no time range', () => {
    const section: ParsedSection = { numeral: null, title: 'Conclusion', prose: 'p' };
    expect(section.timeRange ?? null).toBeNull();
  });
});
