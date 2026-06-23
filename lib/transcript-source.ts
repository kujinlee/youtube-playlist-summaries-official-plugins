import { fetchTranscriptSegments } from './youtube';
import { transcribeViaGemini } from './gemini';
import type { TranscriptSegment } from './transcript-timestamps';

/**
 * Resolve a video's transcript: try YouTube captions first; if they throw or come back empty, fall
 * back to transcribing the video via Gemini (URL → low-res). Throws only when BOTH fail, including the
 * captured caption error as the cause so the gated-caption case stays diagnosable.
 */
export async function resolveTranscriptSegments(
  videoId: string,
  youtubeUrl: string,
  durationSeconds: number,
): Promise<{ segments: TranscriptSegment[]; source: 'captions' | 'gemini' }> {
  let captionErr: unknown;
  try {
    const segments = await fetchTranscriptSegments(videoId);
    if (segments.length) return { segments, source: 'captions' };
  } catch (e) {
    captionErr = e;
  }

  try {
    const segments = await transcribeViaGemini(youtubeUrl, videoId, durationSeconds);
    if (segments.length) return { segments, source: 'gemini' };
    throw new Error('Gemini returned no segments');
  } catch (geminiErr) {
    const captionMsg = captionErr instanceof Error ? captionErr.message : String(captionErr ?? 'captions empty');
    const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
    throw new Error(
      `transcript unavailable via captions and video for ${videoId}: captions: ${captionMsg}; video: ${geminiMsg}`,
      { cause: captionErr ?? geminiErr },
    );
  }
}
