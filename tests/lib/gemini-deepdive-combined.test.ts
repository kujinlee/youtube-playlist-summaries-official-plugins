import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateDeepDiveCombined } from '../../lib/gemini';

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn(),
}));

const generateContent = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent }),
  }));
  process.env.GEMINI_API_KEY = 'k';
  generateContent.mockResolvedValue({ response: { text: () => '## Deep\nbody' } });
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

it('sends fileData(video) + text(transcript) in one contents part list', async () => {
  const out = await generateDeepDiveCombined('https://y/watch?v=v', 'TRANSCRIPT_TEXT', 'en');
  expect(out).toContain('## Deep');
  const req = generateContent.mock.calls[0][0];
  const parts = req.contents[0].parts;
  expect(parts[0]).toEqual({ fileData: { fileUri: 'https://y/watch?v=v', mimeType: 'video/mp4' } });
  expect(parts[1].text).toContain('Ground your analysis in the transcript');
  expect(parts[1].text).toContain('TRANSCRIPT_TEXT');
});

it('wraps transcript in <transcript> tags in the text part', async () => {
  await generateDeepDiveCombined('https://y/watch?v=v', 'TRANSCRIPT_TEXT', 'en');
  const req = generateContent.mock.calls[0][0];
  const textPart: string = req.contents[0].parts[1].text;
  expect(textPart).toContain('<transcript>');
  expect(textPart).toContain('</transcript>');
});

it('uses Korean display name when language is ko', async () => {
  await generateDeepDiveCombined('https://y/watch?v=v', 'TRANSCRIPT_TEXT', 'ko');
  const req = generateContent.mock.calls[0][0];
  const textPart: string = req.contents[0].parts[1].text;
  expect(textPart).toContain('Korean (한국어)');
});

it('throws a wrapped error when generateContent rejects, preserving cause', async () => {
  const apiError = new Error('network failure');
  generateContent.mockRejectedValueOnce(apiError);

  const err = await generateDeepDiveCombined('https://y/watch?v=v', 'T', 'en').catch((e) => e);

  expect(err.message).toBe('Gemini deep-dive (combined) failed: network failure');
  expect(err.cause).toBe(apiError);
});
