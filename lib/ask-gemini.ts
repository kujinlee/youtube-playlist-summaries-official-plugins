import type { Video } from '@/types';

const GEMINI_APP_URL = 'https://gemini.google.com/app';

/**
 * Build a language-aware prompt asking Gemini to review a YouTube video and invite
 * follow-up questions. The raw video URL is appended verbatim so Gemini watches the
 * real video. `language` is a required 'en' | 'ko' enum; anything else falls back to
 * English defensively.
 */
export function buildGeminiPrompt(video: Video): string {
  const url = video.youtubeUrl;
  if (video.language === 'ko') {
    return `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: ${url}`;
  }
  return `Please review this video first; I'd like to ask questions about it: ${url}`;
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
