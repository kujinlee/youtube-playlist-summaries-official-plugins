import fs from 'fs';
import os from 'os';
import path from 'path';
import { GET } from '../../app/api/html/[id]/route';

let dir: string;
const VIDEO_ID = 'vidDDpipe1';

// A realistic deep-dive body: ### bold-numbered headings + an ```ascii diagram + KO-friendly text.
const DD_MD = `---
video_id: "vidDDpipe1"
lang: EN
score: 4.4
---

# The ABCs (Deep Dive)

**Channel:** Google Cloud Tech | **Duration:** 13:54 | **URL:** https://youtu.be/x

---

Of course. Here is a comprehensive analysis.

### **1. Architecture**
The protocol routes messages.

\`\`\`ascii
+--------+      +--------+
| Agent  | ---> | Tool   |
+--------+      +--------+
\`\`\`
`;

function writeIndex(v: Record<string, unknown>) {
  fs.writeFileSync(path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos: [v] }));
}
function video(extra: Record<string, unknown> = {}) {
  return {
    id: VIDEO_ID, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'a.md',
    deepDiveMd: 'abc-deep-dive.md', summaryHtml: null,
    processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  };
}
const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };
const req = () => new Request(
  `http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=deep-dive`);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-ddpipe-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('renders a real deep-dive end-to-end: ASCII preserved in <pre>, frontmatter gone', async () => {
  fs.writeFileSync(path.join(dir, 'abc-deep-dive.md'), DD_MD);
  writeIndex(video());
  const res = await GET(req(), ctx);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/<pre><code[^>]*>[\s\S]*Agent[\s\S]*Tool[\s\S]*<\/code><\/pre>/); // ascii monospace
  expect(html).not.toContain('video_id:'); // frontmatter stripped
  expect(html).toContain('Of course. Here is a comprehensive analysis.'); // faithful
});

it('works for a Korean-slug deep-dive filename (B-1)', async () => {
  writeIndex(video({ deepDiveMd: '모든-곳에-구글-deep-dive.md' }));
  fs.writeFileSync(path.join(dir, '모든-곳에-구글-deep-dive.md'), DD_MD);
  expect((await GET(req(), ctx)).status).toBe(200);
});
