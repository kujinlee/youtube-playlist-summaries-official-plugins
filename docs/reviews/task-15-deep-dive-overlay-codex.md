# Task 15: Deep Dive Overlay — Codex Adversarial Review

## Issues Beyond Claude's Review (I1–I3)

### Medium

**[STALE_STATE_ON_NEW_STREAM] components/DeepDiveOverlay.tsx:18-24,49**
When `videoId` or `jobId` changes, a new EventSource opens but prior `done`/`error` UI remains until the first new event arrives. Fix: reset `state` and `logsOpen` at the start of the effect.

**[UNENCODED_STREAM_URL] components/DeepDiveOverlay.tsx:23**
`videoId` and `jobId` are interpolated raw — reserved characters can corrupt the route or query string.
Fix: use `encodeURIComponent` for both path and query values.

**[UNVALIDATED_SSE_PAYLOAD] components/DeepDiveOverlay.tsx:27-29**
`JSON.parse(event.data) as ProgressEvent` can throw on malformed payloads, leaving overlay frozen.
Fix: wrap in try/catch; validate shape before updating state.

**[MODAL_FOCUS_NOT_MANAGED] components/DeepDiveOverlay.tsx:54-87**
Dialog opens without moving focus into it; does not restore focus on close.
Fix: focus an initial control on mount; restore prior active element on cleanup.

### Low

**[TERMINAL_STATE_CAN_REGRESS] components/DeepDiveOverlay.tsx:30-41**
A late `step` message arriving after `done`/`error` can move UI back to `running`.
Fix: track a terminal flag and discard events received after it.

**[LOG_TOGGLE_ARIA] components/DeepDiveOverlay.tsx:71-78**
Button missing `aria-expanded` and `aria-controls`; panel needs a stable `id`.

**[STATUS_CHANGES_NOT_ANNOUNCED] components/DeepDiveOverlay.tsx:66-70**
Done and error transitions invisible to screen readers — need `role="status"`/`role="alert"`.

## Hypotheses (requires verification)

**[STALE_CLOSED_STREAM_EVENT]** — Queued EventSource callbacks may fire after cleanup, updating state from a replaced stream.

**[ROUTE_VIDEO_ID_NOT_ENFORCED]** — The stream route may ignore `params.id`; if `jobId` is not scoped to `videoId` server-side, a client could poll any job from any video URL.

## Test Gaps Identified

- Encoded stream URL
- Prop change resets state and closes previous stream
- Events from a stale/replaced stream ignored
- Step event arriving after terminal event ignored
- `onerror` network failure shows error and closes stream
- Malformed SSE payload doesn't crash
- Log toggle `aria-expanded` state
- Rapid `jobId` changes don't leak streams
- Dialog focus on open and restore on close

## Summary

Three highest-risk gaps Claude missed: (1) stale state when props change without reset, (2) unguarded `JSON.parse` can throw and freeze overlay, (3) absent modal focus management. Not safe to ship as-is without addressing Medium findings.
