import { generateDeepDive, generateSummary, extractQuickView, fixSummary } from '../../lib/gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(),
}));

const mockGenerateContent = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe('generateSummary', () => {
  it('returns summary text and ratings with values in range 1–5', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'A great video about machine learning',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary('transcript text here', 'en');

    expect(result.summary).toBe('A great video about machine learning');
    for (const value of Object.values(result.ratings)) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(5);
    }
  });

  it('computes overallScore as arithmetic mean of 5 ratings', async () => {
    // (2+4+2+4+3)/5 = 3.0
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 2, depth: 4, originality: 2, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary('transcript', 'en');

    expect(result.overallScore).toBeCloseTo(3.0);
  });

  it('wraps Gemini API errors with a clear message and preserves cause', async () => {
    const apiError = new Error('API_KEY_INVALID');
    mockGenerateContent.mockRejectedValueOnce(apiError);

    const err = await generateSummary('transcript', 'en').catch((e) => e);

    expect(err.message).toMatch(/Gemini summary failed/);
    expect(err.cause).toBe(apiError);
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateSummary('transcript', 'en')).rejects.toThrow('GEMINI_API_KEY is not set');
  });

  it('includes Korean language instruction in prompt for ko language', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: '머신러닝에 관한 훌륭한 비디오',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    await generateSummary('transcript', 'ko');

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt.toLowerCase()).toMatch(/korean|한국어/);
  });

  it('throws when model returns malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: { text: () => 'not valid json at all' },
    });

    await expect(generateSummary('transcript', 'en')).rejects.toThrow('Gemini summary failed');
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

    await expect(generateSummary('transcript', 'en')).rejects.toThrow('Gemini summary failed');
  });

  it('returns videoType and audience when Gemini includes them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
          videoType: 'Tutorial',
          audience: 'Advanced',
        }),
      },
    });

    const result = await generateSummary('transcript', 'en');

    expect(result.videoType).toBe('Tutorial');
    expect(result.audience).toBe('Advanced');
  });

  it('returns undefined videoType and audience when Gemini omits them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary('transcript', 'en');

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

    await expect(generateSummary('transcript', 'en')).rejects.toThrow('Gemini summary failed');
  });

  it('includes videoType and audience in prompt instructions', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 1, depth: 1, originality: 1, recency: 1, completeness: 1 },
        }),
      },
    });

    await generateSummary('transcript', 'en');

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

    await expect(generateSummary('transcript', 'en')).rejects.toThrow('Gemini summary failed');
  });

  it('returns tags array when Gemini includes them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
          tags: ['machine-learning', 'neural-networks', 'backpropagation'],
        }),
      },
    });

    const result = await generateSummary('transcript', 'en');

    expect(result.tags).toEqual(['machine-learning', 'neural-networks', 'backpropagation']);
  });

  it('returns undefined tags when Gemini omits them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });

    const result = await generateSummary('transcript', 'en');

    expect(result.tags).toBeUndefined();
  });

  it('includes tags and structured ## section instructions in prompt', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'test',
          ratings: { usefulness: 1, depth: 1, originality: 1, recency: 1, completeness: 1 },
        }),
      },
    });

    await generateSummary('transcript', 'en');

    const prompt = mockGenerateContent.mock.calls[0][0] as string;
    expect(prompt).toMatch(/tags/);
    expect(prompt).toMatch(/## 1\./);
    expect(prompt).toMatch(/Conclusion/);
  });
});

describe('generateSummary — tldr and takeaways fields', () => {
  it('returns tldr and takeaways when Gemini includes them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'body text',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
          tldr: 'This video teaches AI agents.',
          takeaways: ['Agents use tools', 'Memory matters'],
        }),
      },
    });
    const result = await generateSummary('transcript', 'en');
    expect(result.tldr).toBe('This video teaches AI agents.');
    expect(result.takeaways).toEqual(['Agents use tools', 'Memory matters']);
  });

  it('returns undefined tldr and takeaways when Gemini omits them', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => JSON.stringify({
          summary: 'body text',
          ratings: { usefulness: 4, depth: 3, originality: 5, recency: 4, completeness: 3 },
        }),
      },
    });
    const result = await generateSummary('transcript', 'en');
    expect(result.tldr).toBeUndefined();
    expect(result.takeaways).toBeUndefined();
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
