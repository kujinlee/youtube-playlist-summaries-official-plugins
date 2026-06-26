// tests/lib/serial-filename.test.ts
import { padSerial, stripSerialPrefix, applySerial } from '@/lib/serial-filename';

describe('padSerial', () => {
  it('zero-pads to 3 digits', () => { expect(padSerial(7)).toBe('007'); });
  it('keeps 3-digit as-is', () => { expect(padSerial(236)).toBe('236'); });
  it('widens past 999', () => { expect(padSerial(1000)).toBe('1000'); });
});

describe('stripSerialPrefix', () => {
  it('removes a leading NNN_ prefix', () => { expect(stripSerialPrefix('007_hello-world')).toBe('hello-world'); });
  it('leaves a hyphen-digit slug untouched (no underscore)', () => {
    expect(stripSerialPrefix('2024-ai-predictions')).toBe('2024-ai-predictions');
  });
  it('is a no-op when no prefix', () => { expect(stripSerialPrefix('hello-world')).toBe('hello-world'); });
});

describe('applySerial', () => {
  it('prefixes a bare md filename', () => { expect(applySerial('hello-world.md', 1)).toBe('001_hello-world.md'); });
  it('preserves a subdirectory', () => { expect(applySerial('pdfs/hello-world.pdf', 1)).toBe('pdfs/001_hello-world.pdf'); });
  it('preserves the -deep-dive suffix', () => { expect(applySerial('hello-world-deep-dive.md', 5)).toBe('005_hello-world-deep-dive.md'); });
  it('preserves the -dig-deeper suffix', () => { expect(applySerial('hello-world-dig-deeper.md', 5)).toBe('005_hello-world-dig-deeper.md'); });
  it('is idempotent (re-applying same serial)', () => { expect(applySerial('001_hello-world.md', 1)).toBe('001_hello-world.md'); });
  it('replaces an existing different serial', () => { expect(applySerial('002_hello-world.md', 7)).toBe('007_hello-world.md'); });
});
