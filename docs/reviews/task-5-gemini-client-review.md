# Task 5 — Gemini Client: Claude Code Review

**Verdict:** Not ready to proceed — Critical and Important findings require fixes

---

## Strengths

- Clean API boundary — all Gemini SDK calls isolated in one file; Vertex AI swap = change one file only
- `getApiKey()` fails fast at call time with an actionable message rather than propagating a null key into an SDK error
- Error wrapping with `{ cause: err }` preserves the original error for downstream debugging; tests verify both message and cause
- Zod validation on parsed ratings catches bad model output structurally
- `computeOverallScore()` pure and extracted — testable in isolation
- TDD: 4 tests written first, each watched fail before implementation

---

## Issues Found and Resolved

### Critical (fixed)

**1. `mimeType: 'video/mp4'` initially removed — SDK `FileData` type requires it**
Earlier review incorrectly advised removing `mimeType`. SDK type definition confirms `FileData.mimeType: string` is non-optional. Omitting it causes TypeScript errors and likely a 400 from the API.
*Fix:* Restored `mimeType: 'video/mp4'` in `generateDeepDive`.

**2. Missing test for `GEMINI_API_KEY` not set**
The plan's "error on invalid API key" requirement was tested via a mid-flight `generateContent` rejection, not via a missing key. These are different failure modes — `getApiKey()` throws synchronously before any SDK call.
*Fix:* Added test that deletes `process.env.GEMINI_API_KEY` and asserts the thrown message matches `GEMINI_API_KEY is not set`.

---

### Important (fixed)

**3. `summary` field not validated beyond `String(parsed.summary)`**
If the model returned `null` or an empty string, the caller received a bad value silently. Only `ratings` was Zod-validated.
*Fix:* Added `summary: z.string().min(1)` to `GeminiResponseSchema`; both fields now parsed together in one `GeminiResponseSchema.parse()` call.

**4. No test for `language: 'ko'` in `generateSummary`**
All `generateSummary` tests used `'en'`. A broken Korean language branch would go undetected.
*Fix:* Added test asserting the prompt sent to `generateContent` contains `Korean` or `한국어` when `language === 'ko'`.

**5. `GeminiSummaryResponse` in `types/index.ts` missing `overallScore`**
`lib/gemini.ts` returned `overallScore` but `GeminiSummaryResponse` didn't declare it, creating two diverging type definitions for the same concept.
*Fix:* Added `overallScore: number` to `GeminiSummaryResponse` in `types/index.ts`; `SummaryResult` interface removed, `GeminiSummaryResponse` used as the canonical return type.

**6. Deep-dive test only checked `fileUri`, not `mimeType`**
`fileData?.fileUri` assertion would pass even if `mimeType` were wrong or absent.
*Fix:* Updated to `toEqual({ fileUri: '...', mimeType: 'video/mp4' })`.
