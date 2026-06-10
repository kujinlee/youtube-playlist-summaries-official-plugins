# Final Adversarial Review — HTML Doc (magazine-skim) Export

**Reviewer:** Claude (Opus 4.8), acting as the **Codex fallback** per `docs/plugins.md`.
Codex was unavailable (usage limit, resets 2026-07-03).

> ⚠️ **A manual Codex adversarial pass is still owed before merge.** This review is a
> rigorous fallback, not a substitute for the independent second model the dev-process
> mandates. Re-run `codex:rescue --fresh` on this diff once the quota resets and reconcile
> any findings against this doc.

**Scope:** `git diff 542bf95..HEAD` (20 commits, branch `feat/html-doc-magazine-skim`).
The lib core (parse/render/gemini/generate) was already reviewed in
`docs/reviews/lib-core-html-doc-review.md`; this pass focuses on the **route layer, UI
wiring, SSE, serve route, and test adequacy**.

---

## Verification (ran, not trusted)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | ✅ clean, no errors |
| `npm run build` | ✅ success; both new routes (`/api/html/[id]`, `/api/videos/[id]/html-doc[/stream]`) registered as dynamic |
| `npx jest` | ✅ **676 passed / 676**, 51 suites |
| `npx jest html-doc-post --detectOpenHandles` | ✅ no leaked handles reported (grace timer `.unref()` confirmed working) |

**"Force exiting Jest" warning:** pre-existing and unrelated to this feature. `jest.config.ts:21`
sets `forceExit: true` with the comment that md-to-pdf (Puppeteer) keeps an async handle open.
It is **not** caused by the html-doc grace timer or an EventSource leak — the targeted
`--detectOpenHandles` run on the POST route surfaced nothing. No action needed.

---

## Findings

### Blocking
*None.*

### High
*None.*

### Medium

**M1 — Grace-window race: a Regenerate during the 15s grace window leaves a finished job's
registry entry orphaned (memory, not correctness).**
`app/api/videos/[id]/html-doc/route.ts:37-42`, `lib/job-registry.ts:61-92`

On terminal, `onTerminal()` calls `releaseJobLock(jobId)` (drops the `activeByFolder` /
`jobFolders` entries) and schedules `deleteJob(jobId)` after `GRACE_MS`. If a user clicks
**Regenerate** for the same `(folder, video)` during that 15s window, `getActiveJob(key)`
returns `undefined` (lock already released — correct, this is intended so Regenerate is
allowed), so a **new** job is created with a fresh `jobId`. The old job's registry `Map`
entry still has its own pending `deleteJob` timer, so it is eventually GC'd — **no leak**.
The genuinely orphaned case is narrower: `deleteJob(jobId)` looks up `jobFolders.get(jobId)`,
but `releaseJobLock` already deleted that mapping, so the deferred `deleteJob` only clears the
`registry` entry (the folder maps are already gone). That is correct and idempotent. **Net:
no actual leak — I could not construct a path where an entry survives past GRACE_MS.** Filing
as Medium-for-visibility rather than a defect: the two-phase release (releaseJobLock now +
deleteJob later) is subtle and under-commented relative to its trickiness. *Fix (optional):*
add a one-line comment on `releaseJobLock` noting that the paired `deleteJob` will find the
folder maps already cleared and only needs to drop the registry entry — to stop a future
editor from "fixing" the apparent redundancy.

**M2 — Late SSE subscriber after the 15s grace delete gets a 404 instead of the terminal
replay.**
`app/api/videos/[id]/html-doc/stream/route.ts:21-29`, `route.ts:40`

The status bar opens its `EventSource` immediately after the POST resolves, so in practice it
subscribes well within the 15s buffer and replays `done`/`error` correctly (covered by
`tests/api/html-doc-stream.test.ts`). But if the SSE connection is established >15s after the
job finished (e.g. the tab was backgrounded, or a manual re-subscribe), `deleteJob` has run,
`subscribeJob` returns `null`, and the stream route 404s. The client (`HtmlDocStatusBar`)
treats an EventSource error as "Connection lost. Please try again." even though the job
actually **succeeded** and the file is on disk. *Impact:* cosmetic/false-negative only — the
View link in the row menu still works because `summaryHtml` was persisted. *Fix (optional):*
acceptable for a non-blocking pilot; if revisited, have the client fall back to checking the
serve route (HEAD/GET `/api/html/[id]`) on SSE error before declaring failure. Not worth
blocking the PR.

**M3 — `window.open(viewUrl, '_blank', 'noopener')` fires inside the SSE `onmessage`
callback, not a user-gesture handler — popup blockers will suppress it.**
`components/HtmlDocStatusBar.tsx:43`

The auto-open-on-done happens asynchronously (SSE event), so most browsers classify it as a
non-user-initiated popup and block it. This is **already mitigated**: the code wraps it in
`try/catch` with the comment "popup blocked — link shown", and the status bar renders an
explicit "View HTML doc ↗" link plus the row-menu "View HTML doc" item. So the user always
has a path to the doc. Flagging because the auto-open is effectively best-effort and will
silently no-op for many users — that's an intentional, documented tradeoff, matching the
deep-dive precedent. No change required.

### Low

**L1 — Serve-route path-traversal guard is airtight; one redundant branch.**
`app/api/html/[id]/route.ts:43-51`

The defense is solid and layered: (1) `summaryHtml` is only ever written by the orchestrator
as `htmls/<base>.html` where `<base>` derives from `summaryMd`; (2) the serve route
re-validates with `HTML_REL_RE = /^htmls\/[A-Za-z0-9._-]+\.html$/` which forbids `/` inside
the name, so `../` cannot appear; (3) it then resolves and asserts containment under
`<outputFolder>/htmls`. The regex makes the containment check unreachable-by-traversal, but
it's a correct backstop (defense in depth) and cheap — keep it. Note the `htmlPath !== htmlDir`
clause at line 49 can never be true given the regex requires a `<name>.html` suffix after
`htmls/`, so the resolved path is always strictly below `htmlDir`; harmless dead-ish branch.
`type=summary` is enforced (line 24). **No TOCTOU of consequence:** the index read → regex →
resolve → `readFileSync` sequence operates on a value the index controls; a concurrent index
rewrite could only swap one valid `htmls/*.html` name for another valid one, never escape the
dir. Verdict: **airtight.**

**L2 — `assertVideoId` regex caps IDs at 20 chars; YouTube IDs are 11. Fine, but the
generate path trusts `video.summaryMd` for the output filename.**
`lib/html-doc/generate.ts:46-47`

`base = video.summaryMd.replace(/\.md$/, '')` and then `htmls/${base}.html`. `summaryMd` is an
index-controlled field written by the ingestion pipeline (slugified), not user input, so this
is not an injection vector. But the serve-route regex (L1) is what actually guarantees only a
sane filename is ever *served*; if a malformed `summaryMd` (e.g. containing a slash) ever
reached the index, generation would write to an unexpected path and the serve route would then
404 it (regex rejects). Mismatch is fail-safe (404), not a breach. Acceptable; worth a slug
assertion at write time someday.

**L3 — Stream route `cancel()` and terminal-close both call `unsubscribe`; double-call is
safe.**
`app/api/videos/[id]/html-doc/stream/route.ts:24-33`

On terminal event the handler does `unsubscribe?.(); unsubscribe = null; controller.close()`.
If the client also disconnects, `cancel()` calls `unsubscribe?.()` — now `null`, no-op.
`removeListener` is idempotent anyway. No leak. Clean.

**L4 — Menu state matrix is fully correct across the four `summaryMd × summaryHtml`
combinations.**
`components/VideoMenu.tsx:81-100`

Verified by reading: `summaryHtml` set → **View** (link) + **Regenerate** (button), no
Generate. `summaryMd` set & `summaryHtml` null → **Generate** (button). `summaryMd` null →
**disabled** "Generate HTML doc" `<span aria-disabled>`. The View href carries **both**
required params (`outputFolder` + `type=summary`) — matches the URL contract and is asserted
in `tests/components/VideoMenu.test.tsx:33-35` and the E2E. `handleHtmlClose`
(`app/page.tsx:346-350`) refetches videos so the menu flips View/Regenerate after generation.
Flow (POST → setHtmlJob → SSE → open tab → auto-close → refetch) mirrors deep-dive. Correct.

---

## Concurrency analysis (the headline concern)

**Can two concurrent generations for the same video both run?** No.
`route.ts:29-34`: the guard reads `getActiveJob(key)` (key = `${outputFolder}::${videoId}`)
and returns the existing `jobId` without starting a second `runHtmlDoc` if a job holds the
lock. `createJob(jobId, key)` then sets `activeByFolder[key] = jobId`. Because the route
handler runs to the synchronous `createJob` before any `await` between the check and the set,
two requests in the same Node event loop cannot both pass the guard. Covered by
`tests/api/html-doc-post.test.ts:33-39` ("returns the SAME jobId for a concurrent duplicate
submit (no second run)").

**Can the lock ever fail to release (job stuck)?** No path found.
Both terminal routes converge on `onTerminal()`:
- Success/handled-error: `runHtmlDoc`'s `onProgress` emits `done`/`error` → `onTerminal()`.
- Unhandled rejection: the `.catch()` (route.ts:47-52) calls `onTerminal()` unless `finished`.

The `finished` flag guards against double-release if a `done` event *and* a later rejection
both fire — the first wins, the second is a no-op. `releaseJobLock` is the first thing
`onTerminal` does, so the lock is freed even if the deferred `deleteJob` timer were somehow
lost. The one theoretical gap: if `runHtmlDoc` neither emits a terminal event **nor** rejects
(hangs forever), the lock never releases. But `generateMagazineModel` passes a 60s Gemini
timeout (`lib/gemini.ts:10,249`) and every `await` in `runHtmlDoc` is bounded by that or by
synchronous fs calls — there is no unbounded wait. Acceptable.

**Cross-feature lock collision (ingest vs. html-doc):** Safe. `activeByFolder` is shared, but
ingest keys by the bare `outputFolder` while html-doc keys by `${outputFolder}::${videoId}`
(always contains `::`). `isIngestionRunning(outputFolder)` (route `ingest/route.ts:22`) checks
the bare key, so an active html-doc job cannot be mistaken for an ingestion in progress, and
vice-versa. Deep-dive uses `createJob(jobId)` with **no** folder key, so it never touches
`activeByFolder`. No collision.

---

## E2E / coverage adequacy

**Verdict: adequate for this pilot.**

The combination now closes the gap the lib-core review left open:

- **E2E (`tests/e2e/html-doc.spec.ts`)** is honest about being **UI-only** — it stubs POST +
  stream + serve. It covers the four required scenarios: generate→view (asserts **both** href
  params), already-generated (View + Regenerate, no Generate), error path (status bar alert +
  menu stays on Generate, file-not-written invariant), and a KO round-trip. Dismissal is
  exercised via the status-bar Dismiss button. This satisfies the dev-process E2E rules
  (all-params link assertions; null and non-null `summaryHtml` fixtures present).
- **Integration (`tests/api/html-doc-pipeline.test.ts`)** fills the previously-missing seam:
  the **real** `runHtmlDoc` writes the cache + index, then the **real** serve route reads the
  index and serves that exact file (KO round-trip, provenance `<meta source-md>`, serif
  fallback, and a 404-before / 200-after lifecycle assertion). Only Gemini is mocked — the
  correct boundary per `docs/dev-process.md`.
- **Unit/component:** POST guard (incl. concurrency dedupe), stream 400/404/replay, status-bar
  states (running/done/error/connection-lost/dismiss/auto-close), menu matrix, registry lock
  helpers — all covered.

**Residual gap (acceptable, not blocking):** No automated test exercises the **15s grace
delete → late-subscriber 404** path (M2) or the cross-feature ingest-vs-html-doc lock
non-collision at the route level. Both are reasoned-through above and are edge cases; a single
jest test asserting `isIngestionRunning(folder)` stays `false` while an html-doc job for that
folder is active would be a cheap, worthwhile add but is not required for this PR.

---

## Dead code / type consistency

- No dead code of consequence (L1's unreachable `htmlPath !== htmlDir` branch is an
  intentional backstop).
- `ProgressEvent` discriminated union (`types/index.ts:81-111`) is consistent across emitter,
  stream, and consumer: the `error` variant requires `log: string`, which the status bar reads
  as `data.log` (`HtmlDocStatusBar.tsx:47`) and the POST route always supplies
  (`route.ts:50`). No `any` leaks introduced.
- Atomic write in the orchestrator (temp → rename, with unlink-on-failure and
  index-rollback-on-failure) mirrors `index-store.writeIndex` — consistent with project
  convention.

---

## Overall verdict

### ✅ APPROVE — ready for PR

The feature is correct, well-tested, and the security-sensitive surfaces (serve-route path
traversal, concurrency lock release on both terminal paths, SSE leak on disconnect) hold up
under adversarial reading. tsc, build, and all 676 jest tests pass. The "Force exiting Jest"
warning is pre-existing (Puppeteer in `jest.config.ts`), not an html-doc handle leak.

**Conditions / follow-ups (none blocking):**
1. **Run the owed Codex adversarial pass** once quota resets (2026-07-03) and reconcile.
2. (Optional) M2 client-side fallback: on SSE error, probe the serve route before declaring
   "Connection lost" to avoid a false failure for a job that actually succeeded.
3. (Optional) Add a route-level test asserting an active html-doc job does not flip
   `isIngestionRunning` true for the same folder.

No Blocking or High findings. The Medium/Low items are visibility notes and optional
hardening, suitable to present to the user for a keep/defer decision.
