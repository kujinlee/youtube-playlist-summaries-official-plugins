import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditSummaries } from '../../lib/summary-audit';

// readIndex enforces outputFolder under $HOME, so the temp dir must live there.
let dir: string;

function writeVideo(id: string, serialNumber: number, base: string, body: string | null) {
  const summaryMd = `${base}.md`;
  if (body !== null) {
    fs.writeFileSync(path.join(dir, summaryMd), `## 1. A\n▶ [0:00–1:00](u)\n${body}`);
  }
  return { id, serialNumber, summaryMd };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-summaryaudit-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

it('lists truncated + structural suspects with index-sourced serial, reports missing, never throws', () => {
  const videos = [
    writeVideo('good', 10, '010_good', 'All wrapped up.'),        // complete → not a suspect
    writeVideo('bad', 11, '011_bad', 'cut off mid'),              // mid-sentence → high
    writeVideo('tbl', 12, '012_tbl', '| a | b |'),                // structural → low
    writeVideo('gone', 13, '013_gone', null),                    // file absent → md-missing
  ];
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'p', outputFolder: dir, videos }));

  const r = auditSummaries(dir);

  expect(r.total).toBe(4);
  expect(r.suspects.map((s) => s.id).sort()).toEqual(['bad', 'gone', 'tbl']);
  expect(r.suspects.find((s) => s.id === 'bad')!.serial).toBe(11); // from index, not filename
  expect(r.suspects.find((s) => s.id === 'bad')!.reason).toMatch(/mid-sentence/);
  expect(r.suspects.find((s) => s.id === 'tbl')!.confidence).toBe('low');
  expect(r.suspects.find((s) => s.id === 'gone')!.reason).toBe('md-missing');
});

it('skips videos without a summaryMd and returns an empty suspect list for a clean corpus', () => {
  const videos = [
    { id: 'nosum', serialNumber: 1 },                            // no summaryMd → not counted
    writeVideo('ok', 2, '002_ok', 'Done here.'),
  ];
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'p', outputFolder: dir, videos }));

  const r = auditSummaries(dir);
  expect(r.total).toBe(1);
  expect(r.suspects).toEqual([]);
});
