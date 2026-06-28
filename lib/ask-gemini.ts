import type { Video } from '@/types';
import { formatTimestamp } from '@/lib/transcript-timestamps';

const GEMINI_APP_URL = 'https://gemini.google.com/app';

/** Whole-video prompt: review the video, then invite questions. Non-'ko' → English. */
export function buildWholeVideoPrompt(videoUrl: string, lang: 'en' | 'ko'): string {
  if (lang === 'ko') {
    return `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: ${videoUrl}`;
  }
  return `Please review this video first; I'd like to ask questions about it: ${videoUrl}`;
}

/**
 * Section-scoped prompt: review the section [startSec, endSec], then invite questions.
 * `videoUrl` must be a `watch?v=…` URL (already has a query) so the appended `&t=` is correct.
 * `endSec === null` → open-ended ("onward") phrasing for the last/untimed-tail section.
 */
export function buildSectionPrompt(
  videoUrl: string,
  startSec: number,
  endSec: number | null,
  lang: 'en' | 'ko',
): string {
  const at = `${videoUrl}&t=${startSec}s`;
  const start = formatTimestamp(startSec);
  if (lang === 'ko') {
    const range = endSec !== null ? `${start}부터 ${formatTimestamp(endSec)}까지` : `${start}부터`;
    return `이 영상의 해당 구간(${range})을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: ${at}`;
  }
  const range = endSec !== null ? `from ${start} to ${formatTimestamp(endSec)}` : `from ${start} onward`;
  return `Please review this section of the video (${range}), then I'd like to ask questions about it: ${at}`;
}

/**
 * Build the Gemini web-app deep link. `?prompt=` is auto-filled only for users with a
 * "Send to Gemini"-style browser extension and ignored otherwise (the clipboard copy
 * covers everyone else). `autosubmit=false` keeps the extension from sending before
 * the user edits. Only the prompt value is percent-encoded.
 */
export function buildGeminiUrl(prompt: string): string {
  return `${GEMINI_APP_URL}?prompt=${encodeURIComponent(prompt)}&autosubmit=false`;
}

/** AI provider config — swap here to add another provider later. */
export const AI_PROVIDER = {
  name: 'Gemini',
  buildUrl: buildGeminiUrl,
};

/**
 * Whole-video prompt for a Video. Delegates to buildWholeVideoPrompt; `language` is a
 * required 'en' | 'ko' enum, but anything other than 'ko' falls back to English defensively.
 */
export function buildGeminiPrompt(video: Video): string {
  return buildWholeVideoPrompt(video.youtubeUrl, video.language === 'ko' ? 'ko' : 'en');
}
