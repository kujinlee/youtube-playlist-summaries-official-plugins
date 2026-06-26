import { rewriteSourceMdMeta, rewriteEnvelopeSourceMd } from '@/lib/serial-provenance';

describe('rewriteSourceMdMeta', () => {
  it('rewrites the source-md meta content', () => {
    const html = '<meta name="source-md" content="hello-world.md">';
    expect(rewriteSourceMdMeta(html, '001_hello-world.md'))
      .toBe('<meta name="source-md" content="001_hello-world.md">');
  });
  it('escapes double quotes in the new name defensively', () => {
    expect(rewriteSourceMdMeta('<meta name="source-md" content="x">', 'a"b.md'))
      .toContain('content="a&quot;b.md"');
  });
  it('is a no-op when no source-md meta present', () => {
    expect(rewriteSourceMdMeta('<p>no meta</p>', '001_x.md')).toBe('<p>no meta</p>');
  });
});

describe('rewriteEnvelopeSourceMd', () => {
  it('rewrites the sourceMd JSON field', () => {
    const json = '{"sourceMd":"hello-world.md","generatedAt":"t"}';
    const out = JSON.parse(rewriteEnvelopeSourceMd(json, '001_hello-world.md'));
    expect(out.sourceMd).toBe('001_hello-world.md');
    expect(out.generatedAt).toBe('t');
  });
});
