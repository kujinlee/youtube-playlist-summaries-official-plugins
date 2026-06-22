# Deep-Dive & Summary HTML Doc Refinements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deep-dive timestamps muted & trailing the heading (like the summary), confine each section's gold to its first sentence, and render the original-video URL as a clickable full link in both docs.

**Architecture:** Pure rendering-layer change. `render.ts` (summary) gains a URL link in the meta line. `render-deep-dive.ts` (deep dive) moves from "dump the whole body through markdown-it" to **structured section rendering**: split body into preamble + `##` sections (fence-aware), relocate the `▶` line to a trailing `.ts` link, gold only the lead's first sentence, and linkify the header URL. No Gemini regeneration — a re-render of existing `.md` applies everything.

**Tech Stack:** TypeScript, markdown-it (`html:false`), jest + ts-jest. Self-contained HTML with inlined CSS via `lib/html-doc/theme.ts`.

## Global Constraints

- markdown-it stays `html:false` — never pass raw Gemini HTML through. Directly-emitted HTML (heading, `.ts` link, `.lead`) must `esc()` all interpolated values.
- URL links: only `^https?://` URLs are linked (reject `javascript:`/`data:` etc.); href and visible text both `esc()`'d; `target="_blank" rel="noopener noreferrer"`.
- En dash in timestamp labels is U+2013 (`–`).
- Timestamp line shape (already in the `.md`): `▶ [<label>](<https url>)` on its own line, first non-blank line of a section.
- Run the narrowest test first (`npx jest render-deep-dive` / `npx jest render`), then full `npm test` + `npx tsc --noEmit` before each commit.
- Dual review per task: `superpowers:requesting-code-review` (Claude) + `codex:rescue` (Codex adversarial); save both to `docs/reviews/`. Codex unavailable → Claude adversarial fallback (note the gap).

---

### Task 1: Summary meta URL link (`render.ts`)

**Files:**
- Modify: `lib/html-doc/render.ts` (metaLine build ~line 52; STRUCTURAL_CSS ~line 25)
- Test: `tests/lib/html-doc/render.test.ts`

**Interfaces:**
- Consumes: `ParsedSummary.url` (already populated by `parse.ts`).
- Produces: nothing new for later tasks (self-contained).

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/html-doc/render.test.ts` (the existing `parsed` fixture has `url: 'https://youtu.be/x'`):

```ts
  it('renders the original-video URL as a clickable full-URL link in the meta line', () => {
    const html = renderMagazineHtml(parsed, model);
    expect(html).toContain(
      '<a href="https://youtu.be/x" target="_blank" rel="noopener noreferrer">https://youtu.be/x</a>',
    );
    // styling hooks: muted link in the meta line
    expect(html).toContain('.doc-meta a{color:inherit;text-decoration:none}');
    expect(html).toContain('.doc-meta a:hover{text-decoration:underline}');
  });

  it('omits the meta URL link when url is null (no trailing separator)', () => {
    const noUrl = { ...parsed, url: null };
    const html = renderMagazineHtml(noUrl, model);
    expect(html).not.toContain('<a href');
    expect(html).toContain('Andrej Karpathy · 3:31:24');
  });

  it('does not link a non-http(s) url (injection guard)', () => {
    const evilUrl = { ...parsed, url: 'javascript:alert(1)' };
    const html = renderMagazineHtml(evilUrl, model);
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<a href');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest render.test -t "meta line" ; npx jest render.test -t "injection guard"`
Expected: FAIL — current `metaLine` only joins channel + duration; no `<a href>` and no `.doc-meta a` CSS.

- [ ] **Step 3: Implement the meta URL link**

In `lib/html-doc/render.ts`, replace the `metaLine` construction (currently):

```ts
  const metaLine = [parsed.channel, parsed.duration].filter(Boolean).map((s) => esc(s as string)).join(' · ');
```

with:

```ts
  const metaParts = [parsed.channel, parsed.duration]
    .filter(Boolean)
    .map((s) => esc(s as string));
  if (parsed.url && /^https?:\/\//.test(parsed.url)) {
    const u = esc(parsed.url);
    metaParts.push(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  }
  const metaLine = metaParts.join(' · ');
```

In `STRUCTURAL_CSS`, after the `.doc-meta{…}` rule add:

```
.doc-meta a{color:inherit;text-decoration:none}
.doc-meta a:hover{text-decoration:underline}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest render.test`
Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Claude + Codex review, save to `docs/reviews/task-1-summary-url-review.md` and `…-codex.md`; address High/Important findings; re-run tests.**

- [ ] **Step 7: Commit**

```bash
git add lib/html-doc/render.ts tests/lib/html-doc/render.test.ts docs/reviews/task-1-*
git commit -m "feat(summary-doc): clickable original-video URL in meta line"
```

---

### Task 2: Deep-dive rendering helpers (`render-deep-dive.ts`)

Add pure, exported helpers used by Task 3. No behavior change to `renderDeepDiveHtml` yet — existing deep-dive tests stay green.

**Files:**
- Modify: `lib/html-doc/render-deep-dive.ts` (add helpers + exports; do NOT touch `renderDeepDiveHtml` yet)
- Test: `tests/lib/html-doc/render-deep-dive-helpers.test.ts` (new)

**Interfaces:**
- Produces (consumed by Task 3):
  - `interface RawSection { heading: string; lines: string[] }`
  - `splitSections(body: string): { preamble: string; sections: RawSection[] }` — fence-aware split at `## ` headings; everything before the first heading is `preamble`.
  - `extractTimestamp(lines: string[]): { label: string; url: string } | null` — mutates `lines`: removes the leading `▶` line (first non-blank) and returns its label+url, or `null` (consumed-but-malformed, or no `▶`). **Divergence from `parse.ts` (intentional):** this render helper does NOT require a `?t=` param — a well-formed `▶ [label](https url)` with no `?t=` still yields a link (the link works; YouTube just starts at 0). `parse.ts` rejects when `startSec` is NaN because it needs the seek offset; the renderer does not.
  - `linkifyHeaderUrl(body: string): string` — rewrites the first `**URL:** <https url>` to a markdown link.
  - `takeFirstParagraph(lines: string[]): { para: string; rest: string }` — first prose paragraph (lines to next blank) vs remainder; `para===''` when the first non-blank line is a block construct.
  - `splitFirstSentence(text: string): { first: string; rest: string }` — first sentence vs remainder via terminator heuristic.

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/html-doc/render-deep-dive-helpers.test.ts`:

```ts
import {
  splitSections, extractTimestamp, linkifyHeaderUrl, takeFirstParagraph, splitFirstSentence,
} from '../../../lib/html-doc/render-deep-dive';

describe('splitSections', () => {
  it('separates preamble from ## sections', () => {
    const { preamble, sections } = splitSections('# Title\n\nintro\n\n## One\na\n\n## Two\nb');
    expect(preamble).toContain('# Title');
    expect(preamble).toContain('intro');
    expect(sections.map((s) => s.heading)).toEqual(['One', 'Two']);
    expect(sections[0].lines.join('\n')).toContain('a');
  });

  it('does not treat a ## inside a code fence as a section', () => {
    const { sections } = splitSections('## Real\n```\n## not a heading\n```\nbody');
    expect(sections).toHaveLength(1);
    expect(sections[0].lines.join('\n')).toContain('## not a heading');
  });

  it('does not match ### (h3) as a section', () => {
    const { preamble, sections } = splitSections('### H3 only\ntext');
    expect(sections).toHaveLength(0);
    expect(preamble).toContain('### H3 only');
  });
});

describe('extractTimestamp', () => {
  it('removes a well-formed ▶ line and returns label+url', () => {
    const lines = ['▶ [0:07–1:29](https://www.youtube.com/watch?v=x&t=7s)', 'Lead prose.'];
    const ts = extractTimestamp(lines);
    expect(ts).toEqual({ label: '0:07–1:29', url: 'https://www.youtube.com/watch?v=x&t=7s' });
    expect(lines).toEqual(['Lead prose.']);
  });

  it('consumes a malformed ▶ line but returns null', () => {
    const lines = ['▶ not a link', 'Lead prose.'];
    expect(extractTimestamp(lines)).toBeNull();
    expect(lines).toEqual(['Lead prose.']);
  });

  it('returns null and leaves lines intact when no ▶ line', () => {
    const lines = ['Lead prose.', 'more'];
    expect(extractTimestamp(lines)).toBeNull();
    expect(lines).toEqual(['Lead prose.', 'more']);
  });

  it('only inspects the first non-blank line for the ▶', () => {
    const lines = ['', 'Lead prose.', '▶ [1:00–2:00](https://youtu.be/x?t=60s)'];
    expect(extractTimestamp(lines)).toBeNull();
    expect(lines).toContain('▶ [1:00–2:00](https://youtu.be/x?t=60s)');
  });

  it('accepts a well-formed ▶ link without a ?t= param (diverges from parse.ts)', () => {
    const lines = ['▶ [0:00–1:00](https://youtu.be/x)', 'Lead.'];
    expect(extractTimestamp(lines)).toEqual({ label: '0:00–1:00', url: 'https://youtu.be/x' });
    expect(lines).toEqual(['Lead.']);
  });
});

describe('linkifyHeaderUrl', () => {
  it('wraps the **URL:** value in a markdown link', () => {
    const out = linkifyHeaderUrl('**Channel:** C | **Duration:** 1:00 | **URL:** https://youtu.be/x');
    expect(out).toContain('**URL:** [https://youtu.be/x](https://youtu.be/x)');
  });

  it('leaves a non-http URL untouched', () => {
    const out = linkifyHeaderUrl('**URL:** mailto:a@b.com');
    expect(out).toBe('**URL:** mailto:a@b.com');
  });
});

describe('takeFirstParagraph', () => {
  it('splits the first paragraph from the rest', () => {
    const { para, rest } = takeFirstParagraph(['Lead line one.', 'line two.', '', '### Sub', '- x']);
    expect(para).toBe('Lead line one.\nline two.');
    expect(rest).toContain('### Sub');
  });

  it('returns empty para when the section opens with a block construct', () => {
    const { para, rest } = takeFirstParagraph(['- bullet', '- bullet2']);
    expect(para).toBe('');
    expect(rest).toContain('- bullet');
  });

  it('treats a blockquote opener as a block (no lead)', () => {
    expect(takeFirstParagraph(['> quoted', 'more']).para).toBe('');
  });

  it('treats a table-row opener as a block (no lead)', () => {
    expect(takeFirstParagraph(['| a | b |', '| - | - |']).para).toBe('');
  });
});

describe('splitFirstSentence', () => {
  it('splits off the first sentence', () => {
    const { first, rest } = splitFirstSentence('Johnson was unconventional. An author of books.');
    expect(first).toBe('Johnson was unconventional.');
    expect(rest).toBe('An author of books.');
  });

  it('returns the whole text as first when there is no terminator', () => {
    const { first, rest } = splitFirstSentence('a single clause with no end');
    expect(first).toBe('a single clause with no end');
    expect(rest).toBe('');
  });

  it('handles a Korean sentence terminator', () => {
    const { first, rest } = splitFirstSentence('이것은 문장입니다. 다음 문장.');
    expect(first).toBe('이것은 문장입니다.');
    expect(rest).toBe('다음 문장.');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest render-deep-dive-helpers`
Expected: FAIL — helpers are not exported / not defined.

- [ ] **Step 3: Implement the helpers**

In `lib/html-doc/render-deep-dive.ts`, add these exports (alongside the existing module code; leave `renderDeepDiveHtml` unchanged for now):

```ts
export interface RawSection {
  heading: string;
  lines: string[];
}

/** Fence-aware split of a deep-dive body into preamble + `## ` sections. */
export function splitSections(body: string): { preamble: string; sections: RawSection[] } {
  const lines = body.split('\n');
  const preambleLines: string[] = [];
  const sections: RawSection[] = [];
  let inFence = false;
  let current: RawSection | null = null;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      (current ? current.lines : preambleLines).push(line);
      continue;
    }
    const h = !inFence ? line.match(/^##\s+(.*)$/) : null;
    if (h) {
      if (current) sections.push(current);
      current = { heading: h[1].trim(), lines: [] };
      continue;
    }
    (current ? current.lines : preambleLines).push(line);
  }
  if (current) sections.push(current);
  return { preamble: preambleLines.join('\n'), sections };
}

// A `▶ [label](https url)` line (en dash U+2013 inside the label). Mirrors parse.ts TS_LINE_RE.
const TS_LINE_RE = /^▶\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/;

/**
 * Remove the leading `▶` line (first non-blank line of the section) and return its label+url.
 * Returns null when the first non-blank line is not a ▶ line, or when a ▶ line is malformed
 * (still consumed so it never leaks into prose). Mutates `lines`.
 */
export function extractTimestamp(lines: string[]): { label: string; url: string } | null {
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx === -1) return null;
  const line = lines[firstIdx];
  if (!line.trimStart().startsWith('▶')) return null;
  lines.splice(firstIdx, 1); // consume regardless of well-formedness
  const m = line.match(TS_LINE_RE);
  if (!m) return null;
  return { label: m[1], url: m[2] };
}

/** Rewrite the first `**URL:** <https url>` header occurrence into a markdown link. */
export function linkifyHeaderUrl(body: string): string {
  return body.replace(
    /(\*\*URL:\*\*\s+)(https?:\/\/\S+)/,
    (_m, pre: string, url: string) => `${pre}[${url}](${url})`,
  );
}

// A line that opens a block-level construct (so it is not a prose lead paragraph).
const BLOCK_START_RE = /^\s*([-*+]\s|\d+\.\s|#{1,6}\s|>|\||`{3}|~{3})/;

/**
 * First prose paragraph (lines up to the next blank line) vs the remainder.
 * Returns para='' (and rest = all remaining content) when the first non-blank line opens a
 * block construct (list, heading, blockquote, fence, table) — no gold lead in that case.
 */
export function takeFirstParagraph(lines: string[]): { para: string; rest: string } {
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return { para: '', rest: '' };
  if (BLOCK_START_RE.test(lines[i])) return { para: '', rest: lines.slice(i).join('\n') };
  let j = i;
  while (j < lines.length && lines[j].trim() !== '') j++;
  return { para: lines.slice(i, j).join('\n'), rest: lines.slice(j).join('\n') };
}

/** Split off the first sentence (terminator: . ! ? 。 ！ ？ + whitespace/end). */
export function splitFirstSentence(text: string): { first: string; rest: string } {
  const m = text.match(/^([\s\S]*?[.!?。！？])\s+([\s\S]*)$/);
  if (!m) return { first: text, rest: '' };
  return { first: m[1], rest: m[2] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest render-deep-dive-helpers`
Expected: PASS (all helper tests).

- [ ] **Step 5: Confirm no regression in the existing deep-dive render test**

Run: `npx jest render-deep-dive && npx tsc --noEmit`
Expected: PASS — `renderDeepDiveHtml` is untouched, so its tests are unaffected.

- [ ] **Step 6: Claude + Codex review, save to `docs/reviews/task-2-deep-dive-helpers-review.md` and `…-codex.md`; address High/Important findings; re-run tests.**

- [ ] **Step 7: Commit**

```bash
git add lib/html-doc/render-deep-dive.ts tests/lib/html-doc/render-deep-dive-helpers.test.ts docs/reviews/task-2-*
git commit -m "feat(deep-dive-doc): pure section/timestamp/sentence helpers"
```

---

### Task 3: Deep-dive renderer restructure (`render-deep-dive.ts`)

Wire the Task-2 helpers into `renderDeepDiveHtml`: relocate the `▶` to a trailing `.ts` link, gold only the lead's first sentence, linkify the header URL, swap the CSS, and add a `meta` palette key.

**Files:**
- Modify: `lib/html-doc/render-deep-dive.ts` (`renderDeepDiveHtml`, `STRUCTURAL_CSS`, `LIGHT`/`DARK` palettes)
- Test: `tests/lib/html-doc/render-deep-dive.test.ts` (update broken CSS assertions + add behavior tests)

**Interfaces:**
- Consumes: `splitSections`, `extractTimestamp`, `linkifyHeaderUrl`, `takeFirstParagraph`, `splitFirstSentence` (Task 2), `esc`, `md` (existing).
- Produces: nothing for later tasks.

- [ ] **Step 1: Update the existing CSS assertions + add behavior tests**

In `tests/lib/html-doc/render-deep-dive.test.ts`:

(a) Replace the body of the `'emits ghost-numeral CSS … and gold-lead rule'` test (the block asserting `.dd h2 + p`) with:

```ts
  it('emits ghost-numeral CSS and the new lead/lead-accent/ts rules (no old h2+p gold rule)', () => {
    expect(html).toContain('counter-reset:sec');
    expect(html).toContain('counter(sec)');
    expect(html).toContain('.dd h1');
    // New: gold is confined to the lead's first sentence via .lead-accent; lead text is normal ink.
    expect(html).toContain('.dd .lead{font-size:1.02rem;line-height:1.55;color:var(--ink)');
    expect(html).toContain('.dd .lead-accent{color:var(--gold);font-weight:400}');
    expect(html).toContain('.dd .ts{');
    expect(html).toContain('.dd .ts:hover{text-decoration:underline}');
    // Old adjacent-sibling gold rule is gone.
    expect(html).not.toContain('.dd h2 + p');
  });
```

(b) In the `'ships the magazine dark palette …'` test, append `meta: '#9a9082'` to the END of `DARK_EXPECTED` (after `quote`):

```ts
      codebg: '#2a241c', preborder: '#332c24', quote: '#9a9082', meta: '#9a9082',
```

(b2) **Add an exhaustive LIGHT palette test** (the deep-dive suite has no light-palette guard today, so a
misplaced/forgotten `meta` key in the LIGHT object would silently break `.dd .ts`'s `var(--meta)` with no
red test — B-1). Mirror the DARK structure, anchored to the `:root` block:

```ts
  it('emits the light palette with meta key in insertion order', () => {
    const LIGHT_EXPECTED: Record<string, string> = {
      page: '#eef0f3', card: '#fbf9f6', ink: '#2a2622', rule: '#ece7df',
      ghost: '#f0e7d6', gold: '#b07700', goldline: '#e0a800', li: '#4a463f', foot: '#9a917f',
      shadow: '0 1px 3px rgba(0,0,0,.08)', link: '#b07700', h3: '#5b463a', h4: '#6b5a4a',
      codebg: '#f1ebe0', preborder: '#e6ddcf', quote: '#8a8276', meta: '#8a8276',
    };
    const lightDecls = Object.entries(LIGHT_EXPECTED).map(([k, v]) => `--${k}:${v}`).join(';');
    expect(html).toContain(`:root{${lightDecls}}`);
  });
```

(c) Add new behavior tests:

```ts
  describe('section restructure', () => {
    const SEC_MD = `---
video_id: "v1"
lang: EN
---

# T (Deep Dive)

**Channel:** C | **Duration:** 5:00 | **URL:** https://youtu.be/v1

---

## The Genesis
▶ [1:29–3:33](https://www.youtube.com/watch?v=v1&t=89s)
Johnson was unconventional. An author of a dozen books joined later.

### Detail
- point one
- point two

## No Timestamp Here
A lone lead sentence with no marker.
`;
    const out = renderDeepDiveHtml(SEC_MD, 'v1-deep-dive.md');

    it('moves the ▶ into a trailing muted .ts link on the heading', () => {
      expect(out).toContain(
        '<a class="ts" href="https://www.youtube.com/watch?v=v1&amp;t=89s" target="_blank" rel="noopener noreferrer">(1:29–3:33)</a>',
      );
      // the ▶ glyph no longer appears in the rendered body
      expect(out).not.toContain('▶');
    });

    it('golds only the first sentence of the lead', () => {
      expect(out).toContain('<span class="lead-accent">Johnson was unconventional.</span>');
      // second sentence is outside the accent span
      expect(out).toMatch(/<\/span>\s*An author of a dozen books joined later\./);
    });

    it('preserves rich content after the lead (h3 + list)', () => {
      expect(out).toContain('<h3>Detail</h3>');
      expect(out).toContain('<li>point one</li>');
    });

    it('renders a section with no ▶ line: heading without a .ts link, lead still accented', () => {
      expect(out).toContain('<h2>No Timestamp Here</h2>');
      expect(out).toContain('<span class="lead-accent">A lone lead sentence with no marker.</span>');
    });

    it('linkifies the header URL', () => {
      expect(out).toContain('href="https://youtu.be/v1"');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest render-deep-dive.test`
Expected: FAIL — old renderer emits `.dd h2 + p`, no `.lead-accent`/`.ts`, ▶ still in body, header URL plain text, `meta` missing from dark palette.

- [ ] **Step 3: Implement the restructured renderer**

In `lib/html-doc/render-deep-dive.ts`:

(a) Add `meta` to both palettes (append after `quote`):

```ts
const LIGHT: Palette = {
  ...BASE_PALETTE_LIGHT_PRE, ...BASE_PALETTE_LIGHT_POST, link: '#b07700', h3: '#5b463a', h4: '#6b5a4a',
  codebg: '#f1ebe0', preborder: '#e6ddcf', quote: '#8a8276', meta: '#8a8276',
};
const DARK: Palette = {
  ...BASE_PALETTE_DARK_PRE, ...BASE_PALETTE_DARK_POST, link: '#e6b54d', h3: '#d8cdb8', h4: '#c4b7a0',
  codebg: '#2a241c', preborder: '#332c24', quote: '#9a9082', meta: '#9a9082',
};
```

(b) In `STRUCTURAL_CSS`, **remove** the line:

```
.dd h2 + p{font-size:1.02rem;line-height:1.55;color:var(--gold);font-weight:400;margin:.3em 0 .9em;max-width:92%}
```

and **add** (after the `.dd h2` rules):

```
.dd .lead{font-size:1.02rem;line-height:1.55;color:var(--ink);font-weight:400;margin:.3em 0 .9em;max-width:92%}
.dd .lead-accent{color:var(--gold);font-weight:400}
.dd .ts{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.85rem;font-weight:400;text-decoration:none;white-space:nowrap}
.dd .ts:hover{text-decoration:underline}
```

(c) Add a `renderSection` helper near the top-level functions:

```ts
function renderSection(raw: RawSection): string {
  const lines = [...raw.lines];
  const ts = extractTimestamp(lines); // mutates lines (removes the ▶ line)
  const tsHtml = ts
    ? ` <a class="ts" href="${esc(ts.url)}" target="_blank" rel="noopener noreferrer">(${esc(ts.label)})</a>`
    : '';
  const heading = `<h2>${md.renderInline(raw.heading)}${tsHtml}</h2>`;

  const { para, rest } = takeFirstParagraph(lines);
  let leadHtml = '';
  if (para) {
    const { first, rest: tail } = splitFirstSentence(para);
    const firstHtml = md.renderInline(first);
    const tailHtml = tail ? ` ${md.renderInline(tail)}` : '';
    leadHtml = `<p class="lead"><span class="lead-accent">${firstHtml}</span>${tailHtml}</p>`;
  }
  const restHtml = rest.trim() ? md.render(rest) : '';
  return `${heading}\n${leadHtml}${restHtml}`;
}
```

(d) Replace the body of `renderDeepDiveHtml` between the frontmatter strip and the `return` with:

```ts
  // Strip the leading YAML frontmatter block, normalize newlines, linkify the header URL.
  // linkifyHeaderUrl is a non-global replace, so only the FIRST `**URL:** <url>` is linked — that is
  // our standardized header line, which always precedes any body content/code fences in the .md.
  let body = mdContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/\r\n/g, '\n');
  body = linkifyHeaderUrl(body);
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? 'Deep Dive';

  // Preamble (our H1 + meta + ---) renders faithfully; each `## ` section is restructured so the
  // ▶ timestamp trails the heading (muted) and gold lands only on the lead's first sentence.
  const { preamble, sections } = splitSections(body);
  const preambleHtml = md.render(preamble);
  const sectionsHtml = sections.map(renderSection).join('\n');
  const bodyHtml = `${preambleHtml}\n${sectionsHtml}`;
```

(The existing `return` template already interpolates `${bodyHtml}` into `<article class="dd">…</article>` — leave it as-is.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest render-deep-dive`
Expected: PASS (helpers + restructure + updated CSS assertions).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Claude + Codex review, save to `docs/reviews/task-3-deep-dive-restructure-review.md` and `…-codex.md`; address High/Important findings; re-run tests.**

- [ ] **Step 7: Commit**

```bash
git add lib/html-doc/render-deep-dive.ts tests/lib/html-doc/render-deep-dive.test.ts docs/reviews/task-3-*
git commit -m "feat(deep-dive-doc): trailing muted timestamps, first-sentence gold, clickable URL"
```

---

## Verification (Phase 4)

After Task 3, re-render one real deep-dive and one summary `.md` and view in a browser. Enumerate as a TaskCreate checklist before clicking:
- Deep-dive heading shows `(label)` muted/parenthesized at the title end; clicking opens YouTube at the start time.
- Only the first sentence of each section lead is gold.
- Header URL is clickable in the deep dive; meta-line URL is clickable in the summary.
- Section with no transcript (video-only deep dive) renders without a `.ts` link and without leaking `▶`.
- Light + dark theme both legible; print drops to light.

Screenshots → `.screenshots/`, deleted after verification.

## Self-Review Notes

- **Spec coverage:** Change A → Task 1; Change B (URL linkify) → Task 2 (`linkifyHeaderUrl`) + Task 3 (wiring); Change C (section restructure, gold scope, ts relocation) → Task 2 helpers + Task 3. All spec edge cases map to helper tests (Task 2) or behavior tests (Task 3).
- **Type consistency:** `RawSection`, `splitSections`, `extractTimestamp`, `linkifyHeaderUrl`, `takeFirstParagraph`, `splitFirstSentence` names identical across Task 2 (definition), Task 3 (consumption), and the test files.
- **No placeholders:** every step has concrete code/commands.
