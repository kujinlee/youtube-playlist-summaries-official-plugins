import { generateMagazineModel } from '../../lib/gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

const mockGenerateContent = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
  }));
  process.env.GEMINI_API_KEY = 'test-api-key';
});
afterEach(() => { delete process.env.GEMINI_API_KEY; });

const input = [
  { title: 'The Foundation', prose: 'Data and tokenization prose.' },
  { title: 'Conclusion', prose: 'Wrap up prose.' },
];

function reply(obj: unknown) {
  mockGenerateContent.mockResolvedValueOnce({ response: { text: () => JSON.stringify(obj) } });
}
// 3 bullets = the schema minimum, so these fixtures pass Zod and exercise the count guard / happy path.
const bul = (n = 3) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, text: `t${i}` }));

describe('generateMagazineModel', () => {
  it('returns a validated model on a well-formed response', async () => {
    reply({ sections: [
      { lead: 'A.', bullets: [{ label: 'Source', text: 'Crawl.' }, { label: 'B', text: 'b' }, { label: 'C', text: 'c' }] },
      { lead: 'B.', bullets: bul(3) },
    ]});
    const out = await generateMagazineModel(input, 'en');
    expect(out.sections).toHaveLength(2);
    expect(out.sections[0].bullets[0].label).toBe('Source');
  });

  it('throws when the section count does not match the input', async () => {
    // Schema-valid single section (3 bullets) but input has 2 → the count guard, not Zod, must fire.
    reply({ sections: [{ lead: 'only one', bullets: bul(3) }] });
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/section count/i);
  });

  it('throws on malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => 'not json' } });
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/magazine/i);
  });

  it('throws on schema-invalid output', async () => {
    reply({ sections: [{ lead: '', bullets: [] }, { lead: 'b', bullets: [] }] });
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/magazine/i);
  });

  it('throws when GEMINI_API_KEY is not set', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateMagazineModel(input, 'en')).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
