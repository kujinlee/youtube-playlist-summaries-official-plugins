/**
 * Clipped Gemini REST call for "dig deeper" section elaboration.
 *
 * Uses direct fetch (not the @google/generative-ai SDK) because the SDK
 * lacks `video_metadata` types needed for temporal clipping.
 */

import { buildIndexedTranscript } from '@/lib/transcript-timestamps';
import type { SectionWindow } from '@/lib/dig/section-window';

const DEEPDIVE_MODEL =
  process.env.GEMINI_DEEPDIVE_MODEL ?? 'gemini-2.5-pro';

const GEMINI_REST_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

/** Transient HTTP status codes that warrant one retry. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

/**
 * Build the text prompt for a dig-deeper request.
 *
 * The prompt:
 * - names the clip range [startSec, endSec]
 * - includes [[SLIDE:sec|caption]] and [[TS:i]] citation instructions
 * - enforces a ≤3-slide rule
 * - instructs Korean output when lang='ko'
 */
export function buildDigPrompt(
  lang: 'en' | 'ko',
  startSec: number,
  endSec: number,
): string {
  const langInstruction =
    lang === 'ko'
      ? 'Write your entire response in Korean (한국어로 작성하세요).'
      : 'Write your entire response in English.';

  return `You are elaborating on one section of a YouTube video for a reader who has already seen a brief summary.

This clip covers seconds ${startSec} to ${endSec} of the video.

${langInstruction}

Your task:
- Elaborate this ONE section in depth, grounded in the transcript and video content provided.
- Cover at least everything the summary section states, then go deeper with specifics, examples, and reasoning from the clip.
- Cite key moments using [[TS:i]] tokens (where i is the 0-based index from the transcript below). Use these inline to anchor claims to the transcript.
- When a slide, diagram, chart, or code screen conveys information beyond what is spoken, emit [[SLIDE:sec|caption]] where sec is the second the slide is fully rendered. Use at most 3 [[SLIDE:]] tokens total.
- Output markdown only — no preamble, no headings for the section title, no meta-commentary.

Transcript and summary follow:
`;
}

// ── REST call ─────────────────────────────────────────────────────────────────

interface GeminiCandidate {
  content: { parts: Array<{ text?: string }> };
}

interface GeminiRestResponse {
  candidates?: GeminiCandidate[];
}

function buildRequestBody(
  window: SectionWindow,
  videoId: string,
  lang: 'en' | 'ko',
): object {
  const { startSec, endSec, transcriptWindow, summaryProse } = window;
  const transcriptBlock = buildIndexedTranscript(transcriptWindow);
  const promptText =
    buildDigPrompt(lang, startSec, endSec) +
    (transcriptBlock ? `\n${transcriptBlock}\n` : '') +
    `\nSummary section:\n${summaryProse}`;

  return {
    contents: [
      {
        role: 'user',
        parts: [
          {
            file_data: {
              file_uri: `https://www.youtube.com/watch?v=${videoId}`,
              mime_type: 'video/mp4',
            },
            video_metadata: {
              start_offset: { seconds: startSec },
              end_offset: { seconds: endSec },
            },
          },
          { text: promptText },
        ],
      },
    ],
  };
}

async function callGeminiRest(
  model: string,
  apiKey: string,
  body: object,
): Promise<Response> {
  const url = `${GEMINI_REST_BASE}/${model}:generateContent?key=${apiKey}`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function extractText(data: GeminiRestResponse): string {
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('generateDig: no text in Gemini response candidates');
  }
  return text;
}

/**
 * Generate a "dig deeper" markdown elaboration for one video section.
 *
 * Retries once on transient HTTP errors (429/5xx). Throws on non-200
 * after retry or on missing candidates.
 *
 * @param window   Section window produced by Task 2's windowForSection.
 * @param videoId  YouTube video ID (11 chars).
 * @param lang     Output language.
 * @returns        Raw markdown string.
 */
export async function generateDig(
  window: SectionWindow,
  videoId: string,
  lang: 'en' | 'ko',
): Promise<string> {
  const apiKey = getApiKey();
  const model = DEEPDIVE_MODEL;
  const body = buildRequestBody(window, videoId, lang);

  let res = await callGeminiRest(model, apiKey, body);

  // One retry on transient failure.
  if (!res.ok && TRANSIENT_STATUSES.has(res.status)) {
    res = await callGeminiRest(model, apiKey, body);
  }

  if (!res.ok) {
    throw new Error(
      `generateDig: Gemini REST returned HTTP ${res.status}`,
    );
  }

  const data = (await res.json()) as GeminiRestResponse;
  return extractText(data);
}
