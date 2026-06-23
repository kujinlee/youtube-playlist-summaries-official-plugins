import { generateSummary, extractQuickView, generateMagazineModel } from '../../lib/gemini';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

jest.mock('@google/generative-ai', () => {
  const actual = jest.requireActual('@google/generative-ai');
  return { ...actual, GoogleGenerativeAI: jest.fn() };
});

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockGetGenerativeModel.mockReturnValue({ generateContent: mockGenerateContent });
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});
afterEach(() => { delete process.env.GEMINI_API_KEY; });

function reply(obj: unknown) {
  mockGenerateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(obj) } });
}

/** The generationConfig of the most recent getGenerativeModel() call. */
function lastConfig(): any {
  const calls = mockGetGenerativeModel.mock.calls;
  return calls[calls.length - 1][0].generationConfig;
}

const segments = [{ text: 'hello world', offset: 0, duration: 5 }];

describe('responseSchema (controlled generation) is wired into every JSON call site', () => {
  it('generateMagazineModel constrains output to the magazine object schema', async () => {
    reply({ sections: [
      { lead: 'A.', bullets: [{ label: 'a', text: 'a' }, { label: 'b', text: 'b' }, { label: 'c', text: 'c' }] },
    ]});
    await generateMagazineModel([{ title: 'T', prose: 'p' }], 'en');

    const cfg = lastConfig();
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseSchema.type).toBe(SchemaType.OBJECT);
    // Exact required set (not arrayContaining) so an added/removed required field fails CI — drift guard.
    expect(cfg.responseSchema.required).toEqual(['sections']);
    // Mirrors Zod's z.array(...).min(1) so an empty sections array can't pass the API constraint.
    expect(cfg.responseSchema.properties.sections.minItems).toBe(1);
    const bullets = cfg.responseSchema.properties.sections.items.properties.bullets;
    expect(bullets.type).toBe(SchemaType.ARRAY);
    // Mirrors the Zod 3–7 constraint so the model is biased to produce it directly.
    expect(bullets.minItems).toBe(3);
    expect(bullets.maxItems).toBe(7);
  });

  it('generateSummary constrains output to the summary object schema', async () => {
    const fixture = {
      summary: '## 1. X\nbody',
      ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    };
    // Two replies: the guard retries once when no ▶ is resolved (segments present).
    reply(fixture);
    reply(fixture);
    await generateSummary(segments, 'en', 'vid123');

    const cfg = lastConfig();
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseSchema.type).toBe(SchemaType.OBJECT);
    // Exact required set: only summary + ratings; videoType/audience/tags/tldr/takeaways stay optional.
    expect(cfg.responseSchema.required).toEqual(['summary', 'ratings']);
    expect(cfg.responseSchema.properties.ratings.type).toBe(SchemaType.OBJECT);
    // Enum classification fields are constrained at generation (mirrors the Zod enums), so an
    // out-of-set value can't pass the API schema and force a no-op identical-prompt retry.
    expect(cfg.responseSchema.properties.videoType.format).toBe('enum');
    expect(cfg.responseSchema.properties.videoType.enum).toEqual(
      ['Tutorial', 'Analysis', 'Case Study', 'Framework', 'Demo', 'Interview'],
    );
    expect(cfg.responseSchema.properties.audience.format).toBe('enum');
    expect(cfg.responseSchema.properties.audience.enum).toEqual(
      ['Beginner', 'Intermediate', 'Advanced'],
    );
  });

  it('extractQuickView constrains output to the quick-view object schema', async () => {
    reply({ tldr: 'This video explains X.', takeaways: ['a', 'b'] });
    await extractQuickView('## summary body');

    const cfg = lastConfig();
    expect(cfg.responseMimeType).toBe('application/json');
    expect(cfg.responseSchema.type).toBe(SchemaType.OBJECT);
    expect(cfg.responseSchema.required).toEqual(['tldr', 'takeaways']);
    expect(cfg.responseSchema.properties.takeaways.type).toBe(SchemaType.ARRAY);
    // Mirrors Zod's .min(1).max(5) on takeaways.
    expect(cfg.responseSchema.properties.takeaways.minItems).toBe(1);
    expect(cfg.responseSchema.properties.takeaways.maxItems).toBe(5);
  });
});
