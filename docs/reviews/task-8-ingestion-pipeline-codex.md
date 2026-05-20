# Task 8 — Ingestion Pipeline: Codex Adversarial Review

**Verdict:** P1 accepted with API-layer mitigation plan; P2 findings documented or accepted

---

## P1 Findings

**P1: Concurrent ingestion runs can corrupt index (accepted risk)**
Two `runIngestion` calls targeting the same `outputFolder` can interleave `readIndex`/`writeIndex` and `upsertVideo` calls, producing mixed or lost index entries while both emit `done`.
*Resolution:* Accepted for the current single-process design. The API route layer (Task 10) must enforce one active ingestion per `outputFolder` — reject a new POST /api/ingest while a job is already running for the same folder, returning 409 Conflict. Deferred to Task 10 where job state is managed.

---

## P2 Findings

**P2-1: Partial artifacts left on per-video failure (accepted risk)**
If PDF generation or `upsertVideo` fails after the MD file is written, the orphaned MD remains outside the index. The pipeline emits an error event and continues — the caller cannot distinguish "zero artifacts" from "MD exists but not indexed."
*Resolution:* Accepted. Same pattern as archive manager P2-2. Recovery requires manual inspection. Full per-video transactional rollback deferred to a future hardening pass.

**P2-2: Raw SDK error messages forwarded to progress events (accepted)**
Internal errors from transcript fetch, Gemini, PDF generation, or filesystem writes are forwarded verbatim as the `log` field. These may include absolute paths or SDK diagnostic details.
*Resolution:* Accepted for a single-user app where the user is the operator and observing their own filesystem paths is not a privacy concern. Error messages from project libs are already human-readable (e.g., "Failed to fetch transcript for video X: ..."). Future work: sanitize for multi-user deployment.

**P2-3: Security-critical guards mocked in unit tests (accepted)**
`assertOutputFolder` and `assertVideoId` are no-ops in pipeline tests. Adversarial videoId values are not tested at the pipeline integration level.
*Resolution:* Accepted. In production, `assertVideoId` is called before any path construction, and `upsertVideo` re-validates internally. Integration-level coverage with adversarial inputs will be added in Task 10 (API route tests), where the full stack is exercised end-to-end.

---

## Clean Areas (no findings)

- Path traversal via `videoId`: guarded by `assertVideoId` before all `path.join` calls
- Prompt injection into filenames: filenames derived from validated `videoId`, not transcript/Gemini content
- API key leak: `YOUTUBE_API_KEY` guard fires before any progress events are emitted; key does not appear in error messages
