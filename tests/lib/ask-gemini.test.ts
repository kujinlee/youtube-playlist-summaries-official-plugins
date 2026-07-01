import {
  buildGeminiPrompt, buildGeminiUrl,
  buildWholeVideoPrompt, buildSectionPrompt, AI_PROVIDER,
} from '../../lib/ask-gemini';
import type { Video } from '@/types';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/abc', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

const EN = "Please review this video first; I'd like to ask questions about it: https://youtu.be/abc";
const KO = '아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: https://youtu.be/abc';

describe('buildGeminiPrompt', () => {
  it('builds the English prompt with the URL appended', () => {
    expect(buildGeminiPrompt(video({ language: 'en' }))).toBe(EN);
  });

  it('builds the Korean prompt with the URL appended', () => {
    expect(buildGeminiPrompt(video({ language: 'ko' }))).toBe(KO);
  });

  it('falls back to English for an unexpected language', () => {
    const v = video({ language: 'fr' as unknown as Video['language'] });
    expect(buildGeminiPrompt(v)).toBe(EN);
  });
});

describe('buildGeminiUrl', () => {
  it('encodes the prompt and sets autosubmit=false', () => {
    const url = buildGeminiUrl('hi there: https://youtu.be/abc?t=1&x=2');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://gemini.google.com/app');
    expect(u.searchParams.get('prompt')).toBe('hi there: https://youtu.be/abc?t=1&x=2');
    expect(u.searchParams.get('autosubmit')).toBe('false');
  });

  it('encodes Hangul and reserved characters in the prompt value', () => {
    const url = buildGeminiUrl('질문: a&b?');
    expect(url).toContain('prompt=' + encodeURIComponent('질문: a&b?'));
    expect(url).toContain('&autosubmit=false');
    expect(new URL(url).searchParams.get('prompt')).toBe('질문: a&b?');
  });
});

const URL_W = 'https://www.youtube.com/watch?v=abc';

describe('buildWholeVideoPrompt', () => {
  it('en', () => {
    expect(buildWholeVideoPrompt(URL_W, 'en'))
      .toBe(`Please review this video first; I'd like to ask questions about it: ${URL_W}`);
  });
  it('ko', () => {
    expect(buildWholeVideoPrompt(URL_W, 'ko'))
      .toBe(`아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: ${URL_W}`);
  });
});

describe('buildSectionPrompt', () => {
  it('en with range', () => {
    expect(buildSectionPrompt(URL_W, 75, 130, 'en'))
      .toBe(`Please review this section of the video (from 1:15 to 2:10), then I'd like to ask questions about it: ${URL_W}&t=75s`);
  });
  it('en onward (null end)', () => {
    expect(buildSectionPrompt(URL_W, 75, null, 'en'))
      .toBe(`Please review this section of the video (from 1:15 onward), then I'd like to ask questions about it: ${URL_W}&t=75s`);
  });
  it('ko with range', () => {
    expect(buildSectionPrompt(URL_W, 75, 130, 'ko'))
      .toBe(`이 영상의 해당 구간(1:15부터 2:10까지)을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: ${URL_W}&t=75s`);
  });
  it('ko onward (null end)', () => {
    expect(buildSectionPrompt(URL_W, 75, null, 'ko'))
      .toBe(`이 영상의 해당 구간(1:15부터)을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: ${URL_W}&t=75s`);
  });
});

describe('AI_PROVIDER', () => {
  it('builds a Gemini url that percent-encodes only the prompt', () => {
    const url = AI_PROVIDER.buildUrl('hi: https://www.youtube.com/watch?v=abc&t=1s');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://gemini.google.com/app');
    expect(u.searchParams.get('prompt')).toBe('hi: https://www.youtube.com/watch?v=abc&t=1s');
    expect(u.searchParams.get('autosubmit')).toBe('false');
  });
});
