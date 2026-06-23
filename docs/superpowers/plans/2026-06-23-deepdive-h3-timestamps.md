# Deep-Dive H3 Subsection Timestamps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fold each `### ` subsection's leading ▶ into a muted `<a class="ts">(label)</a>` trailing the `<h3>`, matching the H2 treatment.

## Global Constraints
- Build `<h3>` as a STRING; `md.render` bodies SEPARATELY; never feed `<a class="ts">` into `md.render` (`html:false` escapes it).
- H3 split MUST be fence-aware (copy `splitSections`' `inFence` toggle); heading regex `/^###\s+(.*)$/` (H3 only, rejects `#### ` and `###x`).
- ▶-less `### ` → byte-identical `<h3>heading</h3>` to today.
- `CURRENT_DEEP_DIVE_VERSION` `{2,1}→{2,2}`.
- Full `npm test` + `npx tsc --noEmit` green before commit.

---

### Task 1: Fold H3 subsection ▶ + version bump

**Files:**
- Modify: `lib/html-doc/render-deep-dive.ts` (add `tsAnchor` + `renderSubsections`; change `renderSection`'s `restHtml`)
- Modify: `lib/deep-dive/version.ts` (`{2,1}→{2,2}` + comment)
- Test: `tests/lib/html-doc/render-deep-dive.test.ts`; `tests/lib/deep-dive/version.test.ts`; `tests/components/VideoMenu.test.tsx` (bump the `deepDiveVersion: {2,1}` fixtures → `{2,2}`, primarily the "Deep Dive doc" LINK test ~line 34 which goes stale→`<button>` otherwise)

- [ ] **Step 1: Write failing tests.** Update `version.test.ts` first: line ~5-6 `it('current deep-dive version is 2.1' …)` → title `is 2.2` and `toEqual({ major: 2, minor: 2 })`. (Do NOT touch `version.test.ts:16`'s `{2,1}` — it's an explicit `needsRegenerate` arg, not the constant.) Also bump `tests/components/VideoMenu.test.tsx`'s `deepDiveVersion: { major: 2, minor: 1 }` fixtures → `{ major: 2, minor: 2 }` (the link test goes stale→button otherwise). Then add a new render `describe` (uses the public `renderDeepDiveHtml(md, sourceMd)`):

```ts
describe('H3 subsection timestamps', () => {
  const FM = `---\nvideo_id: "v1"\nlang: EN\n---\n\n# T (Deep Dive)\n\n**Channel:** C | **Duration:** 5:00 | **URL:** https://youtu.be/v1\n\n---\n\n`;
  const render = (body: string) => renderDeepDiveHtml(FM + body, 'v1-deep-dive.md');

  it('folds a ### subsection leading ▶ into a trailing muted .ts link', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### Sub A\n▶ [0:36–1:42](https://www.youtube.com/watch?v=v1&t=36s)\nsub body.\n');
    expect(out).toContain('<h3>Sub A <a class="ts" href="https://www.youtube.com/watch?v=v1&amp;t=36s" target="_blank" rel="noopener noreferrer">(0:36–1:42)</a></h3>');
    expect(out).not.toContain('▶'); // no literal glyph anywhere
    expect((out.match(/0:36–1:42/g) ?? []).length).toBe(1); // folded once, not duplicated
  });

  it('leaves a ### subsection with no ▶ unchanged (plain <h3>, no trailing .ts)', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### Plain Sub\nbody text.\n');
    // Plain <h3> with NO trailing anchor (the H2 has its own .ts link — assert the H3 shape directly).
    expect(out).toContain('<h3>Plain Sub</h3>');
  });

  it('renders a bold ### heading inside a section as <h3><strong>…</strong></h3>', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### **Bold Sub**\n▶ [1:00–2:00](https://www.youtube.com/watch?v=v1&t=60s)\nb.\n');
    expect(out).toContain('<h3><strong>Bold Sub</strong> <a class="ts"');
  });

  it('does NOT fold a ### inside a fenced code block', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n```\n### Not A Heading\n▶ [9:99–9:99](x)\n```\n');
    expect(out).toContain('### Not A Heading'); // survives verbatim inside <pre><code>
    expect(out).not.toContain('<h3>Not A Heading');
  });

  it('does NOT fold ###x (no space → prose)', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n###notaheading text\n');
    expect(out).not.toContain('<h3>notaheading');
  });

  it('handles a section whose body starts immediately with ### (no gold lead)', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\n### Sub\n▶ [0:36–1:42](https://www.youtube.com/watch?v=v1&t=36s)\nb.\n');
    expect(out).toContain('<h3>Sub <a class="ts"');
    // no gold lead emitted for a section with no prose paragraph before the first ###
    expect(out).not.toMatch(/<p class="lead">/);
  });

  it('consumes a malformed ▶ line under a ### (no raw glyph leak, no .ts link)', () => {
    const out = render('## Sec\n▶ [0:00–0:30](https://www.youtube.com/watch?v=v1&t=0s)\nLead.\n\n### Sub\n▶ not-a-valid-ts-line\nbody.\n');
    expect(out).toContain('<h3>Sub</h3>'); // no trailing .ts (malformed → null)
    expect(out).not.toContain('▶');
    expect(out).not.toContain('not-a-valid-ts-line');
  });
});
```

- [ ] **Step 2: Run — RED** (`npx jest render-deep-dive -t "H3 subsection"` + `npx jest deep-dive/version`). The H3-fold cases fail (current code emits raw `▶`+plain link); the version test fails (`{2,1}`).

- [ ] **Step 3: Implement render-deep-dive.ts.** Extract the H2 anchor into a shared helper and add the subsection renderer (place near `renderSection`):

```ts
function tsAnchor(ts: { label: string; url: string } | null): string {
  return ts
    ? ` <a class="ts" href="${esc(ts.url)}" target="_blank" rel="noopener noreferrer">(${esc(ts.label)})</a>`
    : '';
}

/**
 * Render an H2 section's body: fence-aware split into `### ` subsections, folding each
 * subsection's leading ▶ into a muted .ts link trailing the <h3> (mirrors renderSection's H2).
 * Content before the first `### ` and all non-subsection prose render via md.render unchanged.
 */
function renderSubsections(rest: string): string {
  const lines = rest.split('\n');
  const preLines: string[] = [];
  const subs: { heading: string; lines: string[] }[] = [];
  let inFence = false;
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; (current ? current.lines : preLines).push(line); continue; }
    const h = !inFence ? line.match(/^###\s+(.*)$/) : null;
    if (h) { if (current) subs.push(current); current = { heading: h[1].trim(), lines: [] }; continue; }
    (current ? current.lines : preLines).push(line);
  }
  if (current) subs.push(current);

  const preHtml = preLines.join('\n').trim() ? md.render(preLines.join('\n')) : '';
  const subsHtml = subs.map((s) => {
    const subLines = [...s.lines];
    const ts = extractTimestamp(subLines);       // mutates subLines (removes leading ▶)
    const heading = `<h3>${md.renderInline(s.heading)}${tsAnchor(ts)}</h3>`;
    const bodyHtml = subLines.join('\n').trim() ? md.render(subLines.join('\n')) : '';
    return `${heading}\n${bodyHtml}`;
  }).join('\n');

  return [preHtml, subsHtml].filter(Boolean).join('\n');
}
```

Then in `renderSection`: replace the inline H2 `tsHtml` with `tsAnchor(ts)`, and change the rest rendering:
```ts
  const tsHtml = tsAnchor(ts);
  const heading = `<h2>${md.renderInline(raw.heading)}${tsHtml}</h2>`;
  // … takeFirstParagraph + leadHtml unchanged …
  const restHtml = rest.trim() ? renderSubsections(rest) : '';
```

- [ ] **Step 4: Bump version** in `lib/deep-dive/version.ts`: `CURRENT_DEEP_DIVE_VERSION = { major: 2, minor: 2 }`; update the comment (append `minor 2 = H3 subsection timestamps`).

- [ ] **Step 5: Run — GREEN** (`npx jest render-deep-dive` + `npx jest deep-dive/version`). Confirm the existing `section restructure` tests (the `### Detail` no-▶ fixture) still pass (`<h3>Detail</h3>`, `not.toContain('▶')`).

- [ ] **Step 6: Full suite + types + blast-radius grep** — first `grep -rn "minor: 1" tests/` and reconcile each hit: if it feeds `CURRENT_DEEP_DIVE_VERSION` (a stamped doc compared to the constant, e.g. `VideoMenu.test.tsx`) → bump to `{2,2}`; if it's a local literal passed as an explicit `current`/`needsRegenerate` arg (`ensure.test.ts`, `version.test.ts:16`) → leave. Then `npm test` + `npx tsc --noEmit`. The deep-dive E2E specs seeding `{2,0}` (`deep-dive-doc.spec.ts:171,312`) are unaffected (`isOlder({2,0},{2,2})` still `true`, same branch). All green.

- [ ] **Step 7: Commit** — `feat(deep-dive): fold H3 subsection ▶ into muted .ts links; deep-dive version 2.2`. `git commit -F -` quoted-EOF heredoc; end body with:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01LmbSdwfXunHoxGJxtb3zGc
  ```

## Post-implementation (migration — after merge)
Throwaway script: for each video with `deepDiveMd` AND `deepDiveVersion.major === 2`, call `reRenderDeepDiveHtml(videoId, folder)`; print each returned status (report any non-`rerendered`). Then verify `yB16BT1IMag`'s HTML: every H3-led ▶ is now `class="ts"` (grep the `.md` to confirm all raw ▶ were H3-led before claiming a total).

## Self-review notes
- Spec coverage: fence-aware split + regex (Step 3) + HTML-string composition (Step 3) + version bump (Step 4) + all 7 new tests (Step 1). Type consistency: `tsAnchor` takes `{label,url} | null`; `renderSubsections` returns string; `extractTimestamp` mutates `subLines` as it does for H2.
