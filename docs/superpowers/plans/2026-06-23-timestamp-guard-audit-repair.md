# Timestamp Guard + Health-Check + Batch Repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop timestamp-less docs at the source (generation guard), detect them (audit), and repair the 6 stuck ones (batch repair) — without changing version-stamp semantics.

**Architecture:** Three components. (1) A semantic-retry guard inside the Gemini generators: when segments exist but the resolved output has no ▶, retry once (cheap paths only) then warn. (2) A `force` flag on `ensureHtmlDoc`/`ensureDeepDiveHtml` so a current-major doc can be re-generated (a stuck doc cannot otherwise reach the re-gen branch). (3) `lib/` audit + repair modules (tested under `tests/lib/`) driven by thin `ts-node` script wrappers.

**Tech Stack:** TypeScript, Next.js 16, Gemini (`@google/generative-ai`), jest + ts-jest, ts-node for scripts.

## Global Constraints

- **▶ marker** is literally `'▶'` (U+25B6, `lib/transcript-timestamps.ts:31`). `resolveTranscriptTokens` degrades **all-or-nothing** and **never throws** — `resolved.includes('▶')` is the sound presence proxy; do NOT convert to a count check in the guard.
- **Guard fires only on success-but-zero-▶ with `segments.length > 0`.** A throw from `generateJson`/`generateContent` propagates unchanged (no ▶-retry). `segments.length === 0` → no retry, no warn.
- **Retry budget: exactly one extra attempt** (≤2 generations) on the retrying paths.
- **`generateDeepDiveCombined` is warn-only — never retried** (it re-uploads the full video to `gemini-2.5-pro`; doubling the costliest call to chase an undemonstrated miss is rejected).
- **Warn format:** `[timestamp-miss] <videoId>: <N> segments but 0 timestamps after <k> attempt(s)` — neutral wording (the miss may be deterministic).
- **`force` re-gen stamps the TRUE current version** (`CURRENT_DOC_VERSION` / `CURRENT_DEEP_DIVE_VERSION`), never an inflated major.
- **Audit:** stored version defaults to `{major:1,minor:0}` when absent; ▶ detected **line-leading** (`/^▶/m`); summaries vs deep-dives split by index fields (`summaryMd` / `deepDiveMd`), not filename.
- **Scripts are `.ts` via ts-node** (no `tsc` emit in this Next app), mirroring `scripts/rerender-html.ts` + its `npm run` entry. Testable logic lives in `lib/` (jest `testMatch` is `tests/lib|api|components` + `tests/smoke` only).
- Full `npm test` + `npx tsc --noEmit` green before each commit.

---

### Task 1: Generation guard in `lib/gemini.ts`

**Files:**
- Modify: `lib/gemini.ts` (`generateSummary` 147-195; `generateDeepDiveFromTranscript` 322-343; `generateDeepDiveCombined` 374-404)
- Test: `tests/lib/gemini.test.ts` (add guard tests + convert 12 existing tests); `tests/lib/gemini-deepdive-timestamps.test.ts` (add 1 guard test); `tests/lib/gemini-deepdive-combined.test.ts` (add 1 warn-only test)

**Interfaces:**
- Consumes: existing `generateJson`, `resolveTranscriptTokens`, `buildIndexedTranscript`, `computeOverallScore`, `trimToWords`.
- Produces: a module-private `function hasTimestamp(s: string): boolean { return s.includes('▶'); }` and a private `function timestampMissWarn(videoId: string, n: number, attempts: number): void`. Public signatures of all three generators are UNCHANGED.

- [ ] **Step 1: Add the shared predicate + warn helper** (above `generateSummary`)

```ts
/** True if the resolved text carries at least one ▶ timestamp line (all-or-nothing — see resolveTranscriptTokens). */
function hasTimestamp(s: string): boolean {
  return s.includes('▶');
}

/** Neutral observability warn for a generation that had segments but produced no ▶ (the miss may be deterministic). */
function warnTimestampMiss(videoId: string, segmentCount: number, attempts: number): void {
  console.warn(`[timestamp-miss] ${videoId}: ${segmentCount} segments but 0 timestamps after ${attempts} attempt(s)`);
}
```

- [ ] **Step 2: Write failing guard tests for `generateSummary`** (append a `describe('generateSummary — timestamp guard', …)` to `tests/lib/gemini.test.ts`)

```ts
describe('generateSummary — timestamp guard', () => {
  const withTs = '## 1. A\n[[TS:0]]\n\nbody\n\n## Conclusion\n[[TS:1]]\n\nend';
  const noTs = '## 1. A\n\nbody\n\n## Conclusion\n\nend';
  const ratings = { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 };

  it('retries once when attempt 1 has no ▶ and attempt 2 does (segments present)', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({ summary: noTs, ratings }) } })
      .mockResolvedValueOnce({ response: { text: () => JSON.stringify({ summary: withTs, ratings }) } });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.summary).toContain('▶');
  });

  it('warns and returns the last result when both attempts lack ▶ (segments present)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ summary: noTs, ratings }) } });

    const result = await generateSummary(SEGS, 'en', 'vid123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.summary).not.toContain('▶');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[timestamp-miss] vid123'));
    warn.mockRestore();
  });

  it('does NOT retry or warn when there are no segments', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateContent.mockResolvedValue({ response: { text: () => JSON.stringify({ summary: noTs, ratings }) } });

    await generateSummary([], 'en', 'vid123');

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[timestamp-miss]'));
    warn.mockRestore();
  });
});
```

- [ ] **Step 3: Run — confirm RED**

Run: `npx jest gemini.test -t "timestamp guard"`
Expected: FAIL (no retry yet → "expected 2, received 1").

- [ ] **Step 4: Implement the guard in `generateSummary`** — replace the `try { … }` body (lines 182-194) with:

```ts
  const attempt = async (): Promise<GeminiSummaryResponse> => {
    const parsed = await generateJson(model, prompt, GeminiResponseSchema, 'summary');
    const { ratings, videoType, audience, tags } = parsed;
    const summary = resolveTranscriptTokens(parsed.summary, segments, videoId);
    const tldr = parsed.tldr ? trimToWords(parsed.tldr, 25) : undefined;
    const takeaways = parsed.takeaways?.map((t) => trimToWords(t, 20));
    return { summary, ratings, overallScore: computeOverallScore(ratings), videoType, audience, tags, tldr, takeaways };
  };
  try {
    let result = await attempt();
    // Guard: segments existed but no ▶ resolved → one re-roll (the miss is often stochastic). A throw
    // from attempt() propagates (error path unchanged); only the success-but-zero-▶ case retries.
    if (segments.length > 0 && !hasTimestamp(result.summary)) {
      result = await attempt();
      if (!hasTimestamp(result.summary)) warnTimestampMiss(videoId, segments.length, 2);
    }
    return result;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini summary failed: ${cause}`, { cause: err });
  }
```

- [ ] **Step 5: Convert the 12 existing success-path tokenless `generateSummary` tests** from `mockResolvedValueOnce` → `mockResolvedValue` so the guard's 2nd call returns the same fixture (it then warns + returns it; all field/prompt assertions still hold). The 4 throw-expecting tests (malformed JSON, out-of-range rating, invalid videoType, unexpected fields) are NOT changed — a throw propagates before the guard retries.

Tests to convert (by current line / title), change the **summary** mock from `mockResolvedValueOnce(` to `mockResolvedValue(`:

| Line | Title |
|---|---|
| 32 | returns summary text and ratings with values in range 1–5 |
| 51 | computes overallScore as arithmetic mean of 5 ratings |
| 85 | includes Korean language instruction in prompt for ko |
| 122 | returns videoType and audience when Gemini includes them |
| 140 | returns undefined videoType and audience when Gemini omits them |
| 170 | includes videoType and audience in prompt instructions |
| 201 | returns tags array when Gemini includes them |
| 217 | returns undefined tags when Gemini omits them |
| 232 | includes tags and structured ## section instructions |
| 252 | returns tldr and takeaways when Gemini includes them |
| 268 | returns undefined tldr and takeaways when Gemini omits them |
| 284 | sends an indexed transcript and asks for [[TS:i]] tokens |

The two ▶/degrade tests (297 "resolves [[TS:i]]", 311 "degrades … out-of-range") need NO change: 297 produces ▶ (no retry); 311 must ALSO convert `mockResolvedValueOnce`→`mockResolvedValue` because its `[[TS:9]]` degrades to 0 ▶ with segments present → the guard retries and the 2nd call would be undefined. **Add line 311 to the conversion** (13 total). After conversion its assertions (`not /▶|\[\[TS:/`, contains `body`) still hold.

- [ ] **Step 6: Implement the guard in `generateDeepDiveFromTranscript`** — replace its `try` body (337-342) with:

```ts
  const attempt = async (): Promise<string> => {
    const result = await model.generateContent(prompt, { timeout: REQUEST_TIMEOUT_MS });
    return resolveTranscriptTokens(result.response.text(), segments, videoId);
  };
  try {
    let out = await attempt();
    if (segments.length > 0 && !hasTimestamp(out)) {
      out = await attempt();
      if (!hasTimestamp(out)) warnTimestampMiss(videoId, segments.length, 2);
    }
    return out;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini deep-dive (transcript) failed: ${cause}`, { cause: err });
  }
```

- [ ] **Step 7: Implement warn-only in `generateDeepDiveCombined`** — replace its `try` body (397-403) with (NO retry; the expensive video upload must not double):

```ts
  try {
    const result = await model.generateContent(request, { timeout: REQUEST_TIMEOUT_MS });
    const out = resolveTranscriptTokens(result.response.text(), segments, videoId);
    if (segments.length > 0 && !hasTimestamp(out)) warnTimestampMiss(videoId, segments.length, 1);
    return out;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini deep-dive (combined) failed: ${cause}`, { cause: err });
  }
```

- [ ] **Step 8: Add a guard test to `gemini-deepdive-timestamps.test.ts`** (retry path):

```ts
it('retries once when attempt 1 lacks ▶, then resolves on attempt 2', async () => {
  generateContent
    .mockResolvedValueOnce({ response: { text: () => '## A\n\nbody\n\n## B\n\nmore' } })
    .mockResolvedValueOnce({ response: { text: () => '## A\n\n[[TS:0]]\n\nbody\n\n## B\n\n[[TS:1]]\n\nmore' } });
  const { generateDeepDiveFromTranscript } = await import('../../lib/gemini');
  const out = await generateDeepDiveFromTranscript(SEGMENTS, 'en', 'vid123');
  expect(generateContent).toHaveBeenCalledTimes(2);
  expect(out).toContain('▶');
});
```

(The existing two tests in this file use a persistent `jest.fn(async …)` returning ▶-bearing text → no retry → unchanged.)

- [ ] **Step 9: Add a warn-only test to `gemini-deepdive-combined.test.ts`** (no retry):

```ts
it('warns but does NOT retry when segments present and no ▶ (expensive video call)', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  generateContent.mockResolvedValue({ response: { text: () => '## Deep\nbody' } });
  await generateDeepDiveCombined('https://y/watch?v=v', SEGMENTS, 'en', 'v');
  expect(generateContent).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[timestamp-miss] v'));
  warn.mockRestore();
});
```

(The combined `beforeEach` default `'## Deep\nbody'` is tokenless; warn-only does not change call count or return value, so the existing 4 default-fixture tests still pass — they now emit a harmless warn.)

- [ ] **Step 10: Run targeted + full suite**

Run: `npx jest gemini` then `npm test` then `npx tsc --noEmit`
Expected: all green.

- [ ] **Step 11: Commit** — `feat(gemini): retry generation on missing ▶ timestamps (warn-only for combined)`

---

### Task 2: `force` flag on `ensureHtmlDoc` / `ensureDeepDiveHtml`

**Files:**
- Modify: `lib/html-doc/ensure.ts` (`ensureHtmlDoc`); `lib/deep-dive/ensure.ts` (`ensureDeepDiveHtml`)
- Test: `tests/lib/html-doc/ensure.test.ts`; `tests/lib/deep-dive/ensure.test.ts`

**Interfaces:**
- Produces:
  - `ensureHtmlDoc(videoId, outputFolder, onProgress, current = CURRENT_DOC_VERSION, force = false): Promise<void>`
  - `ensureDeepDiveHtml(videoId, outputFolder, onProgress, current = CURRENT_DEEP_DIVE_VERSION, force = false): Promise<void>`
  - When `force`, the re-gen branch runs regardless of version and stamps `current` (the true CURRENT_* value passed by callers).
- Consumes: existing `needsResummarize`, `needsRegenerate`, `writeSummaryDoc`, `writeDeepDiveDoc`, `runHtmlDoc`, `runDeepDiveHtml`.

- [ ] **Step 1: Write failing tests — summary** (append to `tests/lib/html-doc/ensure.test.ts`)

```ts
it('force=true on a current doc → re-summarizes and stamps current (not inflated)', async () => {
  withVideo({ docVersion: { major: 3, minor: 3 }, summaryHtml: 'htmls/base.html' });
  await ensureHtmlDoc('v1', 'out', () => {}, CURRENT_DOC_VERSION, true);
  expect(pipeline.writeSummaryDoc).toHaveBeenCalledWith(expect.objectContaining({ baseName: 'base' }));
  expect(patches).toEqual(expect.arrayContaining([expect.objectContaining({ docVersion: { major: 3, minor: 3 } })]));
});

it('force=false on a current doc → no-op (regression guard)', async () => {
  withVideo({ docVersion: { major: 3, minor: 3 }, summaryHtml: 'htmls/base.html' });
  await ensureHtmlDoc('v1', 'out', () => {}, CURRENT_DOC_VERSION, false);
  expect(pipeline.writeSummaryDoc).not.toHaveBeenCalled();
});
```

(Use the file's existing `withVideo`/`patches`/`CURRENT_DOC_VERSION` helpers and the actual videoId/outputFolder the suite uses — read the top of the file before writing.)

- [ ] **Step 2: Run — confirm RED** (`npx jest html-doc/ensure -t force`).

- [ ] **Step 3: Implement — summary.** Signature gains `force = false`; gate the re-gen branch:

```ts
  current: DocVersion = CURRENT_DOC_VERSION,
  force = false,
): Promise<void> {
```
```ts
  if (force || needsResummarize(stored, current)) {
```
(Everything else in that branch — `writeSummaryDoc`, metadata `updateVideoFields`, model deletion, `runHtmlDoc` — is unchanged. The final `updateVideoFields(outputFolder, videoId, { docVersion: current })` already stamps the true current.)

- [ ] **Step 4: Write failing tests — deep-dive** (append to `tests/lib/deep-dive/ensure.test.ts`, using its real-fs `writeIndex`/`makeVideo`/`storedVideo`/`CURRENT` helpers)

```ts
it('force=true on a current doc → regenerates cascade and stamps current', async () => {
  writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: CURRENT }));
  await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT, true);
  expect(mockWriteDeepDiveDoc).toHaveBeenCalled();
  expect(storedVideo(outputFolder).deepDiveVersion).toEqual(CURRENT);
});

it('force=false on a current doc → no-op (regression guard)', async () => {
  writeIndex(outputFolder, makeVideo({ deepDiveMd: MD_FILE, deepDiveHtml: HTML_PATH, deepDiveVersion: CURRENT }));
  await ensureDeepDiveHtml(VIDEO_ID, outputFolder, () => {}, CURRENT, false);
  expect(mockWriteDeepDiveDoc).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run — confirm RED** (`npx jest deep-dive/ensure -t force`).

- [ ] **Step 6: Implement — deep-dive.** Signature gains `force = false`; gate the re-gen branch:

```ts
  current: DeepDiveVersion = CURRENT_DEEP_DIVE_VERSION,
  force = false,
): Promise<void> {
```
```ts
  if (force || !video.deepDiveMd || needsRegenerate(stored, current)) {
```
(The branch body — `writeDeepDiveDoc`, `runDeepDiveHtml(videoId, outputFolder, deepDiveMd)`, single `updateVideoFields` stamping `current` — is unchanged.)

- [ ] **Step 7: Run targeted + full suite** (`npx jest ensure`, then `npm test`, then `npx tsc --noEmit`). Confirm no existing ensure test regressed (all use ≤4 positional args; `force` defaults false).

- [ ] **Step 8: Commit** — `feat(ensure): add force flag to re-gen current-version docs`

---

### Task 3: Health-check — `lib/timestamp-audit.ts` + script

**Files:**
- Create: `lib/timestamp-audit.ts`; `scripts/audit-timestamps.ts`
- Modify: `package.json` (add `audit-timestamps` script)
- Test: `tests/lib/timestamp-audit.test.ts`

**Interfaces:**
- Produces:
```ts
export interface KindAudit {
  total: number; withTs: number; noTsWouldRegen: number; noTsStuck: number; mdMissing: number;
  stuckIds: string[]; wouldRegenIds: string[];
}
export interface AuditReport { folder: string; summaries: KindAudit; deepDives: KindAudit; }
export function auditTimestamps(folder: string): AuditReport;
export function hasLeadingTimestamp(md: string): boolean;   // /^▶/m
export function countLeadingTimestamps(md: string): number; // (md.match(/^▶/gm) ?? []).length
```
- Consumes: `readIndex` (`lib/index-store`), `CURRENT_DOC_VERSION`, `CURRENT_DEEP_DIVE_VERSION`, `fs`, `path`.

- [ ] **Step 1: Write failing tests** (`tests/lib/timestamp-audit.test.ts`) — temp folder + synthetic index/.md fixtures. Cover: summary with ▶ (line-leading); summary no-▶ old major → wouldRegen; summary no-▶ current major → stuck; summary with **absent** `docVersion` + no ▶ → wouldRegen (defaults to {1,0}); summary whose `summaryMd` file is **missing on disk** → mdMissing; a `.md` whose only `▶` is inside a fenced block / mid-line → NOT counted withTs; one deep-dive stuck. Assert each `KindAudit` field + `stuckIds`.

```ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { auditTimestamps, hasLeadingTimestamp } from '../../lib/timestamp-audit';

function seed(videos: any[], files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  fs.writeFileSync(path.join(dir, 'playlist-index.json'), JSON.stringify({ videos }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

it('counts only line-leading ▶ and classifies stuck vs would-regen', () => {
  const dir = seed(
    [
      { id: 'a', summaryMd: 'a.md', docVersion: { major: 3, minor: 3 } },          // current, ▶ → withTs
      { id: 'b', summaryMd: 'b.md', docVersion: { major: 2, minor: 0 } },          // old, no ▶ → wouldRegen
      { id: 'c', summaryMd: 'c.md', docVersion: { major: 3, minor: 0 } },          // current, no ▶ → stuck
      { id: 'd', summaryMd: 'd.md' },                                              // absent ver, no ▶ → wouldRegen
      { id: 'e', summaryMd: 'e.md', docVersion: { major: 3, minor: 0 } },          // file missing → mdMissing
    ],
    {
      'a.md': '## 1\n▶ [0:00](u)\n\nbody',
      'b.md': '## 1\n\nbody',
      'c.md': '## 1\n\nbody',
      'd.md': 'see ▶ inline here\n```\n▶ fenced\n```',                              // no LINE-LEADING ▶
    },
  );
  const r = auditTimestamps(dir);
  expect(r.summaries.total).toBe(5);
  expect(r.summaries.withTs).toBe(1);
  expect(r.summaries.noTsWouldRegen).toBe(2);   // b, d
  expect(r.summaries.noTsStuck).toBe(1);         // c
  expect(r.summaries.mdMissing).toBe(1);         // e
  expect(r.summaries.stuckIds).toEqual(['c']);
  fs.rmSync(dir, { recursive: true, force: true });
});

it('hasLeadingTimestamp ignores fenced/inline ▶', () => {
  expect(hasLeadingTimestamp('▶ at start')).toBe(true);
  expect(hasLeadingTimestamp('text ▶ mid')).toBe(false);
});
```

- [ ] **Step 2: Run — confirm RED** (`npx jest timestamp-audit`).

- [ ] **Step 3: Implement `lib/timestamp-audit.ts`**

```ts
import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { CURRENT_DOC_VERSION } from './doc-version';
import { CURRENT_DEEP_DIVE_VERSION } from './deep-dive/version';

const PRE_FEATURE = { major: 1, minor: 0 };

export function hasLeadingTimestamp(md: string): boolean { return /^▶/m.test(md); }
export function countLeadingTimestamps(md: string): number { return (md.match(/^▶/gm) ?? []).length; }

export interface KindAudit {
  total: number; withTs: number; noTsWouldRegen: number; noTsStuck: number; mdMissing: number;
  stuckIds: string[]; wouldRegenIds: string[];
}
export interface AuditReport { folder: string; summaries: KindAudit; deepDives: KindAudit; }

function emptyKind(): KindAudit {
  return { total: 0, withTs: 0, noTsWouldRegen: 0, noTsStuck: 0, mdMissing: 0, stuckIds: [], wouldRegenIds: [] };
}

function classify(
  acc: KindAudit, folder: string, id: string, mdRel: string,
  storedMajor: number, currentMajor: number,
): void {
  acc.total++;
  const abs = path.join(folder, mdRel);
  if (!fs.existsSync(abs)) { acc.mdMissing++; return; }
  if (hasLeadingTimestamp(fs.readFileSync(abs, 'utf8'))) { acc.withTs++; return; }
  if (storedMajor >= currentMajor) { acc.noTsStuck++; acc.stuckIds.push(id); }
  else { acc.noTsWouldRegen++; acc.wouldRegenIds.push(id); }
}

export function auditTimestamps(folder: string): AuditReport {
  const { videos } = readIndex(folder);
  const summaries = emptyKind();
  const deepDives = emptyKind();
  for (const v of videos) {
    if (v.summaryMd) {
      const ver = v.docVersion ?? PRE_FEATURE;
      classify(summaries, folder, v.id, v.summaryMd, ver.major, CURRENT_DOC_VERSION.major);
    }
    if (v.deepDiveMd) {
      const ver = v.deepDiveVersion ?? PRE_FEATURE;
      classify(deepDives, folder, v.id, v.deepDiveMd, ver.major, CURRENT_DEEP_DIVE_VERSION.major);
    }
  }
  return { folder, summaries, deepDives };
}
```

- [ ] **Step 4: Run — confirm GREEN** (`npx jest timestamp-audit`).

- [ ] **Step 5: Create `scripts/audit-timestamps.ts`** (thin wrapper; mirrors `rerender-html.ts`)

```ts
/**
 * audit-timestamps.ts — read-only ▶-timestamp health-check over a corpus folder. NO Gemini.
 * Usage:  npm run audit-timestamps -- --folder <outputFolder>
 *         (defaults to OUTPUT_FOLDER). Exits non-zero if any SUMMARY is stuck (current major, no ▶).
 */
import { auditTimestamps, type KindAudit } from '../lib/timestamp-audit';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function line(label: string, k: KindAudit): void {
  console.log(`${label}: total ${k.total}, with ▶ ${k.withTs}, no-▶ would-regen ${k.noTsWouldRegen}, no-▶ STUCK ${k.noTsStuck}, md-missing ${k.mdMissing}`);
  if (k.stuckIds.length) console.log(`  stuck: ${k.stuckIds.join(', ')}`);
}

const folder = arg('folder') ?? process.env.OUTPUT_FOLDER ?? '';
if (!folder) { console.error('Set --folder <outputFolder> or OUTPUT_FOLDER'); process.exit(1); }

const r = auditTimestamps(folder);
console.log(`[${folder}]`);
line('Summaries', r.summaries);
line('Deep-dives', r.deepDives);
// Gate on SUMMARY stuck only — captionless deep-dives legitimately have 0 ▶ and can't be
// distinguished from bug-stuck ones by ▶-count, so gating on them would fail permanently.
process.exit(r.summaries.noTsStuck > 0 ? 1 : 0);
```

- [ ] **Step 6: Add npm script** to `package.json` (after `rerender-html`):

```json
    "rerender-html": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/rerender-html.ts",
    "audit-timestamps": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/audit-timestamps.ts"
```

- [ ] **Step 7: Smoke-run the script** against the real corpus to confirm it executes (read-only):

Run: `npm run audit-timestamps -- --folder ../youtube-playlist-summaries-official-plugins-data/agentic-ai-claude-code`
Expected: prints counts; reports the stuck IDs.

- [ ] **Step 8: Full suite + tsc, commit** — `feat(audit): read-only ▶-timestamp corpus health-check`

---

### Task 4: Batch repair — `lib/timestamp-repair.ts` + script

**Files:**
- Create: `lib/timestamp-repair.ts`; `scripts/repair-timestamps.ts`
- Modify: `package.json` (add `repair-timestamps` script)
- Test: `tests/lib/timestamp-repair.test.ts`

**Interfaces:**
- Produces:
```ts
export interface RepairOptions { run: boolean; stuckOnly: boolean; ids?: string[]; }
export interface RepairItem { videoId: string; kind: 'summary' | 'deep-dive'; reason: 'stuck' | 'would-regen'; }
export interface RepairOutcome { videoId: string; kind: 'summary' | 'deep-dive'; before: number; after: number; }
export interface RepairSkip { videoId: string; kind: 'summary' | 'deep-dive'; error: string; }
export interface RepairResult { dryRun: boolean; planned: RepairItem[]; repaired: RepairOutcome[]; skipped: RepairSkip[]; }
export function repairTimestamps(folder: string, opts: RepairOptions): Promise<RepairResult>;
```
- Consumes: `auditTimestamps`, `countLeadingTimestamps` (Task 3); `ensureHtmlDoc` (forced), `ensureDeepDiveHtml` (forced) (Task 2); `readIndex` (re-read md path after re-gen).

- [ ] **Step 1: Write failing tests** (`tests/lib/timestamp-repair.test.ts`) — jest.mock the two ensure modules + `auditTimestamps`. Cover: dry-run lists targets + zero ensure calls; `--run --stuck-only` calls the right ensure with `force:true` for exactly the stuck ids; a throwing ensure is captured in `skipped` and the batch continues; `--ids` filters.

```ts
jest.mock('../../lib/html-doc/ensure');
jest.mock('../../lib/deep-dive/ensure');
jest.mock('../../lib/timestamp-audit', () => ({
  ...jest.requireActual('../../lib/timestamp-audit'),
  auditTimestamps: jest.fn(),
}));
import { ensureHtmlDoc } from '../../lib/html-doc/ensure';
import { ensureDeepDiveHtml } from '../../lib/deep-dive/ensure';
import { auditTimestamps } from '../../lib/timestamp-audit';
import { repairTimestamps } from '../../lib/timestamp-repair';

const mockEnsure = jest.mocked(ensureHtmlDoc);
const mockEnsureDD = jest.mocked(ensureDeepDiveHtml);
const mockAudit = jest.mocked(auditTimestamps);

beforeEach(() => {
  jest.clearAllMocks();
  mockAudit.mockReturnValue({
    folder: 'f',
    summaries: { total: 2, withTs: 0, noTsWouldRegen: 1, noTsStuck: 1, mdMissing: 0, stuckIds: ['s1'], wouldRegenIds: ['w1'] },
    deepDives: { total: 0, withTs: 0, noTsWouldRegen: 0, noTsStuck: 0, mdMissing: 0, stuckIds: [], wouldRegenIds: [] },
  });
  mockEnsure.mockResolvedValue(undefined);
});

it('dry-run lists targets and calls no ensure functions', async () => {
  const r = await repairTimestamps('f', { run: false, stuckOnly: false });
  expect(r.dryRun).toBe(true);
  expect(r.planned.map((p) => p.videoId).sort()).toEqual(['s1', 'w1']);
  expect(mockEnsure).not.toHaveBeenCalled();
});

it('--run --stuck-only forces re-gen of exactly the stuck summaries', async () => {
  await repairTimestamps('f', { run: true, stuckOnly: true });
  expect(mockEnsure).toHaveBeenCalledTimes(1);
  expect(mockEnsure).toHaveBeenCalledWith('s1', 'f', expect.any(Function), undefined, true);
});

it('a throwing ensure is skipped and the batch continues', async () => {
  mockEnsure.mockRejectedValueOnce(new Error('no transcript'));
  const r = await repairTimestamps('f', { run: true, stuckOnly: false });
  expect(r.skipped).toEqual([expect.objectContaining({ videoId: 's1', error: expect.stringContaining('no transcript') })]);
  expect(mockEnsure).toHaveBeenCalledTimes(2); // s1 (throws) + w1 (continues)
});
```

(Note the `ensureHtmlDoc` call passes `undefined` for `current` so the default `CURRENT_DOC_VERSION` applies; `true` is `force`.)

- [ ] **Step 2: Run — confirm RED** (`npx jest timestamp-repair`).

- [ ] **Step 3: Implement `lib/timestamp-repair.ts`**

```ts
import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { auditTimestamps, countLeadingTimestamps } from './timestamp-audit';
import { ensureHtmlDoc } from './html-doc/ensure';
import { ensureDeepDiveHtml } from './deep-dive/ensure';
import type { ProgressEvent } from '../types';

export interface RepairOptions { run: boolean; stuckOnly: boolean; ids?: string[]; }
export interface RepairItem { videoId: string; kind: 'summary' | 'deep-dive'; reason: 'stuck' | 'would-regen'; }
export interface RepairOutcome { videoId: string; kind: 'summary' | 'deep-dive'; before: number; after: number; }
export interface RepairSkip { videoId: string; kind: 'summary' | 'deep-dive'; error: string; }
export interface RepairResult { dryRun: boolean; planned: RepairItem[]; repaired: RepairOutcome[]; skipped: RepairSkip[]; }

const noop = (_e: ProgressEvent): void => {};

function tsCount(folder: string, id: string, kind: 'summary' | 'deep-dive'): number {
  const v = readIndex(folder).videos.find((x) => x.id === id);
  const rel = kind === 'summary' ? v?.summaryMd : v?.deepDiveMd;
  if (!rel) return 0;
  const abs = path.join(folder, rel);
  return fs.existsSync(abs) ? countLeadingTimestamps(fs.readFileSync(abs, 'utf8')) : 0;
}

export async function repairTimestamps(folder: string, opts: RepairOptions): Promise<RepairResult> {
  const a = auditTimestamps(folder);
  const planned: RepairItem[] = [];
  const add = (ids: string[], kind: 'summary' | 'deep-dive', reason: 'stuck' | 'would-regen') => {
    for (const id of ids) planned.push({ videoId: id, kind, reason });
  };
  add(a.summaries.stuckIds, 'summary', 'stuck');
  add(a.deepDives.stuckIds, 'deep-dive', 'stuck');
  if (!opts.stuckOnly) {
    add(a.summaries.wouldRegenIds, 'summary', 'would-regen');
    add(a.deepDives.wouldRegenIds, 'deep-dive', 'would-regen');
  }
  const targets = opts.ids ? planned.filter((p) => opts.ids!.includes(p.videoId)) : planned;

  if (!opts.run) return { dryRun: true, planned: targets, repaired: [], skipped: [] };

  const repaired: RepairOutcome[] = [];
  const skipped: RepairSkip[] = [];
  let i = 0;
  for (const t of targets) {           // sequential — this loop is what serializes (the lib does not)
    i++;
    const before = tsCount(folder, t.videoId, t.kind);
    try {
      if (t.kind === 'summary') await ensureHtmlDoc(t.videoId, folder, noop, undefined, true);
      else await ensureDeepDiveHtml(t.videoId, folder, noop, undefined, true);
      const after = tsCount(folder, t.videoId, t.kind);
      repaired.push({ videoId: t.videoId, kind: t.kind, before, after });
      console.log(`[repair] ${i}/${targets.length} ${t.videoId} ${t.kind}: ${before} → ${after}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ videoId: t.videoId, kind: t.kind, error: msg });
      console.log(`[repair] ${i}/${targets.length} ${t.videoId} ${t.kind}: SKIPPED (${msg})`);
    }
  }
  return { dryRun: false, planned: targets, repaired, skipped };
}
```

- [ ] **Step 4: Run — confirm GREEN** (`npx jest timestamp-repair`).

- [ ] **Step 5: Create `scripts/repair-timestamps.ts`** (thin wrapper)

```ts
/**
 * repair-timestamps.ts — re-generate timestamp-less docs (drives the guarded lib path). Dry-run by default.
 * Usage:  npm run repair-timestamps -- --folder <f> [--run] [--stuck-only] [--ids a,b,c]
 * WARNING: do not run while the dev server is processing the same folder (both write playlist-index.json).
 */
import { repairTimestamps } from '../lib/timestamp-repair';

function flag(name: string): boolean { return process.argv.includes(`--${name}`); }
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const folder = arg('folder') ?? process.env.OUTPUT_FOLDER ?? '';
if (!folder) { console.error('Set --folder <outputFolder> or OUTPUT_FOLDER'); process.exit(1); }
const ids = arg('ids')?.split(',').map((s) => s.trim()).filter(Boolean);

repairTimestamps(folder, { run: flag('run'), stuckOnly: flag('stuck-only'), ids }).then((r) => {
  if (r.dryRun) {
    console.log(`[dry-run] would repair ${r.planned.length}:`);
    for (const p of r.planned) console.log(`  ${p.videoId} ${p.kind} (${p.reason})`);
    console.log('Re-run with --run to regenerate.');
  } else {
    console.log(`Repaired ${r.repaired.length}, skipped ${r.skipped.length}.`);
  }
}).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Add npm script** to `package.json`:

```json
    "audit-timestamps": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/audit-timestamps.ts",
    "repair-timestamps": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/repair-timestamps.ts"
```

- [ ] **Step 7: Dry-run smoke-test** (no Gemini calls):

Run: `npm run repair-timestamps -- --folder ../youtube-playlist-summaries-official-plugins-data/agentic-ai-claude-code --stuck-only`
Expected: lists the stuck docs, says "Re-run with --run".

- [ ] **Step 8: Full suite + tsc, commit** — `feat(repair): programmatic re-gen of timestamp-less docs (dry-run default)`

---

## Post-implementation (verification — after merge gate, NOT in-branch CI)

Per Option B: `npm run repair-timestamps -- --folder <…> --stuck-only --run` to repair the **6 stuck** docs. Do NOT run the unfiltered 226-doc repair (separate, user-gated cost decision).

## Self-review notes

- **Spec coverage:** guard (Task 1: summary+from-transcript retry, combined warn-only), force flag (Task 2), audit (Task 3), repair (Task 4), npm scripts (Tasks 3/4), Option B execution (post-impl). All spec components mapped.
- **Type consistency:** `force` is the 5th positional arg on both ensure functions (default false); repair passes `undefined, true` for `current, force`. `KindAudit`/`AuditReport`/`Repair*` names match across Tasks 3–4.
- **Known interaction (Task 1):** 13 existing `generateSummary` tests convert `mockResolvedValueOnce`→`mockResolvedValue`; the 4 throw-expecting tests are deliberately unchanged.
