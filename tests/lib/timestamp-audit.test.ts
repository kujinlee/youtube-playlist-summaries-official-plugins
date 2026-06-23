import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditTimestamps, hasLeadingTimestamp } from '../../lib/timestamp-audit';

// MUST root the temp dir under $HOME — auditTimestamps → readIndex → assertOutputFolder
// rejects any folder outside the home directory (mirrors tests/lib/deep-dive/ensure.test.ts).
function seed(videos: any[], files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.audit-test-'));
  fs.writeFileSync(path.join(dir, 'playlist-index.json'), JSON.stringify({ videos }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

it('counts only line-leading ▶ and classifies stuck vs would-regen', () => {
  const dir = seed(
    [
      { id: 'a', summaryMd: 'a.md', docVersion: { major: 3, minor: 3 } },          // current, ▶ → withTs
      { id: 'b', summaryMd: 'b.md', docVersion: { major: 2, minor: 0 } },          // old, no ▶ → wouldRegen
      { id: 'c', summaryMd: 'c.md', docVersion: { major: 3, minor: 0 } },          // current, no ▶ → stuck
      { id: 'd', summaryMd: 'd.md' },                                              // absent ver, no ▶ → wouldRegen
      { id: 'e', summaryMd: 'e.md', docVersion: { major: 3, minor: 0 } },          // file missing → mdMissing
    ],
    {
      'a.md': '## 1\n▶ [0:00](u)\n\nbody',
      'b.md': '## 1\n\nbody',
      'c.md': '## 1\n\nbody',
      // No LINE-LEADING ▶: one inline, one indented inside a fence. (/^▶/m has NO fence
      // awareness — a ▶ at column 0 of ANY line, fenced or not, matches; so the fenced ▶ is indented.)
      'd.md': 'see ▶ inline here\n```\n  ▶ indented in fence\n```',
    },
  );
  const r = auditTimestamps(dir);
  expect(r.summaries.total).toBe(5);
  expect(r.summaries.withTs).toBe(1);
  expect(r.summaries.noTsWouldRegen).toBe(2);   // b, d
  expect(r.summaries.noTsStuck).toBe(1);         // c
  expect(r.summaries.mdMissing).toBe(1);         // e
  expect(r.summaries.stuckIds).toEqual(['c']);
  fs.rmSync(dir, { recursive: true, force: true });
});

it('hasLeadingTimestamp ignores fenced/inline ▶', () => {
  expect(hasLeadingTimestamp('▶ at start')).toBe(true);
  expect(hasLeadingTimestamp('text ▶ mid')).toBe(false);
});
