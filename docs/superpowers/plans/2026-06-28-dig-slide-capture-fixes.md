# Dig Slide Capture Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the wrong-slide capture (trailing-edge frame selection), relax/curate the prompt (progression + ≤4), make the parser non-destructive on progressions, give assets self-documenting `sectionId-start-end` names, prune orphans on re-dig, and persist `{start,end,pickedSec}` to frontmatter.

**Architecture:** Five coupled changes across `generate.ts` (prompt+version), `slide-tokens.ts` (dedup), `slides.ts` (capture/selection/filename/prune), and `companion-doc.ts`+`route.ts` (frontmatter). `DIG_GENERATOR_VERSION` 6→7.

**Tech Stack:** TypeScript, `node:child_process` (`execFile`), `yt-dlp`, `ffmpeg`, Jest+ts-jest (SWC — `tsc --noEmit` is the type gate).

**Spec:** `docs/superpowers/specs/2026-06-28-dig-slide-capture-fixes-design.md`

## Global Constraints
- **Security invariants (verbatim):** `assertVideoId` before any exec; `youtubeUrl` server-built from the validated id; `execFile` argv-only; asset-path containment before write; temp clips deleted in `finally` on all paths.
- No real network in unit tests (mock `node:child_process`).
- `tsc --noEmit` clean before every commit; full suite green at commit (no red commits).
- Tunable constants via `numEnv(name, def)`, `DIG_` prefix.
- Known pre-existing flakiness: up to ~4 `tests/api/pdf.test.ts` timeouts — if those are the only failures, re-run once and proceed.

## File Structure
| File | Change | Task |
|---|---|---|
| `lib/dig/generate.ts` | prompt: progression + ≤4 curated + speaker tighten; version 6→7 | 1 |
| `lib/dig/slide-tokens.ts` | dedup by `(sec,endSec)`; cap 3→5 | 2 |
| `lib/dig/slides.ts` | trailing-edge selection; `captureSlideFrame` returns `pickedSec`; filename `sectionId-start-end`; resolveSlideTokens returns `{markdown,slides}`; prune-on-re-dig | 3,4,5 |
| `app/api/videos/[id]/dig/[sectionId]/route.ts` | destructure `{markdown,slides}`; pass `slides` to upsert | 5 |
| `lib/dig/companion-doc.ts` | `DugSection.slides`; serialize/parse frontmatter | 5 |
| `tests/lib/dig/*.test.ts`, `tests/api/dig-post.test.ts` | per task | all |

---

### Task 1: Prompt — progression + curated ≤4 + speaker tighten; version 6→7

**Files:** `lib/dig/generate.ts`, `tests/lib/dig/generate.test.ts`

- [ ] **Step 1: Failing tests** (append in the slide-selectivity describe; update version test)

```ts
it('allows a per-stage token for an instructive build progression', () => {
  const s = buildDigPrompt('en', 0, 100);
  expect(s).toMatch(/per instructive stage/i);
  expect(s).toMatch(/teach something the final frame cannot/i);
});
it('curates to at most 4 essential slides', () => {
  const s = buildDigPrompt('en', 0, 100);
  expect(s).toMatch(/at most 4/i);
  expect(s).toMatch(/do NOT reproduce every slide/i);
});
it('excludes a speaker on camera including split-screen', () => {
  expect(buildDigPrompt('en', 0, 100)).toMatch(/split[- ]screen/i);
});
// update existing version test: expect(DIG_GENERATOR_VERSION).toBe(7);
```

- [ ] **Step 2: Run → FAIL** `npx jest generate.test -t "progression"`

- [ ] **Step 3: Edit `buildDigPrompt`.** Replace the single-token bullet's tail + the count bullet. Final SLIDE-related lines:

```
- Emit [[SLIDE:M:SS|M:SS|caption]] when an on-screen visual carries meaning words alone cannot fully convey — a diagram, chart, architecture/flow figure, data visualization, a UI/result screenshot whose spatial layout matters, OR a slide showing code, a command, terminal/CLI output, or config whose on-screen text is the point. Emit ONLY when that content is actually shown on screen — do NOT transcribe code into a fenced block, and do NOT invent a slide for code that is merely spoken. NEVER for title cards, bullet lists, quotes, tips, or a speaker on camera (including a split-screen with a speaker) unless the slide content itself is the point. The FIRST M:SS is the moment the visual is FULLY BUILT and settled; the SECOND M:SS is when it is replaced or leaves the screen.
- Usually emit ONE token per visual, at its settled moment. EXCEPTION: if a visual builds in stages and the intermediate stages each teach something the final frame cannot (e.g. a diagram that reveals a relationship piece by piece), emit one token per instructive stage, each pointed at the moment that stage is complete. If the build merely animates into place, the final settled frame alone is enough.
- The caption is a short plain-English description of the slide. It MUST NOT contain the characters [ ] ( ) or | — describe the slide in words; never paste raw code, YAML, or shell into the caption. (example: [[SLIDE:3:51|4:02|Diagram showing four capabilities])
- Select at most 4 — typically 1-3 — only the most essential visuals. In a slide-heavy talk, do NOT reproduce every slide; curate the handful a reader most needs, and omit any visual whose point the prose already carries. Most sections need zero or one; emitting none is fine.
```

Bump: `export const DIG_GENERATOR_VERSION = 7;`

- [ ] **Step 4: Run → PASS** `npx jest generate.test`
- [ ] **Step 5: `npx tsc --noEmit` && commit** `feat(dig): prompt progression + curated ≤4 slides; version 6→7`

---

### Task 2: Parser — dedup by `(sec, endSec)`; cap 3→5

**Files:** `lib/dig/slide-tokens.ts`, `tests/lib/dig/slide-tokens.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it('keeps same-start tokens with different ends (progression)', () => {
  const t = parseSlideTokens('[[SLIDE:171|175|early]] [[SLIDE:171|185|final]]', 160, 233);
  expect(t).toHaveLength(2);
  expect(t.map(x => x.endSec)).toEqual([175, 185]);
});
it('drops an exact (start,end) duplicate', () => {
  const t = parseSlideTokens('[[SLIDE:171|185|a]] [[SLIDE:171|185|b]]', 160, 233);
  expect(t).toHaveLength(1);
});
it('caps at 5 tokens', () => {
  const md = Array.from({length: 7}, (_, i) => `[[SLIDE:${100+i*2}|${101+i*2}|c${i}]]`).join(' ');
  expect(parseSlideTokens(md, 0, 400)).toHaveLength(5);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Edit `parseSlideTokens`.** Change the cap (`results.length >= 3` → `>= 5`) and the dedup key from `sec` to a `(sec,endSec)` composite:

```ts
// replace the Set<number> seenSecs with a Set<string> of `${sec}:${endSec}` keys
const seen = new Set<string>();
// ...after computing sec, endSec (existing logic unchanged):
const key = `${sec}:${endSec ?? 'n'}`;
if (seen.has(key)) continue;
// ...at push:
seen.add(key);
```

Keep the `(?=\|)` lookahead grammar, the start range check, the `end>sec`/clamp logic, and caption sanitation exactly as-is. Update the cap constant in both the `if (results.length >= 5) break;` guard and the doc comment ("at most 5").

- [ ] **Step 4: Run → PASS** `npx jest slide-tokens` (existing dedup-by-start tests that asserted dropping a same-start/different-caption token must be re-checked: `[[SLIDE:312|A]] [[SLIDE:312|B]]` — both lack an end, so key is `312:n` for both → still deduped to 1, existing assertion holds.)
- [ ] **Step 5: `tsc` && commit** `feat(dig): dedup slide tokens by (start,end); cap 3→5`

---

### Task 3: Capture — trailing-edge selection + `pickedSec` + `sectionId-start-end` filename

**Files:** `lib/dig/slides.ts`, `tests/lib/dig/slides.test.ts`

**Interfaces produced:**
- `captureSlideFrame({youtubeUrl, startSec, endSec, outPath}): Promise<number>` — returns `pickedSec` (absolute, sub-second).
- `resolveSlideTokens(...)` return type changes to `Promise<{ markdown: string; slides: Array<{ startSec: number; endSec: number; pickedSec: number }> }>`.
- Asset filename: `${sectionId}-${startSec}-${endComponent}.jpg` where `endComponent = token.endSec ?? (token.sec + DEFAULT_FWD)`.
- New const: `TRAIL_SEC = numEnv('DIG_TRAIL_SEC', 4)` (select from the last `TRAIL_SEC`s of the window — absolute, anchored on the reliable `end`). New exported helper `pickLargestFrom(dir, minOrdinal)`.

- [ ] **Step 1: Failing tests** (use the existing mock harness; `mockFfmpegPipeline('', sizes)` writes `sizes.length` frames for the fps pass)

```ts
test('trailing-edge: selects the largest frame from the trailing TRAIL_SEC, ignoring a larger LEADING frame (the bug)', async () => {
  // window [171,177] (6s) @ fps=2 → 12 frames f_001..f_012. TRAIL_SEC=4 → tailStart=173 → minOrdinal=5.
  // f_001 is the biggest frame overall (the lingering previous slide); the trailing max is f_007.
  const sizes = [9999,1,1,1, 1,1,500,1, 1,1,1,1];
  mockFfmpegPipeline('', sizes);                     // mock writes f_00N for sizes[N-1]
  const { slides } = await resolveSlideTokens('see [[SLIDE:171|177|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  const asset = path.join(tmpAssetsRoot, 'abc12345678', '160-171-177.jpg');
  expect(fs.statSync(asset).size).toBe(500);         // trailing largest chosen, NOT the leading 9999
  expect(slides[0].pickedSec).toBeCloseTo(174);      // 171 + (7-1)/2
});
test('pickLargestFrom skips frames below minOrdinal', () => {
  const d = fs.mkdtempSync(path.join(require('os').tmpdir(), 'po-'));
  fs.writeFileSync(path.join(d, 'f_001.jpg'), Buffer.alloc(999));
  fs.writeFileSync(path.join(d, 'f_005.jpg'), Buffer.alloc(50));
  expect(pickLargestFrom(d, 3)).toBe(path.join(d, 'f_005.jpg')); // f_001 excluded
  fs.rmSync(d, { recursive: true, force: true });
});
test('filename uses sectionId-start-end', async () => {
  mockFfmpegPipeline('', [100]);
  const { markdown } = await resolveSlideTokens('x [[SLIDE:171|181|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  expect(markdown).toContain('assets/abc12345678/160-171-181.jpg');
});
test('null end → filename uses start + DEFAULT_FWD', async () => {
  mockFfmpegPipeline('', [100]);
  const { markdown } = await resolveSlideTokens('x [[SLIDE:171|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  expect(markdown).toContain('assets/abc12345678/160-171-175.jpg'); // 171 + DEFAULT_FWD(4)
});
test('returns slides metadata incl. pickedSec', async () => {
  mockFfmpegPipeline('', [10, 100]); // 2 frames; pickedSec computed from chosen ordinal
  const { slides } = await resolveSlideTokens('x [[SLIDE:171|181|S]]', { ...getOpts(), startSec: 160, endSec: 233 });
  expect(slides).toHaveLength(1);
  expect(slides[0]).toMatchObject({ startSec: 171, endSec: 181 });
  expect(typeof slides[0].pickedSec).toBe('number');
});
```

> The existing v6 capture tests assert `resolveSlideTokens` returns a string and the old `sectionId-start.jpg` name — update them to destructure `{markdown}` and the new filename, or delete the now-superseded ones.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement.** Add `TRAIL_SEC` and a `pickLargestFrom(dir, minOrdinal)` helper, and rewrite `captureSlideFrame` to sample the WHOLE window but select only from the **trailing `TRAIL_SEC` seconds** in JS (version-independent; no ffmpeg `-ss`). Returns `pickedSec` (clamped).

```ts
const TRAIL_SEC = numEnv('DIG_TRAIL_SEC', 4);  // select from the last TRAIL_SEC seconds of the window

/** Largest .jpg in `dir` whose 1-based ordinal (f_NNN) is >= minOrdinal. Null if none qualify. */
export function pickLargestFrom(dir: string, minOrdinal: number): string | null {
  let best: string | null = null; let bestSize = -1;
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/(\d+)\.jpg$/); if (!m) continue;
    if (parseInt(m[1], 10) < minOrdinal) continue;            // skip leading frames
    const p = path.join(dir, name); const st = fs.statSync(p);
    if (st.isFile() && st.size > bestSize) { bestSize = st.size; best = p; }
  }
  return best;
}

/** Download [startSec, winEnd], sample the whole window, but select the largest (most-built)
 *  frame only from the trailing TRAIL_SEC seconds. Trailing-only because Gemini's `end` reliably
 *  brackets the slide while `start` can be early (previous slide lingers at the leading edge).
 *  Returns the chosen frame's absolute timestamp (pickedSec). SECURITY: trusts outPath. */
async function captureSlideFrame(opts: {
  youtubeUrl: string; startSec: number; endSec: number | null; outPath: string;
}): Promise<number> {
  const { youtubeUrl, startSec, endSec, outPath } = opts;
  const cacheDir = path.resolve('.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const rawEnd = endSec != null && endSec > startSec
    ? Math.min(endSec, startSec + MAX_CAPTURE_SEC) : startSec + DEFAULT_FWD;
  const winEnd = Math.max(rawEnd, startSec + 1);
  const tailStart = Math.max(startSec, winEnd - TRAIL_SEC);          // absolute, anchored on end
  const minOrdinal = Math.floor((tailStart - startSec) * SAMPLE_FPS) + 1; // 1-based; frames before are leading

  const clip = path.join(cacheDir, `clip-${crypto.randomUUID()}.mp4`);
  const framesDir = fs.mkdtempSync(path.join(cacheDir, 'frames-'));
  try {
    await execFileAsync('yt-dlp', [
      '--download-sections', `*${startSec}-${winEnd}`,
      '-f', 'bv[height<=720]', '-o', clip, youtubeUrl,
    ]);
    await execFileAsync('ffmpeg', [
      '-y', '-i', clip, '-vf', `fps=${SAMPLE_FPS}`, '-q:v', '2',
      path.join(framesDir, 'f_%03d.jpg'),
    ]);
    let best = pickLargestFrom(framesDir, minOrdinal);
    if (!best) best = pickLargestFrom(framesDir, 1);   // tiny window → fall back to whole sample
    if (!best) throw new Error('no frames sampled');
    fs.copyFileSync(best, outPath);
    const ord = parseInt(path.basename(best).match(/(\d+)\.jpg$/)![1], 10);
    let pickedSec = startSec + (ord - 1) / SAMPLE_FPS;
    pickedSec = Math.min(Math.max(pickedSec, startSec), winEnd);     // clamp (M4)
    return Math.round(pickedSec * 10) / 10;
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
    try { fs.unlinkSync(clip); } catch { /* ignore */ }
  }
}
```

Change `resolveSlideTokens` to collect slide metadata and return the object; build the filename from start+end:

```ts
// signature: ): Promise<{ markdown: string; slides: Array<{ startSec: number; endSec: number; pickedSec: number }> }> {
// short-circuit (no tokens): return { markdown: stripUnresolvedSlideTokens(markdown), slides: [] };
const slides: Array<{ startSec: number; endSec: number; pickedSec: number }> = [];
const usedNames = new Set<string>();  // B2: guarantee filename uniqueness (first-wins) across this run
// in the loop, replace the asset path + capture + ref:
const endComponent = token.endSec ?? (token.sec + DEFAULT_FWD);
const assetName = `${sectionId}-${token.sec}-${endComponent}.jpg`;
if (usedNames.has(assetName)) continue;   // B2: two tokens resolving to the same file → keep the first only
usedNames.add(assetName);
const assetPath = path.resolve(assetsRoot, videoId, assetName);
// containment check unchanged (assetPath.startsWith(resolvedRoot + path.sep)) ...
try {
  const pickedSec = await captureSlideFrame({ youtubeUrl, startSec: token.sec, endSec: token.endSec, outPath: assetPath });
  const imgRef = `![${token.caption}](assets/${videoId}/${assetName})`;
  // ...replace token.raw with imgRef as before...
  slides.push({ startSec: token.sec, endSec: endComponent, pickedSec });
} catch (err) { /* strip token as before */ usedNames.delete(assetName); /* failed capture: free the name */ }
// final: return { markdown: stripUnresolvedSlideTokens(result), slides };
```

> Note: `usedNames` here is for B2 (collision skip); the `written` set used by Task 4's prune is the set of names that **successfully** captured. Track both, or reuse one set added-to only on success and check membership before capture. Simplest: a `plannedNames` set for the skip check (added before capture) and a `written` set for prune (added after success). On capture failure, the planned name is fine to leave (it just won't be re-attempted); the prune uses `written` only.

(`resolveAssetPath` is now inlined for the 3-part name; remove it if unused, or keep and extend it to take `endComponent`.)

- [ ] **Step 4: Update the caller + ALL mocks + ALL broken existing tests (no red commit).**
  - **`route.ts:135`:** `const finalMd = await resolveSlideTokens(...)` → `const { markdown: finalMd } = await resolveSlideTokens(...)` (the `slides` value is wired into upsert in Task 5).
  - **`dig-post.test.ts` — three string-returning mock resolutions (H5), update ALL to `{ markdown: <orig string>, slides: [] }`:** (1) the default `mockResolveSlideTokens.mockResolvedValue('# Dig Deeper…')` (~line 164); (2) the B8 yt-dlp-gated test (~line 440); (3) the B9 ordering test's inline `mockImplementation` that does `return '# Final'` (~line 463). Missing any one makes `finalMd === undefined` → empty body written.
  - **`slides.test.ts` — enumerate & rewrite ALL breakages from the return-type + filename change (H3).** Find them: `grep -nE "resolveSlideTokens|assets/abc12345678/[0-9]" tests/lib/dig/slides.test.ts`. For each: (a) every `const out = await resolveSlideTokens(...)` + `expect(out)...` → destructure `const { markdown: out } = ...`; (b) every filename assertion `assets/abc12345678/<sectionId>-<sec>.jpg` → the 3-part name `<sectionId>-<sec>-<endComponent>.jpg` (for `getOpts()` sectionId 300 and a token `[[SLIDE:352|Build]]` with null end, that's `300-352-356.jpg`; with `[[SLIDE:352|400|…]]`, `300-352-400.jpg`). Update the empty/text-only short-circuit tests (`expect(out).toBe('')`) to `expect((await resolveSlideTokens(...)).markdown).toBe('')`. Delete any test asserting the deleted single-frame/`-ss` internals if present.
- [ ] **Step 5: Run → PASS** `npx jest slides.test dig-post`
- [ ] **Step 6: `tsc` && full suite && commit** `feat(dig): trailing-edge frame selection + pickedSec + sectionId-start-end filename`

---

### Task 4: Delete-on-re-dig (write-then-prune)

**Files:** `lib/dig/slides.ts`, `tests/lib/dig/slides.test.ts`

- [ ] **Step 1: Failing test**

```ts
test('prunes stale sectionId-* assets after writing the new set', async () => {
  const dir = path.join(tmpAssetsRoot, 'abc12345678');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '160-999-1000.jpg'), 'old'); // stale orphan, same section
  fs.writeFileSync(path.join(dir, '200-5-9.jpg'), 'other');    // different section — must survive
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('x [[SLIDE:171|181|S]]', { ...getOpts(), startSec: 160, endSec: 233, sectionId: 160 });
  expect(fs.existsSync(path.join(dir, '160-171-181.jpg'))).toBe(true);  // new written
  expect(fs.existsSync(path.join(dir, '160-999-1000.jpg'))).toBe(false); // stale pruned
  expect(fs.existsSync(path.join(dir, '200-5-9.jpg'))).toBe(true);       // other section kept
});
test('writes nothing (all captures fail) → prunes nothing, prior set intact', async () => {
  const dir = path.join(tmpAssetsRoot, 'abc12345678');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '160-5-9.jpg'), 'prior');
  mockExecFile.mockImplementation((cmd: string, _a: string[], cb: (e: Error|null, so?: string, se?: string) => void) =>
    cmd === 'yt-dlp' ? cb(new Error('403')) : cb(null, '', '')); // tokens emitted but all fail
  await resolveSlideTokens('x [[SLIDE:171|181|S]]', { ...getOpts(), startSec: 160, endSec: 233, sectionId: 160 });
  expect(fs.existsSync(path.join(dir, '160-5-9.jpg'))).toBe(true); // prior set intact (written=0, tokens>0)
});
test('legit zero-token re-dig prunes stale assets (M3)', async () => {
  const dir = path.join(tmpAssetsRoot, 'abc12345678');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '160-5-9.jpg'), 'stale');
  // no [[SLIDE]] tokens in the markdown → tokens.length === 0 → prune runs
  await resolveSlideTokens('plain prose, no slides', { ...getOpts(), startSec: 160, endSec: 233, sectionId: 160 });
  expect(fs.existsSync(path.join(dir, '160-5-9.jpg'))).toBe(false);
});
test('prune prefix is hyphen-bounded: section 16 does not touch section 160 assets', async () => {
  const dir = path.join(tmpAssetsRoot, 'abc12345678');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '160-1-5.jpg'), 'section160');
  mockFfmpegPipeline('', [100]);
  await resolveSlideTokens('x [[SLIDE:17|21|S]]', { ...getOpts(), startSec: 16, endSec: 80, sectionId: 16 });
  expect(fs.existsSync(path.join(dir, '160-1-5.jpg'))).toBe(true); // 160-* untouched by section 16
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement.** In `resolveSlideTokens`, after the token loop, collect the just-written asset basenames (the `assetName`s that succeeded) and prune siblings:

```ts
// track names that SUCCESSFULLY captured: const written = new Set<string>(); ... written.add(assetName) inside the try on success.
// after the loop, before returning:
// M3: prune when at least one new asset was written, OR Gemini legitimately emitted ZERO tokens
// (a real empty re-dig should clear stale assets). Do NOT prune when tokens were emitted but ALL
// captures failed (written.size===0 && tokens.length>0) — that would wipe the prior good set.
if (written.size > 0 || tokens.length === 0) {
  const dir = path.resolve(assetsRoot, videoId);
  const prefix = `${sectionId}-`;
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { entries = []; }
  for (const name of entries) {
    if (name.startsWith(prefix) && name.endsWith('.jpg') && !written.has(name)) {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* ignore */ }
    }
  }
}
```

> Note the prefix `${sectionId}-` includes the trailing hyphen, so section `16` never matches section `160`'s files (`'160-…'.startsWith('16-')` is false). Add a test: section 16's re-dig leaves `160-*.jpg` intact.

- [ ] **Step 4: Run → PASS** `npx jest slides.test`
- [ ] **Step 5: `tsc` && commit** `feat(dig): prune stale section assets on re-dig (write-then-prune)`

---

### Task 5: Persist `{start,end,pickedSec}` to companion-doc frontmatter

**Files:** `lib/dig/companion-doc.ts`, `tests/lib/dig/companion-doc.test.ts`, `app/api/videos/[id]/dig/[sectionId]/route.ts`

**Interfaces:** `DugSection` gains `slides?: Array<{ startSec: number; endSec: number; pickedSec: number }>`. Serialized under each section as a nested `slides:` list; parsed back by `parseDugSections`/`parseFrontmatter`.

- [ ] **Step 1: Failing test** (companion-doc round-trip)

```ts
it('round-trips per-slide {startSec,endSec,pickedSec} in frontmatter', async () => {
  const p = path.join(dir, 'x-dig-deeper.md');
  await upsertDugSection({ digDeeperPath: p, videoTitle: 'T', videoId: 'v', language: 'en', sourceVideoUrl: 'u',
    section: { sectionId: 160, startSec: 160, title: 'S', bodyMarkdown: 'b', generatedAt: 'g', genVersion: 7,
      slides: [{ startSec: 171, endSec: 181, pickedSec: 176.5 }] } });
  const parsed = parseDugSections(await fs.promises.readFile(p, 'utf8'));
  expect(parsed[0].slides).toEqual([{ startSec: 171, endSec: 181, pickedSec: 176.5 }]);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement in `companion-doc.ts`.**
  - Add `slides?: Array<{ startSec: number; endSec: number; pickedSec: number }>` to `DugSection`, the internal `ParsedFrontmatter.sections` element type, and the `currentSection` partial type.
  - **Serialize** (in `serializeFrontmatter`, after the `genVersion` line for each section):
    ```ts
    if (s.slides && s.slides.length) {
      lines.push('    slides:');
      for (const sl of s.slides) {
        lines.push(`      - startSec: ${sl.startSec}`);
        lines.push(`        endSec: ${sl.endSec}`);
        lines.push(`        pickedSec: ${sl.pickedSec}`);
      }
    }
    ```
  - **Parse** (in `parseFrontmatter`'s sections state machine): recognize `    slides:` to enter a slide-list sub-state, and `      - startSec:` / `        endSec:` / `        pickedSec:` lines, accumulating into `currentSection.slides`. **M1: `pickedSec` is a FLOAT (e.g. `176.5`) — match it with `([\d.]+)` and `parseFloat`, NOT `(\d+)` (which would truncate to `176`).** `startSec`/`endSec` stay integer (`\d+`). Mirror the existing indented-list handling; commit `slides` when the section commits. The section-block terminator is a non-indented line, so the deeper 6/8-space lines are safely inside the block.
  - Thread `slides` through `parseDugSections` (it builds `DugSection`s from `fm.sections`) — copy `s.slides` onto the returned section.

- [ ] **Step 4: Wire the route.** In `route.ts`: `const { markdown: finalMd, slides } = await resolveSlideTokens(...)` and add `slides` to the `section:` object passed to `upsertDugSection` (alongside `bodyMarkdown`, `genVersion`, etc.).

- [ ] **Step 5: Run → PASS** `npx jest companion-doc dig-post`
- [ ] **Step 6: `tsc --noEmit && npm test`** — full suite green.
- [ ] **Step 7: Commit** `feat(dig): persist per-slide {start,end,pickedSec} to companion-doc frontmatter`

---

## Self-Review
- §3.1 trailing-edge → Task 3; §3.2 prompt → Task 1; §3.3 dedup+cap → Task 2; §3.4 filename → Task 3; §3.5 prune → Task 4; §3.6 frontmatter → Task 5; §8 version → Task 1.
- Each task commits green: T1/T2 isolated; T3 changes the return type and updates its one caller + mock in the same commit; T4 additive; T5 additive + route wiring.
- Constants: `TAIL_FRACTION=0.5`, cap 5, version 7 — consistent across tasks.

## Post-Plan Gate
- [ ] Adversarial review of this plan (Codex `--fresh`; Claude fallback if at limit) → `docs/reviews/plan-dig-slide-capture-fixes-review.md`
- [ ] Address Blocking/High inline; (AFK) substitute the adversarial review for the human approval gate per the AFK-autonomy policy.
