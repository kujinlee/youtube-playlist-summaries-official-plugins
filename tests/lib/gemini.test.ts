import { generateDeepDive, generateSummary, extractQuickView, fixSummary, transcribeViaGemini } from '../../lib/gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { TranscriptSegment } from '../../lib/transcript-timestamps';

const SEGS: TranscriptSegment[] = [
  { text: 'intro', offset: 0, duration: 5 },
  { text: 'core', offset: 135, duration: 10 },
];

jest.mock('@google/generative-ai', () => ({
  ...jest.requireActual('@google/generative-ai'),
  GoogleGenerativeAI: jest.fn(),
}));

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent });
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe('generateSummary', () => {
  it('returns summary text and ratings with values in range 1–5', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'A great video about machine learning',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.summary).toBe('A great video about machine learning');
    for (const value of Object.values(result.ratings)) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('computes overallScore as arithmetic mean of 5 ratings', async () => {
    // (2+4+2+4+3)/5 = 3.0
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 2, depth: 4, originality: 2, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.overallScore).toBeCloseTo(3.0);
  });

  it('wraps Gemini API errors with a clear message and preserves cause', async () => {
    const apiError = new Error('API_KEY_INVALID');
    // mockRejectedValue (not Once) so all retry attempts fail with the same error,
    // ensuring the final .cause is the original apiError after retries exhaust.
    mockGenerateContent.mockRejectedValue(apiError);

    const err = await generateSummary(SEGS, 'en', 'vid123').catch((e) => e);

    expect(err.message).toMatch(/Gemini summary failed/);
    expect(err.cause).toBe(apiError);
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateSummary(SEGS, 'en', 'vid123')).rejects.toThrow('GEMINI_API_KEY is not set');
  });

  it('includes Korean language instruction in prompt for ko language', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: '머신러닝에 관한 훌륭한 비디오',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    await generateSummary(SEGS, 'ko', 'vid123');

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt.toLowerCase()).toMatch(/korean|한국어/);
  });

  it('throws when model returns malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not valid json at all' },
    });

    await expect(generateSummary(SEGS, 'en', 'vid123')).rejects.toThrow('Gemini summary failed');
  });

  it('throws when model returns out-of-range rating values', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 6, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    await expect(generateSummary(SEGS, 'en', 'vid123')).rejects.toThrow('Gemini summary failed');
  });

  it('returns videoType and audience when Gemini includes them', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
          videoType: 'Tutorial',
          audience: 'Advanced',
        }),
      },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.videoType).toBe('Tutorial');
    expect(result.audience).toBe('Advanced');
  });

  it('returns undefined videoType and audience when Gemini omits them', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.videoType).toBeUndefined();
    expect(result.audience).toBeUndefined();
  });

  it('rejects invalid videoType value', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 1, depth: 1, originality: 1, recency: 1, completeness: 1 },
          videoType: 'NotAValidType',
        }),
      },
    });

    await expect(generateSummary(SEGS, 'en', 'vid123')).rejects.toThrow('Gemini summary failed');
  });

  it('includes videoType and audience in prompt instructions', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 1, depth: 1, originality: 1, recency: 1, completeness: 1 },
        }),
      },
    });

    await generateSummary(SEGS, 'en', 'vid123');

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toMatch(/videoType/);
    expect(prompt).toMatch(/audience/);
  });

  it('rejects unexpected top-level fields in model response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 1, depth: 1, originality: 1, recency: 1, completeness: 1 },
          unexpectedField: 'hallucinated data',
        }),
      },
    });

    await expect(generateSummary(SEGS, 'en', 'vid123')).rejects.toThrow('Gemini summary failed');
  });

  it('returns tags array when Gemini includes them', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
          tags: ['machine-learning', 'neural-networks', 'backpropagation'],
        }),
      },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.tags).toEqual(['machine-learning', 'neural-networks', 'backpropagation']);
  });

  it('returns undefined tags when Gemini omits them', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.tags).toBeUndefined();
  });

  it('includes tags and structured ## section instructions in prompt', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 1, depth: 1, originality: 1, recency: 1, completeness: 1 },
        }),
      },
    });

    await generateSummary(SEGS, 'en', 'vid123');

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toMatch(/tags/);
    expect(prompt).toMatch(/## 1\./);
    expect(prompt).toMatch(/Conclusion/);
  });
});

describe('generateSummary — tldr and takeaways fields', () => {
  it('returns tldr and takeaways when Gemini includes them', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'body text',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
          tldr: 'This video teaches AI agents.',
          takeaways: ['Agents use tools', 'Memory matters'],
        }),
      },
    });
    const result = await generateSummary(SEGS, 'en', 'vid123');
    expect(result.tldr).toBe('This video teaches AI agents.');
    expect(result.takeaways).toEqual(['Agents use tools', 'Memory matters']);
  });

  it('returns undefined tldr and takeaways when Gemini omits them', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          summary: 'body text',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });
    const result = await generateSummary(SEGS, 'en', 'vid123');
    expect(result.tldr).toBeUndefined();
    expect(result.takeaways).toBeUndefined();
  });
});

describe('generateSummary — timestamps', () => {
  it('sends an indexed transcript and asks for [[TS:i]] tokens', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify({ summary: '## 1. A\nbody', ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 } }) },
    });

    await generateSummary(SEGS, 'en', 'vid123');

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toContain('[0 @0:00] intro');
    expect(prompt).toContain('[1 @2:15] core');
    expect(prompt).toContain('[[TS:');
  });

  it('resolves [[TS:i]] tokens in the returned summary into ▶ lines', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({
        summary: '## 1. A\n[[TS:0]]\n\nbody a\n\n## Conclusion\n[[TS:1]]\n\nend',
        ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
      }) },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.summary).toContain('▶ [0:00–2:15](https://www.youtube.com/watch?v=vid123&t=0s)');
    expect(result.summary).not.toMatch(/\[\[TS:/);
  });

  it('degrades to no timestamps when Gemini emits an out-of-range index', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => JSON.stringify({
        summary: '## 1. A\n[[TS:9]]\n\nbody',
        ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
      }) },
    });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(result.summary).not.toMatch(/▶|\[\[TS:/);
    expect(result.summary).toContain('## 1. A');
    expect(result.summary).toContain('body');
  });
});

describe('generateSummary — timestamp guard', () => {
  const withTs = '## 1. A\n[[TS:0]]\n\nbody\n\n## Conclusion\n[[TS:1]]\n\nend';
  const noTs = '## 1. A\n\nbody\n\n## Conclusion\n\nend';
  const ratings = { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 };

  it('retries once when attempt 1 has no ▶ and attempt 2 does (segments present)', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({ summary: noTs, ratings }) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({ summary: withTs, ratings }) } });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.summary).toContain('▶');
  });

  it('warns and returns the last result when both attempts lack ▶ (segments present)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ summary: noTs, ratings }) } });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.summary).not.toContain('▶');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[timestamp-miss] vid123'));
    warn.mockRestore();
  });

  it('does NOT retry or warn when there are no segments', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ summary: noTs, ratings }) } });

    await generateSummary([], 'en', 'vid123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[timestamp-miss]'));
    warn.mockRestore();
  });
});

describe('extractQuickView', () => {
  it('returns tldr and takeaways from summary markdown', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          tldr: 'This video explains RAG pipelines.',
          takeaways: ['RAG improves accuracy', 'Chunking matters', 'Embeddings are key'],
        }),
      },
    });
    const result = await extractQuickView('## 1. Introduction\nSome content.');
    expect(result.tldr).toBe('This video explains RAG pipelines.');
    expect(result.takeaways).toHaveLength(3);
  });

  it('throws with a clear message when Gemini returns invalid JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not-json' },
    });
    await expect(extractQuickView('content')).rejects.toThrow('Gemini quick-view extraction failed');
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(extractQuickView('content')).rejects.toThrow('GEMINI_API_KEY is not set');
  });
});

describe('fixSummary', () => {
  const MARKDOWN = '# Title\n\n## 1. Introduction\nThis is a video about Clawcode.';
  const CORRECTIONS = "Fix 'Clawcode' → 'Claude Code'";

  it('returns corrected markdown text from Gemini', async () => {
    const corrected = '# Title\n\n## 1. Introduction\nThis is a video about Claude Code.';
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => corrected },
    });
    const result = await fixSummary(MARKDOWN, CORRECTIONS);
    expect(result).toBe(corrected);
  });

  it('includes correction instructions in the prompt sent to Gemini', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'corrected content' },
    });
    await fixSummary(MARKDOWN, CORRECTIONS);
    const [prompt] = mockGenerateContent.mock.calls[0] as [string];
    expect(prompt).toContain(CORRECTIONS);
    expect(prompt).toContain(MARKDOWN);
  });

  it('throws with a clear message when Gemini returns empty content', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => '' },
    });
    await expect(fixSummary(MARKDOWN, CORRECTIONS)).rejects.toThrow('Gemini summary fix failed');
  });

  it('wraps Gemini API errors with a clear message', async () => {
    const apiError = new Error('network error');
    mockGenerateContent.mockRejectedValueOnce(apiError);
    const err = await fixSummary(MARKDOWN, CORRECTIONS).catch((e) => e);
    expect(err.message).toMatch(/Gemini summary fix failed/);
    expect(err.cause).toBe(apiError);
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(fixSummary(MARKDOWN, CORRECTIONS)).rejects.toThrow('GEMINI_API_KEY is not set');
  });
});

describe('generateDeepDive', () => {
  it('passes YouTube URL as fileData.fileUri with mimeType and includes Korean in prompt', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'Deep analysis text...' },
    });

    await generateDeepDive('https://www.youtube.com/watch?v=abc123', 'ko');

    const request = mockGenerateContent.mock.calls[0][0] as {
      contents: Array<{ parts: Array<{ fileData?: { fileUri: string; mimeType: string }; text?: string }> }>;
    };
    expect(request.contents[0].parts[0].fileData).toEqual({
      fileUri: 'https://www.youtube.com/watch?v=abc123',
      mimeType: 'video/mp4',
    });
    const textPart = request.contents[0].parts[1].text ?? '';
    expect(textPart.toLowerCase()).toMatch(/korean|한국어/);
  });

  it('wraps Gemini API errors with a clear message and preserves cause', async () => {
    const apiError = new Error('quota exceeded');
    mockGenerateContent.mockRejectedValueOnce(apiError);

    const err = await generateDeepDive('https://www.youtube.com/watch?v=test', 'en').catch((e) => e);

    expect(err.message).toMatch(/Gemini deep-dive failed/);
    expect(err.cause).toBe(apiError);
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      generateDeepDive('https://www.youtube.com/watch?v=test', 'en'),
    ).rejects.toThrow('GEMINI_API_KEY is not set');
  });
});

describe('transcribeViaGemini', () => {
  const VIDEO_URL = 'https://www.youtube.com/watch?v=vidGated';

  function mockTranscriptResponse(segments: Array<{ startSec: number; text: string }>) {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => JSON.stringify({ segments }) },
    });
  }

  it('sends the YouTube URL as fileData and requests low media resolution', async () => {
    mockTranscriptResponse([{ startSec: 0, text: 'hello world' }]);

    await transcribeViaGemini(VIDEO_URL, 'vidGated', 600);

    const config = mockGetGenerativeModel.mock.calls[0][0] as {
      model: string;
      generationConfig: { responseMimeType: string; mediaResolution: string };
    };
    expect(config.generationConfig.responseMimeType).toBe('application/json');
    expect(config.generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_LOW');

    const request = mockGenerateContent.mock.calls[0][0] as {
      contents: Array<{ parts: Array<{ fileData?: { fileUri: string; mimeType: string }; text?: string }> }>;
    };
    expect(request.contents[0].parts[0].fileData).toEqual({ fileUri: VIDEO_URL, mimeType: 'video/mp4' });
    expect(request.contents[0].parts[1].text).toMatch(/entire video/i);
  });

  it('maps to TranscriptSegment[] — sorted, deduped, gap durations, drops empties', async () => {
    mockTranscriptResponse([
      { startSec: 10, text: 'second' },
      { startSec: 0, text: 'first' },
      { startSec: 10, text: 'dup-dropped' },   // equal startSec → dropped (keep first after sort)
      { startSec: 20, text: '   ' },            // empty after trim → dropped
      { startSec: 30, text: 'last' },
    ]);

    const segs = await transcribeViaGemini(VIDEO_URL, 'vidGated', 600);

    expect(segs).toEqual([
      { text: 'first', offset: 0, duration: 10 },
      { text: 'second', offset: 10, duration: 20 },
      { text: 'last', offset: 30, duration: 5 },
    ]);
  });

  it('warns on low coverage but still returns the partial transcript', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockTranscriptResponse([{ startSec: 0, text: 'a' }, { startSec: 30, text: 'b' }]); // lastOffset 30 / 600 = 5%

    const segs = await transcribeViaGemini(VIDEO_URL, 'vidGated', 600);

    expect(segs).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith('[transcribe-coverage] low coverage 5% for vidGated');
    warn.mockRestore();
  });

  it('throws after retries when Gemini yields zero usable segments', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ segments: [] }) } });

    await expect(transcribeViaGemini(VIDEO_URL, 'vidGated', 600, 1, 0)).rejects.toThrow(/Gemini transcription failed for vidGated/);
    warn.mockRestore();
  });

  it('throws after retries on invalid JSON', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue({ response: { text: () => 'not json' } });

    await expect(transcribeViaGemini(VIDEO_URL, 'vidGated', 600, 1, 0)).rejects.toThrow(/Gemini transcription failed for vidGated/);
    warn.mockRestore();
  });

  it('does not warn or divide by zero when durationSeconds is 0', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockTranscriptResponse([{ startSec: 0, text: 'a' }, { startSec: 30, text: 'b' }]);

    const segs = await transcribeViaGemini(VIDEO_URL, 'vidGated', 0);

    expect(segs).toHaveLength(2);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[transcribe-coverage]'));
    warn.mockRestore();
  });

  it('drops an empty-text row even when it shares a startSec with a non-empty row', async () => {
    mockTranscriptResponse([
      { startSec: 40, text: '   ' },   // empty; would sort first among the equal-startSec pair
      { startSec: 40, text: 'kept' },
    ]);

    const segs = await transcribeViaGemini(VIDEO_URL, 'vidGated', 100);

    // filter (drop-empty) precedes sort+dedupe, so the empty row is gone before dedupe runs.
    expect(segs).toEqual([{ text: 'kept', offset: 40, duration: 5 }]);
  });
});
