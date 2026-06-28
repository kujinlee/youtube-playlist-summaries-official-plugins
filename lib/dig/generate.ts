/**
 * Clipped Gemini REST call for "dig deeper" section elaboration.
 *
 * Uses direct fetch (not the @google/generative-ai SDK) because the SDK
 * lacks `video_metadata` types needed for temporal clipping.
 */

import { buildIndexedTranscript } from '@/lib/transcript-timestamps';
import type { SectionWindow } from '@/lib/dig/section-window';

/** Dig generation policy version. Bump when the slide/code policy changes so existing
 *  dug sections become stale and can be deliberately refreshed. */
export const DIG_GENERATOR_VERSION = 8;

const DEEPDIVE_MODEL =
  process.env.GEMINI_DEEPDIVE_MODEL ?? 'gemini-2.5-pro';

const GEMINI_REST_BASE =
  'https://generativelanguage.googleapis.com/v1beta/models';

/** Transient HTTP status codes that warrant one retry. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Per-attempt fetch timeout. Mirrors REQUEST_TIMEOUT_MS in lib/gemini.ts (60 s).
 * An AbortError from this timeout is treated as a transient failure and retried once.
 */
const REQUEST_TIMEOUT_MS = 60_000;

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
 * - includes [[SLIDE:M:SS|M:SS|caption]] visual-capture instructions
 * - curates to at most 4 slides
 * - instructs Korean output when lang='ko'
 *
 * Note: inline [[TS:i]] transcript citations were removed (DIG_GENERATOR_VERSION 8). Gemini
 * echoed the indexed-transcript display format as `[[i @m:ss]]`, which leaked as literal text,
 * and resolveTranscriptTokens only ever rendered OWN-LINE citations (it strips inline ones).
 * Each dug section already carries the summary's own-line ▶ timestamp link directly above it.
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
- Emit [[SLIDE:M:SS|M:SS|caption]] when an on-screen visual carries meaning words alone cannot fully convey — a diagram, chart, architecture/flow figure, data visualization, a UI/result screenshot whose spatial layout matters, OR a slide showing code, a command, terminal/CLI output, or config whose on-screen text is the point. Emit ONLY when that content is actually shown on screen — do NOT transcribe code into a fenced block, and do NOT invent a slide for code that is merely spoken. NEVER for title cards, bullet lists, quotes, tips, or a speaker on camera (including a split-screen with a speaker) unless the slide content itself is the point. The FIRST M:SS is the moment the visual is FULLY BUILT and settled; the SECOND M:SS is when it is replaced or leaves the screen.
- Usually emit ONE token per visual, at its settled moment. EXCEPTION: if a visual builds in stages and the intermediate stages each teach something the final frame cannot (e.g. a diagram that reveals a relationship piece by piece), emit one token per instructive stage, each pointed at the moment that stage is complete. If the build merely animates into place, the final settled frame alone is enough.
- The caption is a short plain-English description of the slide. It MUST NOT contain the characters [ ] ( ) or | — describe the slide in words; never paste raw code, YAML, or shell into the caption. (example: [[SLIDE:3:51|4:02|Diagram showing four capabilities]])
- Select at most 4 — typically 1-3 — only the most essential visuals. In a slide-heavy talk, do NOT reproduce every slide; curate the handful a reader most needs, and omit any visual whose point the prose already carries. Most sections need zero or one; emitting none is fine.
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
  const url = `${GEMINI_REST_BASE}/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

  let res: Response;

  try {
    res = await callGeminiRest(model, apiKey, body);
  } catch (err) {
    // Network or timeout error on first attempt — retry once.
    res = await callGeminiRest(model, apiKey, body);
  }

  // One retry on transient HTTP failure.
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
