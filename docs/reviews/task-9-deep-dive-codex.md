# Task 9: Deep-Dive Pipeline — Codex Adversarial Review

## High / P1 Findings

**[H1] — `lib/deep-dive.ts:32` — Primary URL errors dropped when `fetchTranscript` fails during fallback.**
Evidence: `} catch (urlErr) {` then `const transcript = await fetchTranscript(videoId);` outside any wrapper preserving `urlErr`. If `fetchTranscript` rejects, the function surfaces only the transcript fetch error and silently loses the original Gemini URL failure.
Fix applied: wrapped `fetchTranscript` in try/catch that throws `Deep-dive failed: URL error: ${urlMsg}` with the fetch error as `cause`.

## Medium / P2 Findings

**[M1] — `lib/deep-dive.ts:48` — Mode success event emitted before durable writes complete.**
Evidence: `onProgress({ type: 'step', ..., step: \`mode: ${mode}\` })` fired after Markdown write but before PDF generation and index update. If either fails, clients observe a successful mode event while the deep-dive is not discoverable through the index.
Fix applied: moved mode event to after `updateVideoFields` completes.

## Low / P3 / Observations

- Path traversal risk is low: `assertOutputFolder(outputFolder)` and `assertVideoId(videoId)` run before any I/O. `assertVideoId` restricts IDs to `/^[A-Za-z0-9_-]{1,20}$/`, blocking path separators before `path.join`.
- Architectural fit is acceptable: `generateDeepDiveFromTranscript` in `lib/gemini.ts` matches existing pattern — `lib/pipeline.ts` and `lib/deep-dive.ts` both import Gemini callers from `lib/gemini.ts`.

## Missing Test Coverage (addressed)

- `fetchTranscript` failure during fallback — test added: `it('preserves URL error when fetchTranscript fails during fallback', ...)`.
- Double failure (URL fails + `generateDeepDiveFromTranscript` fails) — test added: `it('wraps both errors when URL and transcript generation both fail', ...)`.
- Video-not-found — test added: `it('throws when videoId is not found in the index', ...)`.
- `generateDeepDiveFromTranscript` unit tests (prompt/language path, error wrapping, missing API key) — deferred; covered by existing `lib/gemini.ts` test patterns in Task 5.

## Assessment

**Ready to merge: With fixes** (fixes applied before commit)

Implementation is well-structured. H1 was the only blocker — URL error context preservation in the cascading failure path. All findings addressed before commit.
