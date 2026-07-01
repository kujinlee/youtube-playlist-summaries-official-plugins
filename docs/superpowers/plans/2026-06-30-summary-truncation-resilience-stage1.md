# Summary Truncation Resilience — Stage 1 (Detect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a completeness detector, wire it as a non-blocking generation-time warning, and ship a read-only corpus audit — so truncated summaries become observable (no auto-action yet).

**Architecture:** One pure detector `lib/summary-completeness.ts` (the single source of truth for the fingerprint). Two consumers this stage: a `console.warn` in `writeSummaryDoc` (pipeline), and `lib/summary-audit.ts` + `scripts/audit-summaries.ts` (mirrors the existing `timestamp-audit` / `audit-timestamps` pattern). Stages 2 (auto-retry) and 3 (menu) are separate plans.

**Tech Stack:** TypeScript, jest + ts-jest, ts-node scripts.

## Global Constraints
- Detector is **pure** and **never throws** (fails closed → reports suspicious). No I/O in `summary-completeness.ts`.
- Terminal set (exact): ends with one of `. ! ? … 。 ！ ？`, optionally followed by ONE closing `) ] " ” ’ 」 »`. Bare `)`, bare `:`, `—`, `,`, `;` are NOT terminal.
- Structural-ending guards (complete w/o punctuation): horizontal rule, table row, URL-only, link-only, closing code fence. Prose inside a list item is NOT exempt.
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
  it('flags mid-word / comma / dangling colon / dangling paren endings', () => {
    for (const end of ['into a single', 'first,', 'The key points:', 'as shown (']) {
      expect(checkSummaryCompleteness(withSections(end)).complete).toBe(false);
    }
  });
  it('flags a bare ) ending (parenthetical/link close is not a sentence end)', () => {
    expect(checkSummaryCompleteness(withSections('see the diagram (above)')).complete).toBe(false);
  });
  it('accepts a trailing horizontal rule after complete prose (doc-236 case)', () => {
    expect(checkSummaryCompleteness(withSections('Done.\n\n-----')).complete).toBe(true);
  });
  it('accepts terminal punctuation followed by a closing quote', () => {
    expect(checkSummaryCompleteness(withSections('he said "go."')).complete).toBe(true);
  });
  it('treats table-row / URL-only / link-only endings as complete (low confidence)', () => {
    expect(checkSummaryCompleteness(withSections('| a | b |')).complete).toBe(true);
    expect(checkSummaryCompleteness(withSections('https://example.com/x')).complete).toBe(true);
  });
  it('flags prose cut off inside a list item', () => {
    expect(checkSummaryCompleteness(withSections('- The agent must recover from')).complete).toBe(false);
  });
  it('flags zero-section and empty input', () => {
    expect(checkSummaryCompleteness('no headings here, just text.').complete).toBe(false);
    expect(checkSummaryCompleteness('   ').complete).toBe(false);
  });
  it('flags an unterminated code fence (low confidence)', () => {
    const r = checkSummaryCompleteness('## 1. A\n▶ [0:00–1:00](u)\n```\ncode without close');
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
const HR = /^([-*_])\1{2,}$/;               // horizontal rule (already trimmed)
const TABLE_ROW = /^\|.*\|$/;
const FENCE = /^(```|~~~)/;
const URL_ONLY = /^<?https?:\/\/\S+>?$/;
const LINK_ONLY = /^!?\[[^\]]*\]\([^)]*\)$/;
const TRAILING_TS = /\[\[TS:\d+\]\]$/;

export function checkSummaryCompleteness(markdown: string): CompletenessResult {
  try {
    if (typeof markdown !== 'string') return { complete: false, reason: 'not a string', confidence: 'low' };
    const lines = markdown.split('\n');
    if ((markdown.match(/^## /gm) ?? []).length === 0) return { complete: false, reason: 'zero sections', confidence: 'high' };

    // Unterminated fence → truncated mid-code.
    if (lines.filter((l) => FENCE.test(l.trim())).length % 2 === 1) {
      return { complete: false, reason: 'unterminated code fence', confidence: 'low' };
    }

    let last = '';
    for (let i = lines.length - 1; i >= 0; i--) { if (lines[i].trim() !== '') { last = lines[i].trim(); break; } }
    if (last === '') return { complete: false, reason: 'empty', confidence: 'high' };

    if (TRAILING_TS.test(last)) return { complete: false, reason: 'unresolved timestamp token', confidence: 'high' };
    if (HR.test(last) || FENCE.test(last)) return { complete: true };
    if (TABLE_ROW.test(last) || URL_ONLY.test(last) || LINK_ONLY.test(last)) return { complete: true, confidence: 'low' };
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
it('warns [summary-suspicious] when the generated summary looks truncated', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // ...arrange mocks so generateSummary yields summary ending mid-sentence...
  await writeSummaryDoc(input);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('[summary-suspicious] vidX'));
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

- [ ] **Step 1: Write the failing test** (`tests/lib/summary-audit.test.ts`) — write a temp folder with an index + 2 md files (one complete, one truncated); assert the report lists only the truncated one; assert a missing md file is reported (not thrown).

```ts
it('lists truncated summaries and reports missing files without throwing', () => {
  // write index.json with videos [good.md, bad.md, gone.md]; good ends '.', bad ends mid-word, gone absent
  const r = auditSummaries(dir);
  expect(r.suspects.map((s) => s.id).sort()).toEqual(['bad', 'gone']);
  expect(r.total).toBe(3);
});
```

- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** (`lib/summary-audit.ts`) — iterate `readIndex(folder).videos`; for each with `summaryMd`, read the file (missing → suspect `reason:'md-missing'`), else run `checkSummaryCompleteness`; push suspects. Resolve `serial` from the `NNN_` filename prefix. Never throws per-file.

```ts
import fs from 'fs';
import path from 'path';
import { readIndex } from './index-store';
import { checkSummaryCompleteness } from './summary-completeness';

export interface SummaryAuditReport {
  folder: string; total: number;
  suspects: Array<{ id: string; serial: string | null; reason: string; confidence: string }>;
}

export function auditSummaries(folder: string): SummaryAuditReport {
  const { videos } = readIndex(folder);
  const suspects: SummaryAuditReport['suspects'] = [];
  let total = 0;
  for (const v of videos) {
    if (!v.summaryMd) continue;
    total++;
    const serial = /^(\d+)_/.exec(v.summaryMd)?.[1] ?? null;
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

- [ ] **Step 4: Implement the script** (`scripts/audit-summaries.ts`) — mirror `audit-timestamps.ts`: `--folder` arg or `OUTPUT_FOLDER`; print `[folder] total N, suspects M` then one line per suspect (`serial | id | reason | confidence`); `process.exit(suspects.length > 0 ? 1 : 0)`.

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
- **Type consistency:** `CompletenessResult` shape identical across tasks; `checkSummaryCompleteness(markdown: string)` signature stable.
- **Smoke check for doc-236:** Step 7 explicitly asserts the horizontal-rule guard prevents the known false positive.
