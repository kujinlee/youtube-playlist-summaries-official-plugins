# Task 11: Header Component — Codex Adversarial Review

## Findings

| Severity | Finding | File:Line |
|---|---|---|
| High/P1 | None found. | N/A |
| Medium/P2 | Inputs have no accessible names; playlist URL input relies on placeholder text and output folder input has neither label nor placeholder. | `components/Header.tsx:16`, `components/Header.tsx:22` |
| Medium/P2 | `defaultOutputFolder` is copied into state only on initial render — prop changes from async settings loading would not update the output folder field. | `components/Header.tsx:12` |
| Medium/P2 | Submit passes raw `playlistUrl` even though enablement is based on `playlistUrl.trim()`, so leading/trailing whitespace can reach `onIngest` and then `/api/ingest`. | `components/Header.tsx:28`, `components/Header.tsx:29` |
| Medium/P2 | Output folder is passed raw to `onIngest`; security depends entirely on API-side validation. Acceptable only if `/api/ingest` enforces filesystem safety rules from the spec. | `components/Header.tsx:25`, `components/Header.tsx:29` |
| Low/P3 | Tests query the playlist input by placeholder, reinforcing the missing-label issue rather than verifying accessible behavior. | `tests/components/Header.test.tsx:11`, `tests/components/Header.test.tsx:23` |
| Low/P3 | No test covers whitespace trimming at submit time — only the disabled state for all-whitespace input is tested. | `tests/components/Header.test.tsx:21`, `tests/components/Header.test.tsx:35` |
| Low/P3 | No test covers `defaultOutputFolder` prop changes after initial render. | `tests/components/Header.test.tsx:65` |

## Summary

No High/P1 issues. Three Medium/P2 issues are actionable before integration: missing accessible labels on both inputs, raw untrimmed playlistUrl reaching the callback, and stale defaultOutputFolder state on prop updates. Findings align with the Claude code review.
