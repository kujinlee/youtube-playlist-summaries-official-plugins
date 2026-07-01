# Summary Truncation Resilience — Stage 1 (Detect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Status:** v2 — Codex plan-reviewed (2 Blocking + HIGH addressed); AFK-approved via adversarial review.

**Goal:** Add a completeness detector, wire it as a non-blocking generation-time warning, and ship a read-only corpus audit — so truncated summaries become observable (no auto-action yet).

**Architecture:** One pure detector `lib/summary-completeness.ts` (the single source of truth for the fingerprint). Two consumers this stage: a `console.warn` in `writeSummaryDoc` (pipeline), and `lib/summary-audit.ts` + `scripts/audit-summaries.ts` (mirrors the existing `timestamp-audit` / `audit-timestamps` pattern). Stages 2 (auto-retry) and 3 (menu) are separate plans.

**Tech Stack:** TypeScript, jest + ts-jest, ts-node scripts.

## Global Constraints
- Detector is **pure** and **never throws** (fails closed → reports suspicious). No I/O in `summary-completeness.ts`.
- Terminal set (exact): ends with one of `. ! ? … 。 ！ ？`, optionally followed by ONE closing `) ] " ” ’ 」 »`. Bare `)`, bare `:`, `—`, `,`, `;` are NOT terminal.
- **Genuinely-complete structural endings** (`complete: true`, high confidence): a horizontal rule (`-----`, the doc-236 case) or a closing code fence.
- **Suspicious structural endings** (`complete: false`, `confidence: 'low'` — spec §Fingerprint "flagged, not blindly passed"): a final line that is a bare table row, URL-only, or link-only. Prose inside a list item is NOT exempt (flagged high).
- Fence detection tracks the **opener marker style + length**; a closer must match char class and be ≥ opener length (a `` ``` `` line inside a 4-backtick block is not a closer; `~~~` ≠ ```).
- `tsc --noEmit` clean + full `npm test` green before each commit.

---

### Task 1: `checkSummaryCompleteness` detector + unit tests

**Files:**
- Create: `lib/summary-completeness.ts`
- Test: `tests/lib/summary-completeness.test.ts`

**Interfaces:**
- Produces: `export interface CompletenessResult { complete: boolean; reason?: string; confidence?: 'high' | 'low' }` and `export function checkSummaryCompleteness(markdown: string): CompletenessResult`

- [ ] **Step 1: Write the failing test** (`tests/lib/summary-completeness.test.ts`)

```ts
import { checkSummaryCompleteness } from '../../lib/summary-completeness';

const withSections = (body: string) => `## 1. A\n▶ [0:00–1:00](u)\nsome text.\n\n## Conclusion\n▶ [1:00–2:00](u)\n${body}`;

describe('checkSummaryCompleteness', () => {
  it('accepts a summary ending on terminal punctuation', () => {
    expect(checkSummaryCompleteness(withSections('Wrapped up nicely.')).complete).toBe(true);
  });
  it('flags a summary ending mid-sentence', () => {
    const r = checkSummaryCompleteness(withSections('this leads to information being'));
    expect(r.complete).toBe(false);
    expect(r.reason).toMatch(/mid-sentence/);
  });
  it('flags mid-word / comma / semicolon / dangling colon / dangling paren endings', () => {
    for (const end of ['into a single', 'first,', 'moreover;', 'The key points:', 'as shown (']) {
      expect(checkSummaryCompleteness(withSections(end)).complete).toBe(false);
    }
  });
  it('flags a bare ) ending (parenthetical/link close is not a sentence end)', () => {
    expect(checkSummaryCompleteness(withSections('see the diagram (above)')).complete).toBe(false);
  });
  it('accepts an ellipsis ending', () => {
    expect(checkSummaryCompleteness(withSections('and so on…')).complete).toBe(true);
  });
  it('accepts a trailing horizontal rule after complete prose (doc-236 case)', () => {
    expect(checkSummaryCompleteness(withSections('Done.\n\n-----')).complete).toBe(true);
  });
  it('accepts terminal punctuation followed by a closing quote', () => {
    expect(checkSummaryCompleteness(withSections('he said "go."')).complete).toBe(true);
  });
  it('ignores trailing whitespace / multiple blank lines when finding the last line', () => {
    expect(checkSummaryCompleteness(withSections('All wrapped up.   \n\n\n   ')).complete).toBe(true);
  });
  it('accepts a closed fenced code block ending', () => {
    expect(checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\ntext.\n\n## Conclusion\n▶ [1:00–2:00](u)\nSee:\n```\ncode\n```').complete).toBe(true);
  });
  it('flags table-row / URL-only / link-only endings as suspicious (low confidence)', () => {
    for (const end of ['| a | b |', 'https://example.com/x', '[text](https://example.com)']) {
      const r = checkSummaryCompleteness(withSections(end));
      expect(r.complete).toBe(false);
      expect(r.confidence).toBe('low');
    }
  });
  it('flags a summary ending on a bare ▶ timestamp line with no prose body', () => {
    // Conclusion header + ▶ line but no body text after it → truncated.
    expect(checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\nbody.\n\n## Conclusion\n▶ [1:00–2:00](u)').complete).toBe(false);
  });
  it('flags prose cut off inside a list item', () => {
    expect(checkSummaryCompleteness(withSections('- The agent must recover from')).complete).toBe(false);
  });
  it('flags zero-section and empty input', () => {
    expect(checkSummaryCompleteness('no headings here, just text.').complete).toBe(false);
    expect(checkSummaryCompleteness('   ').complete).toBe(false);
  });
  it('flags an unterminated code fence (low confidence); a shorter inner ``` in a 4-backtick block is not a closer', () => {
    const r = checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\n````\n```\ncode without close');
    expect(r.complete).toBe(false);
    expect(r.confidence).toBe('low');
  });
  it('flags an unresolved trailing [[TS:i]] token', () => {
    expect(checkSummaryCompleteness(withSections('[[TS:3]]')).complete).toBe(false);
  });
  it('never throws (fails closed)', () => {
    // @ts-expect-error deliberate bad input
    expect(() => checkSummaryCompleteness(null)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest summary-completeness` → FAIL (module not found)

- [ ] **Step 3: Implement** (`lib/summary-completeness.ts`)

```ts
export interface CompletenessResult {
  complete: boolean;
  reason?: string;
  confidence?: 'high' | 'low';
}

// Ends on sentence punctuation, optionally + one closing quote/bracket. Bare ) : — , ; are NOT terminal.
const TERMINAL = /[.!?…。！？][)\]"”’」»]?$/;
const HR = /^([-*_])\1{2,}$/;                 // horizontal rule (already trimmed)
const FENCE_LINE = /^(`{3,}|~{3,})\s*$/;      // a line that is ONLY a fence marker
const FENCE_ANY = /^\s*(`{3,}|~{3,})/;        // any line opening/closing a fence
const TABLE_ROW = /^\|.*\|$/;
const URL_ONLY = /^<?https?:\/\/\S+>?$/;
const LINK_ONLY = /^!?\[[^\]]*\]\([^)]*\)$/;
const TRAILING_TS = /\[\[TS:\d+\]\]$/;

/** True if the doc is still inside an open code fence at EOF. Closer must match opener char-class and be ≥ its length. */
function fenceOpenAtEnd(lines: string[]): boolean {
  let opener: string | null = null;
  for (const raw of lines) {
    const m = FENCE_ANY.exec(raw);
    if (!m) continue;
    const marker = m[1];
    if (opener === null) opener = marker;
    else if (marker[0] === opener[0] && marker.length >= opener.length) opener = null; // valid close
    // else: inner fence of other style / shorter length → part of the block, ignore
  }
  return opener !== null;
}

export function checkSummaryCompleteness(markdown: string): CompletenessResult {
  try {
    if (typeof markdown !== 'string') return { complete: false, reason: 'not a string', confidence: 'low' };
    const lines = markdown.split('\n');
    if ((markdown.match(/^## /gm) ?? []).length === 0) return { complete: false, reason: 'zero sections', confidence: 'high' };

    if (fenceOpenAtEnd(lines)) return { complete: false, reason: 'unterminated code fence', confidence: 'low' };

    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() !== '') { last = lines[i].trim(); break; } }
    if (last === '') return { complete: false, reason: 'empty', confidence: 'high' };

    if (TRAILING_TS.test(last)) return { complete: false, reason: 'unresolved timestamp token', confidence: 'high' };
    // Genuinely-complete structural endings.
    if (HR.test(last) || FENCE_LINE.test(last)) return { complete: true };
    // Suspicious structural endings — flag low-confidence, do NOT blindly pass (spec §Fingerprint).
    if (TABLE_ROW.test(last) || URL_ONLY.test(last) || LINK_ONLY.test(last)) {
      return { complete: false, reason: 'ends on a structural line (table/URL/link)', confidence: 'low' };
    }
    if (TERMINAL.test(last)) return { complete: true };
    return { complete: false, reason: 'ends mid-sentence', confidence: 'high' };
  } catch {
    return { complete: false, reason: 'detector error', confidence: 'low' };
  }
}
```

- [ ] **Step 4: Run tests** — `npx jest summary-completeness` → PASS
- [ ] **Step 5: `npx tsc --noEmit`** → clean
- [ ] **Step 6: Commit** — `feat(summary): add checkSummaryCompleteness detector`

---

### Task 2: generation-time `[summary-suspicious]` warning

**Files:**
- Modify: `lib/pipeline.ts` (`writeSummaryDoc`, after `const summary = padDividers(rawSummary)` ~line 52)
- Test: `tests/lib/pipeline.test.ts` (or a focused new test file if the pipeline mock setup is heavy)

**Interfaces:**
- Consumes: `checkSummaryCompleteness` from Task 1.

- [ ] **Step 1: Write the failing test** — mock `generateSummary` to return a truncated summary; assert `console.warn` called with `[summary-suspicious] <videoId>` and that `writeSummaryDoc` still returns normally (never blocks).

```ts
it('warns [summary-suspicious] with a reason when truncated, but still returns (non-blocking)', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // ...arrange mocks so generateSummary yields a summary ending mid-sentence...
  const result = await writeSummaryDoc(input);              // must NOT throw
  expect(result.summaryMd).toBeTruthy();                    // doc still written
  expect(warn).toHaveBeenCalledWith(
    expect.stringMatching(/\[summary-suspicious\] vidX:.*(mid-sentence|structural|section)/),
  );
  warn.mockRestore();
});
it('does NOT warn when the generated summary is complete', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // ...arrange mocks so generateSummary yields a summary ending on a period...
  await writeSummaryDoc(input);
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('[summary-suspicious]'));
  warn.mockRestore();
});
```

- [ ] **Step 2: Run → FAIL** (`npx jest pipeline`)
- [ ] **Step 3: Implement** — after building `summary`, add:

```ts
const completeness = checkSummaryCompleteness(summary);
if (!completeness.complete) {
  console.warn(`[summary-suspicious] ${videoId}: ${completeness.reason} (confidence=${completeness.confidence})`);
}
```

- [ ] **Step 4: Run → PASS** — `npx jest pipeline`
- [ ] **Step 5: Full suite + tsc** — `npm test` green, `npx tsc --noEmit` clean
- [ ] **Step 6: Commit** — `feat(summary): warn at generation when a summary looks truncated`

---

### Task 3: `summary-audit` lib + `audit-summaries` script

**Files:**
- Create: `lib/summary-audit.ts`
- Create: `scripts/audit-summaries.ts`
- Modify: `package.json` (scripts: add `audit-summaries`)
- Test: `tests/lib/summary-audit.test.ts`

**Interfaces:**
- Produces: `export interface SummaryAuditReport { folder: string; total: number; suspects: Array<{ id: string; serial: string | null; reason: string; confidence: string }> }` and `export function auditSummaries(folder: string): SummaryAuditReport`
- Consumes: `readIndex` (index-store), `checkSummaryCompleteness` (Task 1).

- [ ] **Step 1: Write the failing test** (`tests/lib/summary-audit.test.ts`) — write a temp folder with an index (videos carrying `serialNumber`) + md files (complete, truncated, structural-low-confidence, missing); assert suspects, index-sourced serial, and no-throw.

```ts
it('lists truncated + structural suspects with index-sourced serial, reports missing, never throws', () => {
  // index videos:
  //   good  (serialNumber 10, good.md ends '.')          → not a suspect
  //   bad   (serialNumber 11, bad.md ends mid-word)       → suspect reason mid-sentence, high
  //   tbl   (serialNumber 12, tbl.md ends '| a | b |')    → suspect confidence low
  //   gone  (serialNumber 13, gone.md absent)             → suspect reason md-missing
  const r = auditSummaries(dir);
  expect(r.suspects.map((s) => s.id).sort()).toEqual(['bad', 'gone', 'tbl']);
  expect(r.suspects.find((s) => s.id === 'bad')!.serial).toBe(11);           // from index, not filename
  expect(r.suspects.find((s) => s.id === 'tbl')!.confidence).toBe('low');
  expect(r.total).toBe(4);
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** (`lib/summary-audit.ts`) — iterate `readIndex(folder).videos`; for each with `summaryMd`, read the file (missing → suspect `reason:'md-missing'`), else run `checkSummaryCompleteness`; push suspects. **Serial from the index record (`v.serialNumber`), NOT filename** (Codex BLOCKING). Never throws per-file.

```ts
import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { checkSummaryCompleteness } from './summary-completeness';

export interface SummaryAuditReport {
  folder: string; total: number;
  suspects: Array<{ id: string; serial: number | null; reason: string; confidence: string }>;
}

export function auditSummaries(folder: string): SummaryAuditReport {
  const { videos } = readIndex(folder);
  const suspects: SummaryAuditReport['suspects'] = [];
  let total = 0;
  for (const v of videos) {
    if (!v.summaryMd) continue;
    total++;
    const serial = v.serialNumber ?? null;                 // index-sourced (spec)
    const abs = path.join(folder, v.summaryMd);
    let md: string;
    try { md = fs.readFileSync(abs, 'utf8'); }
    catch { suspects.push({ id: v.id, serial, reason: 'md-missing', confidence: 'high' }); continue; }
    const r = checkSummaryCompleteness(md);
    if (!r.complete) suspects.push({ id: v.id, serial, reason: r.reason ?? 'suspicious', confidence: r.confidence ?? 'high' });
  }
  return { folder, total, suspects };
}
```

- [ ] **Step 4: Implement the script** (`scripts/audit-summaries.ts`) — mirror `audit-timestamps.ts`: `--folder` arg or `OUTPUT_FOLDER`; print `[folder] total N, suspects M` then one line per suspect (`serial | id | reason | confidence`). **`process.exit(0)` always — read-only report tool** (Codex BLOCKING; a non-zero exit would break shell/CI use of a reporting command).

- [ ] **Step 5: Wire `package.json`** — add:
```
"audit-summaries": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/audit-summaries.ts",
```

- [ ] **Step 6: Run → PASS** — `npx jest summary-audit`
- [ ] **Step 7: Smoke-run the script** — `npm run audit-summaries -- --folder <agentic-ai/raw>`; expect 0 suspects among the just-fixed 12 (doc 236 must NOT appear — the horizontal-rule guard).
- [ ] **Step 8: Full suite + tsc** → green/clean
- [ ] **Step 9: Commit** — `feat(summary): read-only audit-summaries corpus sweep`

---

## Self-Review
- **Spec coverage:** detector (Task 1), generation warn (Task 2), audit (Task 3) = all three Stage-1 consumers. ✓
- **Placeholder scan:** detector + audit code is complete; Task 2/pipeline-test arrange is described (pipeline mock setup is heavy — implementer follows existing `tests/lib/pipeline.test.ts` patterns). Acceptable (not a code placeholder).
- **Type consistency:** `CompletenessResult` shape identical across tasks; `checkSummaryCompleteness(markdown: string)` signature stable; audit `serial: number | null` matches `v.serialNumber`.
- **Codex plan review addressed:** audit exits 0 always (Blocking); serial from `v.serialNumber` (Blocking); table/URL/link endings are low-confidence suspects not `complete:true` (HIGH); fence tracker matches opener style+length (Medium); fixtures added for link-only, bare-▶-line, semicolon/ellipsis/whitespace, closed-fence, structural-low-confidence (Medium); pipeline test asserts reason + non-blocking + negative case (Medium); audit test asserts index-sourced serial + low-confidence (Medium).
- **Batch coverage:** batch docs → `ensureHtmlDoc` → `writeSummaryDoc`, so the Task-2 warning fires on batch re-summary too (no separate wiring — Codex INFO).
- **Smoke check for doc-236:** Step 7 asserts the horizontal-rule guard prevents the known false positive.
