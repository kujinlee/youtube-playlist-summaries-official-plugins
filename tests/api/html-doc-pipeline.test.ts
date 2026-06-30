/**
 * Integration test — the connected pipeline that the unit tests and the (route-stubbed) E2E
 * each only cover in isolation: real orchestrator (`runHtmlDoc`) writes the cached HTML + index,
 * then the real serve route (`GET /api/html/[id]`) reads the index and serves that exact file.
 * Only Gemini is mocked (the project's external boundary). Includes a Korean round-trip.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runHtmlDoc } from '../../lib/html-doc/generate';
import { GET } from '../../app/api/html/[id]/route';
import * as gemini from '../../lib/gemini';

jest.mock('../../lib/gemini');
const mockTransform = gemini.generateMagazineModel as jest.Mock;

let dir: string;
const VIDEO_ID = 'vidKO1234';

const KO_MD = `---
video_id: "vidKO1234"
lang: KO
score: 4
---

# 한국어 영상 제목

**Channel:** 채널 | **Duration:** 9:58 | **URL:** https://youtu.be/k

> [!summary] Quick Reference
> **TL;DR:** 핵심 요약입니다.
>
> **Key Takeaways:**
> - 요점 하나.
>
> **Concepts:** 가 · 나

---

## 1. 첫 번째 섹션
첫 번째 섹션 본문.
---
## 결론
마무리 본문.
`;

function writeIndex(videos: unknown[]) {
  fs.writeFileSync(
    path.join(dir, 'playlist-index.json'),
    JSON.stringify({ playlistUrl: 'https://x.test/p', outputFolder: dir, videos }, null, 2),
  );
}

function baseVideo() {
  return {
    id: VIDEO_ID, title: '한국어 영상 제목', youtubeUrl: 'https://youtu.be/k', language: 'ko',
    durationSeconds: 598, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: 'ko-video.md', deepDiveMd: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z',
  };
}

const KO_MODEL = {
  sections: [
    { lead: '첫 섹션 요약 문장.', bullets: [
      { label: '출처', text: '인터넷 텍스트.' }, { label: '방법', text: '토큰화.' }, { label: '규모', text: '대규모.' },
    ] },
    { lead: '마무리 요약 문장.', bullets: [
      { label: '단계', text: '세 단계.' }, { label: '주의', text: '환각 주의.' }, { label: '미래', text: '멀티모달.' },
    ] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.homedir(), '.tmp-htmldoc-int-'));
  fs.writeFileSync(path.join(dir, 'ko-video.md'), KO_MD);
  writeIndex([baseVideo()]);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const ctx = { params: Promise.resolve({ id: VIDEO_ID }) };
const serveReq = () =>
  new Request(`http://localhost/api/html/${VIDEO_ID}?outputFolder=${encodeURIComponent(dir)}&type=summary`);

it('real orchestrator output is served end-to-end by the serve route (KO round-trip)', async () => {
  mockTransform.mockResolvedValueOnce(KO_MODEL);

  await runHtmlDoc(VIDEO_ID, dir, () => {});

  const res = await GET(serveReq(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/text\/html/);

  const html = await res.text();
  expect(html).toContain('한국어 영상 제목');                           // real title rendered
  expect(html).toContain('첫 섹션 요약 문장.');                          // real transformed lead
  expect(html).toContain('인터넷 텍스트.');                              // real transformed bullet
  expect(html).toContain('<meta name="source-md" content="ko-video.md">'); // provenance from orchestrator
  expect(html).toContain('Nanum Myeongjo');                              // KO serif fallback present
});

it('serve route 404s before generation and 200s after (cache lifecycle)', async () => {
  const before = await GET(serveReq(), ctx);
  expect(before.status).toBe(404); // summaryHtml is null until generation runs

  mockTransform.mockResolvedValueOnce(KO_MODEL);
  await runHtmlDoc(VIDEO_ID, dir, () => {});

  const after = await GET(serveReq(), ctx);
  expect(after.status).toBe(200);
});
