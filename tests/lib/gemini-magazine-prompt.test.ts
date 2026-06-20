import { generateMagazineModel } from '../../lib/gemini';
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: jest.fn() }));

const mockGenerateContent = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
  }));
  process.env.GEMINI_API_KEY = 'k';
});
afterEach(() => { delete process.env.GEMINI_API_KEY; });

it('instructs full, specific, faithful sentences for bullet text', async () => {
  mockGenerateContent.mockResolvedValueOnce({
    response: { text: () => JSON.stringify({ sections: [{ lead: 'L', bullets: [{ label: 'A', text: 'B' }, { label: 'C', text: 'D' }, { label: 'E', text: 'F' }] }] }) },
  });
  await generateMagazineModel([{ title: 'S', prose: 'p' }], 'en');
  const prompt = mockGenerateContent.mock.calls[0][0] as string;
  expect(prompt).toMatch(/complete.*sentence/i);
  expect(prompt).toMatch(/preserve only concrete specifics/i);
  expect(prompt).toMatch(/do not (manufacture|invent)/i);
});
