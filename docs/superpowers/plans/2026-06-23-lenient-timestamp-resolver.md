# Lenient Timestamp Resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `resolveTranscriptTokens` keep the resolvable `[[TS:i]]` tokens (longest increasing-offset subsequence) and drop only the bad ones, instead of degrading all-or-nothing.

**Architecture:** Single function rewrite in `lib/transcript-timestamps.ts`. Pass 1 records own-line non-fenced tokens; a candidate filter + LIS selects the kept set; a `keptMap` drives a fence-aware Pass-2 rebuild. No signature change, no other file touched.

**Tech Stack:** TypeScript, jest + ts-jest.

## Global Constraints

- ▶ marker is literally `'▶'` (U+25B6). Output lines are built only via the existing `timestampLine(start, end, videoId)`.
- Selection is on **resolved offset** (LIS, strictly increasing), not index. Deterministic: smallest-predecessor tie-break, reconstruct from the earliest position at global max length.
- **Inverted-range guard:** a candidate must satisfy `Math.floor(offset) < videoDuration` (so the final kept token's `end = videoDuration` stays `> start`).
- Global all-or-nothing preconditions: `N===0` → no-op; no `videoId` / `segments.length===0` / non-finite `videoDuration` → drop all.
- `videoDuration = Math.floor(lastSeg.offset + lastSeg.duration)` (unchanged).
- No version bump (resolver runs at generation time). Full `npm test` + `npx tsc --noEmit` green before commit.

---

### Task 1: Rewrite `resolveTranscriptTokens` to be lenient

**Files:**
- Modify: `lib/transcript-timestamps.ts` (`resolveTranscriptTokens` :57-118; the `OWN_LINE_TOKEN`/`ANY_TOKEN`/`FENCE` consts and all helpers stay as-is)
- Test: `tests/lib/transcript-timestamps.test.ts` (add new cases, update 5 existing); `tests/lib/gemini.test.ts` (confirm the one out-of-range case)

**Interfaces:**
- Unchanged public signature: `resolveTranscriptTokens(markdown: string, segments: TranscriptSegment[], videoId: string | null): string`.

- [ ] **Step 1: Write the new failing tests** — add to the `describe('resolveTranscriptTokens', …)` block in `tests/lib/transcript-timestamps.test.ts` (uses the file's existing `SEGS`: offsets 0/135/330/600, last dur 30 → `videoDuration = 630` = `10:30`).

```ts
describe('resolveTranscriptTokens — lenient selection', () => {
  it('keeps valid tokens and drops only an out-of-range one (partial)', () => {
    const md = '## 1. A\n[[TS:0]]\n\n## 2. B\n[[TS:99]]\n\nbody';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30](https://www.youtube.com/watch?v=vid123&t=0s)'); // only kept → end=duration
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('keeps the longer increasing tail, dropping a spuriously-large early token (LIS)', () => {
    // offsets in doc order: [600(idx3), 0(idx0), 135(idx1), 330(idx2)] → LIS keeps idx0,1,2
    const md = '## A\n[[TS:3]]\n\n## B\n[[TS:0]]\n\n## C\n[[TS:1]]\n\n## D\n[[TS:2]]\n\nx';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–2:15]');   // idx0 → next kept idx1
    expect(out).toContain('▶ [2:15–5:30]');   // idx1 → idx2
    expect(out).toContain('▶ [5:30–10:30]');  // idx2 (last kept) → duration
    expect((out.match(/▶/g) ?? []).length).toBe(3); // idx3 (offset 600) dropped
  });

  it('candidate-removes an in-range index whose offset is NaN, keeps the sibling', () => {
    const segs = [{ text: 'a', offset: 0, duration: 5 }, { text: 'b', offset: NaN, duration: 5 }, { text: 'c', offset: 200, duration: 10 }];
    const md = '## A\n[[TS:0]]\n\n## B\n[[TS:1]]\n\n## C\n[[TS:2]]\n\nx';
    const out = resolveTranscriptTokens(md, segs, 'vid123');
    expect((out.match(/▶/g) ?? []).length).toBe(2); // idx1 (NaN offset) dropped; idx0,idx2 kept
    expect(out).not.toMatch(/\[\[TS:/);
  });

  it('does not count a malformed token inside a fence (left verbatim)', () => {
    const md = '## A\n[[TS:0]]\n\n```\n[[TS:99]]\n```\n';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [0:00–10:30]');     // sole own-line token kept, end=duration (fenced not counted)
    expect(out).toContain('```\n[[TS:99]]\n```'); // fenced token verbatim
  });

  it('single kept token renders start..videoDuration', () => {
    const md = '## A\n[[TS:1]]\n\nbody';
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect(out).toContain('▶ [2:15–10:30](https://www.youtube.com/watch?v=vid123&t=135s)');
  });

  it('all-decreasing offsets → keeps exactly the FIRST document candidate', () => {
    const md = '## A\n[[TS:3]]\n\n## B\n[[TS:2]]\n\n## C\n[[TS:1]]\n\nx'; // offsets 600,330,135 decreasing
    const out = resolveTranscriptTokens(md, SEGS, 'vid123');
    expect((out.match(/▶/g) ?? []).length).toBe(1);
    expect(out).toContain('▶ [10:00–10:30]'); // idx3 (off600), first doc candidate; end=duration
  });

  it('duplicate offsets → drops the later-in-document duplicate', () => {
    const segs = [{ text: 'a', offset: 0, duration: 5 }, { text: 'b', offset: 100, duration: 5 }, { text: 'c', offset: 100, duration: 5 }, { text: 'd', offset: 200, duration: 5 }];
    const md = '## A\n[[TS:0]]\n\n## B\n[[TS:1]]\n\n## C\n[[TS:2]]\n\n## D\n[[TS:3]]\n\nx';
    const out = resolveTranscriptTokens(md, segs, 'vid123');
    expect((out.match(/▶/g) ?? []).length).toBe(3); // idx0,idx1,idx3 kept; idx2 (dup offset 100) dropped
  });

  it('warns "kept M of N" on a partial result', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    resolveTranscriptTokens('## A\n[[TS:0]]\n\n## B\n[[TS:99]]\n\nx', SEGS, 'vid123');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept 1 of 2'));
    warn.mockRestore();
  });

  it('warns "dropped all N" when every token is invalid', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const out = resolveTranscriptTokens('## A\n[[TS:98]]\n\n## B\n[[TS:99]]\n\nx', SEGS, 'vid123');
    expect(out).not.toMatch(/▶/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped all 2'));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Update the 5 existing all-or-nothing tests** in `tests/lib/transcript-timestamps.test.ts` (match by title; line numbers may drift):
  - `"degrades … when any index is out of range"` (`[[TS:0]],[[TS:99]]`) → now: `expect(out).toContain('▶ [0:00–10:30]'); expect(out).not.toMatch(/\[\[TS:/);`. Rename to `"keeps the valid token, drops the out-of-range one"`.
  - `"degrades when indices are not strictly increasing"` (`[[TS:2]],[[TS:1]]`) → now keeps the first doc candidate `[[TS:2]]` (idx2 off330): `expect(out).toContain('▶ [5:30–10:30]'); expect((out.match(/▶/g) ?? []).length).toBe(1);`. Rename `"keeps the first document candidate when offsets decrease"`.
  - `"degrades AND strips a malformed non-digit own-line token"` (`[[TS:0]],[[TS:-1]]`) → now: `expect(out).toContain('▶ [0:00–10:30]'); expect(out).not.toMatch(/\[\[TS:/);`. Rename `"drops a negative-index token, keeps the valid one"`.
  - `"degrades when segment offsets are non-monotonic even though indices increase"` (segs `[off100,off90]`, `[[TS:0]],[[TS:1]]`) → `videoDuration=95`; idx0 (off100) excluded by `offset<videoDuration`, idx1 (off90) kept: `expect(out).toContain('▶ [1:30–1:35]'); expect((out.match(/▶/g) ?? []).length).toBe(1);`. Rename `"keeps only the token whose offset is below videoDuration"`.
  - `"degrades + scrubs an embedded-] malformed own-line token"` (`[[TS:0]],[[TS:a]b]]`) → keeps `[[TS:0]]`: `expect(out).toContain('▶ [0:00–10:30]'); expect(out).not.toMatch(/\[\[TS:/);`. Rename `"drops a malformed own-line token, keeps the valid one"`.

  Leave UNCHANGED (still 0 ▶): `"treats a float token as invalid"` (`[[TS:1.5]]`), `"degrades when the final segment … has non-finite timing"`, `"degrades when videoId is missing or segments are empty"`, and the happy/no-token/inline/fence tests.

- [ ] **Step 3: Run — confirm RED** (`npx jest transcript-timestamps`). New lenient tests fail (still all-or-nothing); the 5 updated tests fail (old code emits no ▶).

- [ ] **Step 4: Rewrite `resolveTranscriptTokens`** — replace the function body (lib/transcript-timestamps.ts:57-118) with:

```ts
export function resolveTranscriptTokens(
  markdown: string,
  segments: TranscriptSegment[],
  videoId: string | null,
): string {
  const lines = markdown.split('\n');

  // Pass 1: record own-line non-fenced tokens in document order.
  const tokens: { lineIndex: number; index: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const m = line.match(OWN_LINE_TOKEN);
    if (m) {
      const raw = m[1].trim();
      tokens.push({ lineIndex: i, index: /^\d+$/.test(raw) ? Number(raw) : NaN });
    }
  });
  const N = tokens.length;
  const tokenSet = new Set(tokens.map((t) => t.lineIndex));

  const lastSeg = segments[segments.length - 1];
  const videoDuration = segments.length > 0 ? Math.floor(lastSeg.offset + lastSeg.duration) : NaN;
  const globalOk = N > 0 && !!videoId && segments.length > 0 && Number.isFinite(videoDuration);

  // Select the kept tokens (candidate filter + longest strictly-increasing-offset subsequence).
  const keptMap = new Map<number, { start: number; end: number }>();
  let kept = 0;
  if (globalOk) {
    const candidates = tokens.filter((t) =>
      Number.isInteger(t.index) &&
      t.index >= 0 &&
      t.index < segments.length &&
      Number.isFinite(segments[t.index].offset) &&
      Math.floor(segments[t.index].offset) < videoDuration,
    );
    const offs = candidates.map((c) => segments[c.index].offset);
    const len = offs.map(() => 1);
    const prev = offs.map(() => -1);
    for (let i = 0; i < offs.length; i++) {
      for (let j = 0; j < i; j++) {
        // strict `>` keeps the SMALLEST predecessor j on ties → deterministic
        if (offs[j] < offs[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
      }
    }
    let best = -1;
    for (let i = 0; i < offs.length; i++) if (best === -1 || len[i] > len[best]) best = i; // earliest max
    const pos: number[] = [];
    for (let i = best; i >= 0; i = prev[i]) pos.push(i);
    pos.reverse();
    const keptTokens = pos.map((p) => candidates[p]); // document order, strictly increasing offsets
    kept = keptTokens.length;
    keptTokens.forEach((t, k) => {
      const start = Math.floor(segments[t.index].offset);
      const end = k + 1 < keptTokens.length
        ? Math.floor(segments[keptTokens[k + 1].index].offset)
        : videoDuration;
      keptMap.set(t.lineIndex, { start, end });
    });
  }

  if (N > 0) {
    if (!globalOk || kept === 0) {
      console.warn(`resolveTranscriptTokens: dropped all ${N} timestamp tokens (invalid indices or missing videoId/segments)`);
    } else if (kept < N) {
      console.warn(`resolveTranscriptTokens: kept ${kept} of ${N} timestamp tokens (dropped ${N - kept} out-of-range/out-of-order)`);
    }
  }

  // Pass 2: rebuild line-by-line, fence-aware.
  inFence = false;
  const out: (string | null)[] = lines.map((line, i) => {
    if (FENCE.test(line)) { inFence = !inFence; return line; }
    if (inFence) return line;                       // fenced content: verbatim
    if (tokenSet.has(i)) {
      const k = keptMap.get(i);
      return k ? timestampLine(k.start, k.end, videoId as string) : null; // dropped token line removed
    }
    return line.replace(ANY_TOKEN, '');             // strip any stray inline token
  });

  return out.filter((l): l is string => l !== null).join('\n');
}
```

Also update the function's doc-comment (lines 43-56) to describe lenient selection instead of all-or-nothing (keep the fence-aware and inline-strip notes).

- [ ] **Step 5: Run — confirm GREEN** (`npx jest transcript-timestamps`). All new + updated tests pass.

- [ ] **Step 6: Confirm the gemini out-of-range case** — `npx jest gemini -t "out-of-range"`. The `gemini.test.ts` "degrades to no timestamps when Gemini emits an out-of-range index" test uses a single `[[TS:9]]` (out of range) → candidate-removed → still 0 ▶, so `not.toMatch(/▶/)` still passes. If it instead now emits ▶, STOP and reconcile (it should not). Optionally rename its intent comment to "all tokens invalid".

- [ ] **Step 7: Full suite + types** — `npm test` then `npx tsc --noEmit`. All green. Cross-consumer check: besides `gemini.test.ts`, the real resolver also runs in `gemini-deepdive-combined.test.ts`, `gemini-deepdive-prompt.test.ts`, and `gemini-deepdive-timestamps.test.ts` — all use valid strictly-increasing `[[TS:0]],[[TS:1]]` over monotonic segments, so they stay green (confirm, don't discover). Note: the resolver's degrade-`console.warn` wording changes (old "degrading — invalid/missing segment indices" → new "dropped all N…"/"kept M of N…"); no test asserts the old string, and `lib/gemini.ts`'s own `[timestamp-miss]` warn is independent.

- [ ] **Step 8: Commit** — `feat(timestamps): lenient resolver — keep valid tokens via LIS, drop only bad ones`. Use `git commit -F -` with a quoted-EOF heredoc; end the body with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LmbSdwfXunHoxGJxtb3zGc
  ```

## Post-implementation (after merge gate)

Re-run the repair to fix the deterministic-miss docs through the lenient resolver:
`npm run repair-timestamps -- --folder ../youtube-playlist-summaries-official-plugins-data/agentic-ai-claude-code/raw --stuck-only --run` (env sourced: `set -a; . ./.env.local; set +a`). Docs whose indices are *entirely* invalid will still log `0→0`; docs with a recoverable subsequence will now gain partial ▶.

## Self-review notes

- **Spec coverage:** candidate filter (§1), LIS (§2), videoDuration + globals (§3), next-kept end (§4), rebuild contract (§5, no positional counter), warn sequence (§6) — all in Step 4 code. Test list (§Testing) → Steps 1-2.
- **Type consistency:** `keptMap: Map<number, {start,end}>`; `videoId as string` cast only on the kept branch (globalOk guarantees non-null). LIS arrays are plain `number[]`.
- **Determinism:** smallest-predecessor (strict `>` in the DP) + earliest-max (`best`) reconstruction — pinned by the all-decreasing and duplicate-offset tests.
