# Adversarial Plan Review — timestamp-guard-audit-repair

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback. Re-attempt the Codex-specific pass before merge if access returns.**

Verdict: **needs-rework** → all Blocking/High + the Medium typo applied; plan now ready-to-execute. Reviewer verified the plan's code against actual source and every edited test file.

## Blocking (applied)

- **B1 — audit test seeded in `os.tmpdir()`, which `readIndex`→`assertOutputFolder` rejects** (folder outside `$HOME` throws before any assertion; the deep-dive suite already roots temp dirs in `os.homedir()`). → `seed()` now uses `fs.mkdtempSync(path.join(os.homedir(), '.audit-test-'))`.
- **B2 — the `d.md` fixture's fenced `▶` is line-leading, so `/^▶/m` matches → `d` mis-counts as `withTs`, breaking the asserted partition.** `/^▶/m` has no fence awareness. → Fixed the fixture (indented the fenced `▶`) and corrected the misleading comment; also corrected the spec's inaccurate "avoids fenced-prose false positives" claim to the accurate "rejects inline-prose `▶`; not fence-aware (acceptable — bodies never start a fenced line with `▶`)."
- **B3 — `repairTimestamps`'s `tsCount → readIndex('f')` throws on the synthetic test folder (real fs, `index-store` unmocked), so the `--run` tests reject before any `ensure*` call.** → `tsCount` is now failure-tolerant (try/catch → 0); before/after counts are informational logging and must never abort the batch. The run-path tests now reach the mocked `ensure*` and assert on call args, as designed; a note was added explaining why `index-store` is intentionally not mocked.

## High (applied)

- **H2 — `CURRENT_DOC_VERSION` not imported in `tests/lib/html-doc/ensure.test.ts`** (the force test used it directly). → Step 1 now instructs adding `import { CURRENT_DOC_VERSION } from '../../../lib/doc-version';`.
- **H3 — force test used videoId `'v1'`/folder `'out'`, but the suite seeds `'vid11111111'`/`'/out'`** (`.find(v=>v.id==='v1')` → "Video not found"); `patches` is a per-test local const, not a shared helper. → Test rewritten with `'vid11111111'`, `'/out'`, and a local `patches = (indexStore.updateVideoFields as jest.Mock).mock.calls.map((c)=>c[2])`.

## Medium (applied)

- **M1 — Task-1 header said "convert 12 existing tests"; body/table/self-review say 13** (12 tokenless success tests + the `[[TS:9]]` degrade test at ~311, which resolves to 0 ▶ with segments → guard retries → 2nd undefined mock without conversion). Reviewer independently verified 13 is correct and the 4 throw-expecting tests (malformed JSON, out-of-range rating, invalid videoType, unexpected fields) correctly need no change (a `generateJson` throw propagates before the ▶-retry guard runs). → Header corrected to "13".

## Verified-correct (reviewer, no change)
- Guard scope (summary + from-transcript retry; combined warn-only, no retry), the `attempt()` closures, and that `resolveTranscriptTokens` never throws while `generateJson` can (throw → propagate, success+0▶ → retry).
- `force` as the 5th positional param with a default preserves all existing `ensure*` callers (all pass ≤4 positional args); `if (force || …)` gating and the true-current stamp are correct.
- Audit `classify` partition: `stuck = storedMajor >= currentMajor`, `would-regen = <` — correct (a doc at major > current is impossible-but-harmlessly-stuck; the spec's live case is `==`).
- Deep-dive force test helpers (`writeIndex`/`makeVideo`/`storedVideo`/`CURRENT`/`MD_FILE`/`HTML_PATH`/`VIDEO_ID`/`mockWriteDeepDiveDoc`) all exist; gemini deep-dive/combined guard tests fit the files' mock setup; none of the 13 converted tests assert call count.
- Path-traversal: `audit`/`repair` reads are confined to `$HOME` transitively via `readIndex → assertOutputFolder`; the L1/L2 script guards run before that. Acceptable for an operator tool.
- TDD RED-before-GREEN ordering and task dependency order (1→2→3→4; Task 4 consumes Tasks 2+3) are sound.

## Note (no fix, executor awareness)
- M3 (reviewer): combined warn-only makes the 4 existing default-fixture combined tests each emit a harmless `[timestamp-miss]` warn (none assert on warn). Acceptable; a future "no unexpected console.warn" guard would need updating.
