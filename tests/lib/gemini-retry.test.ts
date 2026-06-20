/**
 * Unit tests for the generateJson retry helper in lib/gemini.ts.
 * All tests use baseDelayMs=0 so no timers are needed.
 */
import { generateJson } from '../../lib/gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import { z } from 'zod';

jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

const mockGenerateContent = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

/** Minimal schema for tests. */
const TestSchema = z.object({ value: z.string() });

function makeModel(): GenerativeModel {
  const client = new GoogleGenerativeAI('test-key');
  return client.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

function okResponse(value: string) {
  return { response: { text: () => JSON.stringify({ value }) } };
}

function badJsonResponse() {
  return { response: { text: () => 'not-valid-json{{{' } };
}

describe('generateJson', () => {
  it('resolves on first try when Gemini returns valid JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce(okResponse('hello'));

    const result = await generateJson(makeModel(), 'prompt', TestSchema, 'test', 2, 0);

    expect(result).toEqual({ value: 'hello' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('recovers when attempt 1 returns malformed JSON and attempt 2 returns valid JSON', async () => {
    mockGenerateContent
      .mockResolvedValueOnce(badJsonResponse())
      .mockResolvedValueOnce(okResponse('recovered'));

    const result = await generateJson(makeModel(), 'prompt', TestSchema, 'test', 2, 0);

    expect(result).toEqual({ value: 'recovered' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('rejects with a SyntaxError after all retries when JSON is always malformed', async () => {
    mockGenerateContent.mockResolvedValue(badJsonResponse());

    await expect(
      generateJson(makeModel(), 'prompt', TestSchema, 'test', 2, 0),
    ).rejects.toThrow(SyntaxError);

    // retries=2 means 3 total attempts (attempt 0, 1, 2)
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it('recovers when attempt 1 passes JSON-parse but fails schema validation, and attempt 2 succeeds', async () => {
    const wrongShape = { response: { text: () => JSON.stringify({ wrong: 'field' }) } };
    mockGenerateContent
      .mockResolvedValueOnce(wrongShape)
      .mockResolvedValueOnce(okResponse('fixed'));

    const result = await generateJson(makeModel(), 'prompt', TestSchema, 'test', 2, 0);

    expect(result).toEqual({ value: 'fixed' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('rejects with the last error after all attempts exhaust on persistent schema failures', async () => {
    const wrongShape = { response: { text: () => JSON.stringify({ wrong: 'field' }) } };
    mockGenerateContent.mockResolvedValue(wrongShape);

    await expect(
      generateJson(makeModel(), 'prompt', TestSchema, 'test', 2, 0),
    ).rejects.toThrow(); // Zod validation error

    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });
});
