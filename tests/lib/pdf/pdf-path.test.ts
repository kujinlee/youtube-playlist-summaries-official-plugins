import { pdfRelPath } from '@/lib/pdf/pdf-path';
import type { Video } from '@/types';

// Pure string derivation — a partial Video cast is sufficient.
const v = (o: Partial<Video>): Video => ({ id: 'v', ...o } as Video);

describe('pdfRelPath', () => {
  it('summary → pdfs/{base}.pdf', () => {
    expect(pdfRelPath(v({ summaryMd: 'raw/275_google-okf.md' }), 'summary')).toBe('pdfs/275_google-okf.pdf');
  });

  it('summary strips only the directory, keeps the serial prefix', () => {
    expect(pdfRelPath(v({ summaryMd: '001_intro.md' }), 'summary')).toBe('pdfs/001_intro.pdf');
  });

  it('dig-deeper strips -dig-deeper.md and re-appends -dig-deeper', () => {
    expect(pdfRelPath(v({ digDeeperMd: 'raw/275_google-okf-dig-deeper.md' }), 'dig-deeper')).toBe(
      'pdfs/275_google-okf-dig-deeper.pdf',
    );
  });

  it('summary without summaryMd throws', () => {
    expect(() => pdfRelPath(v({}), 'summary')).toThrow();
  });

  it('dig-deeper without digDeeperMd throws', () => {
    expect(() => pdfRelPath(v({ summaryMd: 'raw/x.md' }), 'dig-deeper')).toThrow();
  });
});
