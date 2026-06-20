import { padDividers } from '../../lib/markdown-dividers';

describe('padDividers', () => {
  it('pads a bare divider with blank lines on both sides', () => {
    expect(padDividers('alpha\n---\nbeta')).toBe('alpha\n\n---\n\nbeta');
  });

  it('is idempotent on already-padded dividers', () => {
    const padded = 'alpha\n\n---\n\nbeta';
    expect(padDividers(padded)).toBe(padded);
  });

  it('pads a trailing divider with a leading blank and no trailing blank', () => {
    expect(padDividers('alpha\n---')).toBe('alpha\n\n---');
  });

  it('leaves an exact --- inside a fenced code block untouched', () => {
    const body = 'intro\n\n```yaml\nkey: value\n---\nmore: 1\n```\n\noutro';
    expect(padDividers(body)).toBe(body);
  });

  it('leaves ----- (5 dashes) inside a fence untouched', () => {
    const body = '```\n-----\n```';
    expect(padDividers(body)).toBe(body);
  });

  it('pads but PRESERVES the dash count of a long thematic break outside a fence', () => {
    expect(padDividers('alpha\n-----\nbeta')).toBe('alpha\n\n-----\n\nbeta');
  });

  it('does not let a ``` fence be closed by a shorter ` run', () => {
    const body = '````\ncode `x`\n---\nmore\n````';
    expect(padDividers(body)).toBe(body);
  });

  it('treats an unterminated fence as fenced to EOF (no padding inside)', () => {
    const body = 'intro\n\n```\n---\nstill code';
    expect(padDividers(body)).toBe(body);
  });

  it('pads a divider in CRLF input and preserves CRLF endings', () => {
    expect(padDividers('alpha\r\n---\r\nbeta')).toBe('alpha\r\n\r\n---\r\n\r\nbeta');
  });

  it('returns body unchanged when there are no dividers', () => {
    const body = 'just\nsome\nprose';
    expect(padDividers(body)).toBe(body);
  });

  it('pads a divider that is the very first line (no leading blank added)', () => {
    expect(padDividers('---\nalpha')).toBe('---\n\nalpha');
  });

  it('pads consecutive dividers, one blank between them', () => {
    expect(padDividers('alpha\n---\n---\nbeta')).toBe('alpha\n\n---\n\n---\n\nbeta');
  });
});
