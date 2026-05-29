# Architecture Decision Records

Decisions recorded here are non-obvious technical choices — things a future reader
would not understand just from reading the code. Update this file when a decision
changes or a new significant choice is made.

---

## ADR-001: E2E tests mock at the API route boundary, not at the real API

**Status:** Accepted

**Context:**
The app calls YouTube Data API and Gemini API during playlist ingestion and
deep-dive generation. Real API calls require valid credentials, consume quota
(YouTube: 10,000 units/day; Gemini: per-token billing), take minutes per run,
and produce non-deterministic output (video metadata changes, videos get deleted).

**Decision:**
Playwright E2E tests (`tests/e2e/`) intercept all `/api/*` HTTP requests via
`page.route()` at the Playwright network layer, returning canned JSON responses
before the request reaches the Next.js server. The actual API route handlers
(e.g. `app/api/ingest/route.ts`) never execute during E2E tests. The dev server
runs only to serve the React UI bundle.

Real API behavior is tested at the lib layer:
- `tests/lib/youtube.test.ts` — YouTube client with mocked HTTP
- `tests/lib/gemini.test.ts` — Gemini client with mocked HTTP

**Consequences:**
+ Tests run in seconds, offline, without credentials or quota
+ Fully deterministic — same result on every CI run
+ No secrets required in the developer environment
− If the real YouTube or Gemini API changes its response shape, E2E tests
  will not catch the regression; only lib-layer tests will (and only if their
  fixture data is updated to match the new schema)
− If a route handler mis-wires a lib call (wrong argument, wrong field), E2E
  tests will not catch it (mitigated by `tests/api/` which test route handlers
  against mocked lib functions)

**When to revisit:**
If the app reaches production with real users and API contract drift becomes a
pain point, add a Tier 3 integration job (nightly CI, real test account with a
small stable playlist) to catch schema regressions before they hit users.

---

## ADR-002: SSE test responses are delivered as a complete static body

**Status:** Accepted (known limitation)

**Context:**
Playwright's `route.fulfill()` API delivers a complete HTTP response body at once.
Server-Sent Events normally arrive incrementally over a persistent connection.
When `route.fulfill()` is used with `Content-Type: text/event-stream`, the browser
receives all SSE events simultaneously as a completed body. The browser's EventSource
implementation fires `onmessage` for each `data:` line in rapid succession. React 18's
automatic batching may collapse multiple sequential state updates (e.g. `step` → `done`)
into a single render, making intermediate states (step text, partial progress) invisible
to Playwright assertions.

**Decision:**
Accept that E2E tests cannot reliably observe transient SSE states. Tests assert only:
1. The state before SSE fires (progress bar visible immediately after form submit)
2. The terminal state (video list populated, progress hidden after `done`)

Intermediate step text and progress percentages are not asserted in E2E tests.
Those behaviors are covered at the component level (`tests/components/`) where
`MockEventSource` emits events synchronously and React renders are observed one at a time.

**Consequences:**
+ No flaky timing-dependent assertions in E2E tests
+ E2E tests remain fast (no artificial delays or polling)
− "Step text visible during ingest" is not verified at the browser layer
− EventSource lifecycle edge cases (remount during stream, rapid prop change,
  onerror after done) are not covered at the E2E layer — only at the component layer

**When to revisit:**
If Playwright adds a streaming-response interception API (controlled `WritableStream`
fulfillment), replace static `sseBody()` with a controlled emitter that can pause
between events, enabling intermediate-state assertions.

---

## ADR-003: Real-API integration tests deferred to Tier 3

**Status:** Accepted (deferred, not rejected)

**Context:**
Full end-to-end confidence — from browser click through to a real YouTube playlist
and Gemini summarization — requires live credentials, quota budget, a stable test
playlist, and multi-minute test runs. This is incompatible with a fast PR gate.

**Decision:**
Three test tiers are defined; only Tiers 1 and 2 are implemented:

| Tier | Tests | Speed | Credentials | Gate |
|---|---|---|---|---|
| 1 | Unit + component (Jest) | ~20s | None | Every commit |
| 2 | E2E with mocked APIs (Playwright) | ~10s | None | Every commit |
| 3 | Integration with real APIs | Minutes | YouTube + Gemini keys | Nightly / pre-release |

Tier 3 is deferred until the cost is justified by real production usage.

If Tier 3 is added later, the recommended setup:
- Dedicated YouTube test account with a small, immutable playlist (≤10 videos)
- Gemini API key with a monthly budget alert
- "Golden output" snapshots committed to the repo (summaries, PDFs)
- Separate CI job, not a PR gate, run nightly or on merge to main

**Consequences:**
+ PR gate remains fast and free, runnable offline
− API contract drift (YouTube or Gemini schema change) will not be caught until
  a user reports it or a developer manually tests with real credentials
− File I/O, atomic writes, and playlist-index.json correctness under concurrent
  access are not verified at the integration level

**When to revisit:**
When the app has real users and an API schema regression causes a user-visible
failure, or when a CI budget is available for nightly integration runs.

---

## ADR-004: Layer-by-layer mocking — each test layer mocks the layer directly below

**Status:** Accepted

**Context:**
The stack has five layers: real external APIs → lib clients → API route handlers →
React components → browser UI. Testing the full chain in every test is slow,
credential-dependent, and produces non-deterministic results.

**Decision:**
Each test layer mocks only the boundary immediately below it:

```
Browser (Playwright E2E)         ← mocks: /api/* HTTP responses
  React components (Jest/RTL)   ← mocks: global.fetch + window.EventSource
    API route handlers (Jest)   ← mocks: lib/youtube.ts, lib/gemini.ts, lib/store.ts
      lib/youtube.ts (Jest)     ← mocks: global.fetch (HTTP)
      lib/gemini.ts (Jest)      ← mocks: global.fetch (HTTP)
      lib/pdf.ts (Jest)         ← mocks: fs operations
```

Each layer tests its own logic (transformation, state management, error handling)
assuming the layer below it behaves as specified.

**Consequences:**
+ Tests are fast, deterministic, and runnable without credentials at every layer
+ Failures are localized — a broken API route test points to the route handler,
  not to the YouTube API or the UI
+ Mocking overhead is minimal — each layer only needs to understand its direct
  dependency interface, not the full external API schema
− No single test validates the full chain; full-chain confidence requires all
  layers' tests to pass AND manual or Tier 3 integration testing
− Interface mismatches between layers (e.g. route handler returns a shape that
  the component doesn't expect) are only caught when both layers' tests are read
  together, not automatically

**When to revisit:**
If interface drift between layers becomes a recurring source of bugs, consider
adding contract tests (e.g. using a shared Zod schema as the source of truth
between the route handler and the component mock). The existing `types/index.ts`
Zod schemas partially address this already.

---

## ADR-005: No locking on playlist-index.json writes

**Status:** Accepted (single-user local use) — revisit before team deployment

**Date:** 2026-05-28

**Context:**
Every write operation in this app (ingestion, archive, deep-dive, personal review) follows the same read-modify-write pattern against `playlist-index.json`:

```
readIndex()  →  modify in memory  →  writeIndex() (atomic rename via .tmp)
```

The `writeIndex` step is atomic at the filesystem level (rename is atomic on POSIX), so a write will never produce a corrupt or partially-written file. However, the **read-modify-write sequence as a whole is not atomic**. If two concurrent requests read the same index, modify different fields, and write back, the second write silently overwrites the first:

```
Request A: reads index  →  sets video 1 personalScore=4  →  writes
Request B: reads index  →  sets video 2 personalScore=5  →  writes
                                                            ↑ A's change is lost
```

Affected routes: `POST /ingest`, `POST /videos/[id]/archive`, `POST /videos/[id]/deep-dive`, `POST /videos/[id]/review` — any route that calls `upsertVideo`, `updateVideoFields`, or `writeIndex` directly.

**Decision:**
No locking is added at this time. The app is a single-user local tool. The race window is a few milliseconds, and losing an annotation or archive flag requires two writes to the same playlist index to interleave within that window — practically impossible for one person at one keyboard. Adding per-`outputFolder` file locking now would add a dependency, complicate every write route, and introduce lock-timeout failure modes.

**Unsafe today:** same playlist open in multiple tabs writing simultaneously; background ingestion running while user archives/reviews in the UI.

**Before team/multi-user deployment:** choose one of —
- **Option A (recommended):** per-`outputFolder` async file lock (`proper-lockfile`) — low risk, no schema changes
- **Option B:** optimistic concurrency with a `version` field in `PlaylistIndex` — `409 Conflict` on stale write, client retries
- **Option C:** replace `playlist-index.json` with SQLite — right answer if the app becomes a team tool

**When to revisit:**
When the app will be served to more than one user simultaneously, background ingestion will run on a server, or the same playlist will be accessible from multiple devices.
