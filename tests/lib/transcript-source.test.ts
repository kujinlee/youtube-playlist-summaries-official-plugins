jest.mock('../../lib/youtube');
jest.mock('../../lib/gemini');

import { resolveTranscriptSegments } from '../../lib/transcript-source';
import * as youtube from '../../lib/youtube';
import * as gemini from '../../lib/gemini';
import type { TranscriptSegment } from '../../lib/transcript-timestamps';

const mockFetchCaptions = jest.mocked(youtube.fetchTranscriptSegments);
const mockTranscribe = jest.mocked(gemini.transcribeViaGemini);

const CAPTIONS: TranscriptSegment[] = [{ text: 'caption', offset: 0, duration: 5 }];
const GEMINI: TranscriptSegment[] = [{ text: 'gemini', offset: 0, duration: 5 }];
const URL = 'https://www.youtube.com/watch?v=vid1';

beforeEach(() => jest.clearAllMocks());

it('returns captions and never calls Gemini when captions succeed', async () => {
  mockFetchCaptions.mockResolvedValueOnce(CAPTIONS);

  const result = await resolveTranscriptSegments('vid1', URL, 600);

  expect(result).toEqual({ segments: CAPTIONS, source: 'captions' });
  expect(mockTranscribe).not.toHaveBeenCalled();
});

it('falls back to Gemini when captions throw', async () => {
  mockFetchCaptions.mockRejectedValueOnce(new Error('Transcript is disabled on this video'));
  mockTranscribe.mockResolvedValueOnce(GEMINI);

  const result = await resolveTranscriptSegments('vid1', URL, 600);

  expect(result).toEqual({ segments: GEMINI, source: 'gemini' });
  expect(mockTranscribe).toHaveBeenCalledWith(URL, 'vid1', 600);
});

it('falls back to Gemini when captions return an empty array', async () => {
  mockFetchCaptions.mockResolvedValueOnce([]);
  mockTranscribe.mockResolvedValueOnce(GEMINI);

  const result = await resolveTranscriptSegments('vid1', URL, 600);

  expect(result).toEqual({ segments: GEMINI, source: 'gemini' });
});

it('throws with videoId + captured caption cause when both sources fail', async () => {
  mockFetchCaptions.mockRejectedValueOnce(new Error('Transcript is disabled on this video'));
  mockTranscribe.mockRejectedValueOnce(new Error('Gemini fetch blocked'));

  await expect(resolveTranscriptSegments('vid1', URL, 600)).rejects.toThrow(
    /transcript unavailable via captions and video for vid1/,
  );
});
