import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeModelEnvelope, readModelEnvelope, type ModelEnvelope } from '../../../lib/html-doc/model-store';

let dir: string;
const BASE = 'a-title';
const ENVELOPE: ModelEnvelope = {
  sourceMd: 'a-title.md',
  generatedAt: '2026-06-17T10:30:00.000Z',
  sourceSections: ['The Foundation'],
  model: {
    sections: [
      { lead: 'Lead one.', bullets: [
        { label: 'A', text: 'a' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' },
      ] },
    ],
  },
};

beforeEach(() => {
  dir = path.join(os.homedir(), `.tmp-modelstore-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('model-store', () => {
  it('writes models/<base>.json and reads it back (round-trip)', () => {
    writeModelEnvelope(dir, BASE, ENVELOPE);
    const p = path.join(dir, 'models', 'a-title.json');
    expect(fs.existsSync(p)).toBe(true);
    expect(readModelEnvelope(dir, BASE)).toEqual(ENVELOPE);
  });

  it('creates the models/ directory if absent and leaves no temp file', () => {
    writeModelEnvelope(dir, BASE, ENVELOPE);
    const files = fs.readdirSync(path.join(dir, 'models'));
    expect(files).toEqual(['a-title.json']); // no .tmp leftovers
  });

  it('returns null when the model file is absent', () => {
    expect(readModelEnvelope(dir, 'missing')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'models', 'bad.json'), '{ not json', 'utf-8');
    expect(readModelEnvelope(dir, 'bad')).toBeNull();
  });

  it('returns null (and warns) when the envelope fails schema validation', () => {
    fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = { sourceMd: 'x.md', generatedAt: 'now', sourceSections: ['s'], model: { sections: [{ lead: 'l', bullets: [] }] } };
    fs.writeFileSync(path.join(dir, 'models', 'bad2.json'), JSON.stringify(bad), 'utf-8');
    expect(readModelEnvelope(dir, 'bad2')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws when asked to write an invalid model (write-time validation)', () => {
    const invalid = {
      sourceMd: 'a-title.md', generatedAt: 'now', sourceSections: ['s'],
      model: { sections: [{ lead: 'l', bullets: [{ label: 'A', text: 'a' }] }] }, // <3 bullets
    } as unknown as ModelEnvelope;
    expect(() => writeModelEnvelope(dir, BASE, invalid)).toThrow();
    expect(fs.existsSync(path.join(dir, 'models', 'a-title.json'))).toBe(false);
  });
});
