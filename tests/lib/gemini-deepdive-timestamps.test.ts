import type { TranscriptSegment } from '../../lib/transcript-timestamps';

const generateContent = jest.fn(async () => ({ response: { text: () => '## A\n\n[[TS:0]]\n\nbody\n\n## B\n\n[[TS:1]]\n\nmore' } }));
jest.mock('@google/generative-ai', () => ({
  ...jest.requireActual('@google/generative-ai'),
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent }),
  })),
}));

const SEGMENTS: TranscriptSegment[] = [
  { text: 'intro', offset: 0, duration: 60 },
  { text: 'middle', offset: 60, duration: 60 },
];

describe('generateDeepDiveFromTranscript with timestamps', () => {
  beforeEach(() => { generateContent.mockClear(); process.env.GEMINI_API_KEY = 'k'; });

  it('embeds the indexed transcript + token instruction and resolves tokens to ▶ lines', async () => {
    const { generateDeepDiveFromTranscript } = await import('../../lib/gemini');
    const out = await generateDeepDiveFromTranscript(SEGMENTS, 'en', 'vid123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = (generateContent.mock.calls as any)[0][0] as string;
    expect(prompt).toContain('[0 @0:00] intro');
    expect(prompt).toContain('[[TS:<index>]]');
    expect(out).toContain('▶ [0:00–1:00](https://www.youtube.com/watch?v=vid123&t=0s)');
    expect(out).not.toContain('[[TS:');
  });

  it('respects the ko language (prompt says respond in Korean)', async () => {
    const { generateDeepDiveFromTranscript } = await import('../../lib/gemini');
    await generateDeepDiveFromTranscript(SEGMENTS, 'ko', 'vid123');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prompt = (generateContent.mock.calls as any)[0][0] as string;
    expect(prompt).toContain('Korean (한국어)');
  });

  it('retries once when attempt 1 lacks ▶, then resolves on attempt 2', async () => {
    // Cast to jest.Mock to allow overriding the inferred literal return type with different text fixtures.
    (generateContent as jest.Mock)
      .mockResolvedValueOnce({ response: { text: () => '## A\n\nbody\n\n## B\n\nmore' } })
      .mockResolvedValueOnce({ response: { text: () => '## A\n\n[[TS:0]]\n\nbody\n\n## B\n\n[[TS:1]]\n\nmore' } });
    const { generateDeepDiveFromTranscript } = await import('../../lib/gemini');
    const out = await generateDeepDiveFromTranscript(SEGMENTS, 'en', 'vid123');
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(out).toContain('▶');
  });
});
