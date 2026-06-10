# Adversarial Spec Review — Deep-Dive HTML Export (faithful render)

**Reviewer:** Claude (claude-opus-4-8), acting as the **documented Codex fallback** per `docs/plugins.md`
(Codex rate-limited). **A Codex adversarial pass is still owed on this spec before merge.**
**Date:** 2026-06-09
**Spec under review:** `docs/superpowers/specs/2026-06-09-deep-dive-html-export-design.md`
**Branch:** `feat/deep-dive-html-export`

**Verdict: CHANGES-REQUIRED** — one Blocking finding (non-ASCII filename → permanent 404 for ~half
the corpus, inherited from the summary feature) plus several High findings (index read-modify-write
clobber under concurrency, archive/staleness gaps, preamble noise, head-provenance contradiction).

---

## What the spec gets right

- **Filename derivation is correct** (claim #3 holds). `lib/deep-dive.ts:62-63` sets
  `deepDiveMd = "${base}-deep-dive.md"` where `base = summaryMd.replace(/\.md$/,'')`. So
  `deepDiveMd.replace(/\.md$/,'')` → `<slug>-deep-dive`, and `htmls/<slug>-deep-dive.html` has **no
  doubled** `-deep-dive`. Verified against the real index: `full-ai-prompting-course-with-andrew-ng-deep-dive.md`
  → `htmls/full-ai-prompting-course-with-andrew-ng-deep-dive.html`. Good.
- **No-job-lock reasoning for the FILE is sound.** The render is deterministic and the atomic
  temp→rename means concurrent first-views write identical bytes; last rename wins, harmless. (The
  index write is a separate problem — see High-1.)
- **`html:false` is the right default** and a realistic fit for the local, self-viewed threat model
  (see Medium-1 for the residual link-sanitization nuance).
- **Serve-or-generate keyed on the file existing on disk** (not the flag) is the right call and
  correctly tolerates a flag-set-but-file-deleted state.
- **Verified non-issues:** `markdown-it` is a plain Node library — the AGENTS.md "modified Next.js"
  warning does not touch it. `marked` and `markdown-it` are both currently **absent** from
  `package.json` (neither installed), so this is a clean new dependency.

---

## BLOCKING

### B-1. Non-ASCII (Korean) deep-dive filenames → permanent 404. ~Half the corpus is affected.

The serve-route path-traversal regex is **ASCII-only**:
`/^htmls\/[A-Za-z0-9._-]+\.html$/` (route.ts:43). The spec asserts (line 113–114) "the existing
regex already admits the `-deep-dive` suffix (hyphens allowed)" — **true for hyphens, but it
silently omits that the corpus is bilingual.** Roughly half the videos have Korean slugs:

```
"summaryMd": "모든-곳에-구글이-있었다-gemini로-바꾸려는-인터넷의-질서.md"
```

I verified the regex against a representative KO deep-dive name:

```
re.test('htmls/모든-곳에-구글이-있었다-gemini로-deep-dive.html')  →  false
```

Consequence for the deep-dive feature exactly as specced:
1. First view → `runDeepDiveHtml` renders, atomic-writes `htmls/모든-…-deep-dive.html`, sets
   `deepDiveHtml` in the index. (All of this succeeds — neither `generate-deep-dive.ts` nor
   `lib/deep-dive.ts` validate against the regex.)
2. Serve route then runs `HTML_REL_RE.test(htmlFile)` → **false** → **404 "html not available."**
3. Because the file *does* exist, every subsequent view repeats step 2. The user gets a permanent
   404 on a file that is sitting on disk, fully rendered. No error explains why.

**This is a pre-existing latent bug in the shipped summary feature**, not a new one the deep-dive
spec introduces — `lib/html-doc/generate.ts:46` derives `base = video.summaryMd.replace(/\.md$/,'')`
verbatim (no slugification), so KO summaries hit the identical dead end. The deep-dive spec
faithfully **replicates** the bug. Either way, this spec must not ship the same broken path.

**Fix (pick one, spec must state which):**
- **(a) Widen the regex to allow Unicode word characters**, e.g.
  `/^htmls\/[\p{L}\p{N}._\- ]+\.html$/u` (still forbids `/`, so `..` can't appear; the
  resolved-path containment check at route.ts:47-51 remains the real traversal backstop). This
  fixes both summary and deep-dive. **Preferred** — it is the smallest correct change and unblocks
  the existing summary feature too.
- **(b) Drop the regex entirely** and rely solely on `path.resolve` containment + a basename check
  (`path.dirname(htmlPath) === htmlDir && htmlFile.endsWith('.html')`). The regex is defense-in-depth
  over a guard that is already sufficient; the ASCII restriction is incidental, not a security
  requirement.
- **(c) Slugify the base to ASCII before deriving the html filename.** Rejected: it would mismatch
  the on-disk `.md`/`.pdf` names (which are NOT ASCII-slugified) and break the `<meta name="source-md">`
  provenance contract. Do not do this.

Whichever fix is chosen, add an **explicit test** with a Korean `deepDiveMd` (and, ideally, fix and
test the summary path in the same change since they share the regex). The spec's test list (line
159–174) has **zero non-ASCII filename cases** — only "KO content" inside the body, which is a
different axis.

---

## HIGH

### H-1. Index write is read-modify-write with no lock → concurrent generations can clobber unrelated fields.

The spec's "no job lock … harmless" claim (lines 58–60) reasons only about the **HTML file**. It
does **not** cover the **index JSON**, which is the real hazard. `updateVideoFields`
(index-store.ts:91-103) is a full **read-modify-write**: it `readIndex()` → mutates one video →
`writeIndex()` the **entire** index via temp→rename. There is no lock and no per-field merge.

Concurrent scenario (both realistic and reachable because generation now lives inside GET):
1. User opens the deep-dive HTML in a new tab → GET A starts `runDeepDiveHtml`, calls `readIndex()`
   (snapshot S0).
2. Meanwhile the user triggers an unrelated index mutation on **another** video — a Deep Dive run,
   an Archive, an HTML-doc generation, a re-ingest. That write commits index state S1 (S0 + that
   video's new fields).
3. GET A finishes rendering, calls `updateVideoFields` → it re-reads inside `updateVideoFields`
   (index-store.ts:94 does its own `readIndex`), **so it sees S1, not S0** — good for that one call.

So the *single* `updateVideoFields` call is internally read-fresh-then-write and will **not** clobber
a sequential earlier write. **But** the window between *two* such whole-file writes is a classic
last-writer-wins race: if two `writeIndex` calls interleave (A reads S1, B reads S1, A writes S1+a,
B writes S1+b), **B's write drops A's field**. With generation now triggered by a GET (which a
browser, a prefetch, or a double-click can fire twice nearly simultaneously, and which can overlap
with the Deep Dive POST or Archive), this interleaving is reachable.

Note the existing summary `generate.ts` has the same exposure, but it is gated behind a POST + a job
lock ("if a job for this video is already live, return that jobId" — summary spec line 200-202),
which serializes its index writes per video. **The deep-dive spec deliberately removes that lock**,
so it has strictly *less* protection than the feature it copies.

**Severity rationale:** single-user local app, small write window, temp→rename is atomic at the file
level — so corruption is unlikely and the blast radius is "a recently-set field is silently lost,"
not a crashed app. Hence High, not Blocking. But the spec's flat assertion that lock-free is
"harmless" is **wrong as written** because it analyzed the wrong resource.

**Fixes (spec should adopt at least one and stop claiming the index write is unconditionally safe):**
- **Make the index write a no-op when the field is already correct.** Before `updateVideoFields`,
  re-read and skip if `video.deepDiveHtml === htmlFilename` AND the file exists. This shrinks (does
  not eliminate) the window and makes a double-view a true no-op.
- **Best: serialize index writes.** Add a tiny per-folder async mutex/queue around
  `read-modify-write` in `index-store.ts` (or an O_EXCL lockfile around `updateVideoFields`). This
  is the correct structural fix and also retroactively protects summary HTML, Archive, and Deep
  Dive, all of which share `updateVideoFields`. Recommend this be called out as a shared follow-up
  even if deep-dive ships with the cheaper no-op guard.
- At minimum: **delete the "no job lock … harmless" justification's implication that the *index*
  write is race-free.** Re-scope the claim to the file only, and document the index write as
  "last-writer-wins, mitigated by the idempotent-skip guard."

### H-2. TOCTOU between the file-existence check and the read (claim #1).

Spec data-flow steps 3–4 (lines 93–94): "file exists → serve; else generate → serve." If
implemented as `fs.existsSync(htmlPath)` then `fs.readFileSync(htmlPath)`, two first-views race: A
sees missing → generates; B sees missing → generates; both rename (harmless per the spec). But also:
A could be mid-`rename` when B does `readFileSync` and catch a transient ENOENT, or read a partially
visible file on a filesystem where rename isn't atomic. On macOS/APFS local (this project's env)
rename **is** atomic, so the partial-read risk is low — but the spec should **specify the
serve-after-generate path explicitly**: generate returns the rendered string in-memory and the route
serves *that* buffer, rather than generate→write→re-read-from-disk. That removes the TOCTOU entirely
and avoids a redundant disk read. The existing route reads from disk (route.ts:54); the deep-dive
branch should serve the just-rendered bytes when it generated them.

### H-3. Archive leaves an orphan HTML and a stale `deepDiveHtml` flag.

`lib/archive.ts:20` moves only `[summaryMd, summaryPdf, deepDiveMd, deepDivePdf]` into `archived/`.
It does **not** move `htmls/<base>-deep-dive.html`, and it does not clear `deepDiveHtml`. After
archiving a video:
- The deep-dive `.md` moves to `archived/…`, but the cached HTML stays in `htmls/`.
- `deepDiveHtml` still points at the live `htmls/…` path → the serve route still 200s the HTML for
  an archived video whose source `.md` is gone. On **unarchive**, `moveIfExists` is no-clobber, so
  if a new HTML was generated meanwhile, the stale one wins.

The spec's staleness section (claim #4) only addresses **deep-dive regeneration**, not archive.
**Fix:** add `htmls/<base>-deep-dive.html` to the archive FilePair list (and the summary HTML too —
same omission), or clear `deepDiveHtml`/`summaryHtml` on archive. The spec must add an
**Archive interaction** subsection; right now it is silent on this entire path.

### H-4. The deep-dive preamble noise line is not addressed — it will render verbatim.

The real artifact contains, right after the `---`:

```
Of course. Here is a comprehensive deep-dive analysis of the YouTube video "The ABCs of AI Agent Protocols."
```

This is Gemini conversational throat-clearing that leaks into the body (`lib/deep-dive.ts:67` strips
only a leading `# H1`, not this preamble). The spec's render section (claim #6 / line 159) says
"frontmatter stripped" and "render the body," but is **silent on the preamble**. As written, the
faithful render will display "Of course. Here is…" as the first paragraph of the HTML — exactly the
noise a "faithful, screen-readable" view should not lead with.

**Decision the spec must make explicitly:** strip a leading "Of course…/Here is…" preamble paragraph
(before the first `###` heading), or keep it. Given the goal ("the PDF but colorable"), and that the
PDF currently *also* shows this line, "keep for fidelity with the PDF" is defensible — but it must be
a **stated decision with a test**, not an omission. If stripping, strip only the paragraph(s)
*before the first `### ` heading* to avoid eating real content.

---

## MEDIUM

### M-1. `html:false` is sufficient for raw HTML, but NOT for `javascript:` URLs in links/images.

`markdown-it` with `html:false` escapes raw HTML tags — so `<script>` and `<img onerror>` in the
source become inert text (the spec's tested cases). **However**, `html:false` does **not** sanitize
**link/image hrefs produced by markdown syntax**. Markdown like `[click](javascript:alert(1))` or
`![x](javascript:…)` is rendered by `markdown-it` into a real `<a href="javascript:…">`. markdown-it
*does* ship a `validateLink` default that blocks `javascript:`, `vbscript:`, `file:`, and most
`data:` — **so by default you are protected** — but the spec must **not silently rely on an
undocumented default it never names.** 

**Threat-model reality check:** the content is the user's own Gemini-generated deep-dive, viewed
locally by the same user. A malicious `javascript:` link would have to be (a) emitted by Gemini and
(b) clicked by the user in their own file. Low likelihood, low blast radius (no secrets in this
local static page; no cookies/origin worth stealing). So this is **Medium, not High.** 

**Fix:** the spec should add one sentence: "rely on markdown-it's default `validateLink` (blocks
`javascript:`/`vbscript:`/`file:`/non-image `data:`); do not override it" — and add **one unit test**
asserting `[x](javascript:alert(1))` does NOT render an active `javascript:` href. That converts an
implicit dependency on a library default into a tested contract that a future `validateLink: () => true`
"fix" can't silently regress.

### M-2. `<head>` provenance contradiction: `source-md` is specified two different ways.

Line 75 (render-deep-dive responsibility) and line 103/109 say `htmls/<base>.html` where base
already ends in `-deep-dive`; line 109 sets `<meta name="source-md" content="<base>.md">`. Confirm
the intended value is the **full** `deepDiveMd` (`<slug>-deep-dive.md`), not a re-derived `<slug>.md`.
As written it's ambiguous whether `<base>` in the meta is the html base (`<slug>-deep-dive`) or the
summary base (`<slug>`). State it: `source-md = video.deepDiveMd` verbatim. (The summary feature sets
`parsed.sourceMd = video.summaryMd` verbatim — mirror that.)

### M-3. `### **N. Heading**` (bold-inside-heading) — verify the rendered output and CSS target.

The body uses `### **1. High-Level Summary**` — an H3 whose entire text is wrapped in `**bold**`.
`markdown-it` renders this as `<h3><strong>1. High-Level Summary</strong></h3>`. That's valid, but:
(a) the spec's "colored headings" CSS must target `h3` (and `h3 strong`) or the color won't apply
through the nested `<strong>`; (b) the bold is now **redundant** with heading weight. Not a bug, but
the spec's CSS contract (line 111) says "colored headings" generically — it should name the actual
heading levels present (`h1` standardized header, `h3`/`h4` body sections, `####` sub-sections like
`#### **A. MCP…**`) so the implementer styles the levels that actually occur, not `h2` (which the
deep-dive body does **not** use — confirmed: body uses `###`/`####`, not `##`).

### M-4. Serve-route widening — low regression risk, but the test list must pin the summary path.

Changing `type !== 'summary'` (route.ts:24) to a `summary|deep-dive` allow-list is mechanically safe
**if** the summary branch is preserved unchanged. Risk is regression-by-refactor (e.g. moving the
`video.summaryHtml` read into a shared block and breaking it). The spec's test list does include "the
existing summary path still works" (line 167) — **good**, keep that as a hard gate. Add one negative:
`type=summary` for a video with `summaryHtml` unset still 404s (not 400), and `type=deep-dive` for a
video with no `deepDiveMd` 404s while `type=garbage` 400s — i.e. **400 = bad request shape, 404 =
valid request, absent resource.** The spec asserts this (line 122-130) but the test list doesn't
enumerate all four corners; make it explicit.

---

## LOW

### L-1. `@types/markdown-it` is a separate package — add it to devDependencies.

`markdown-it` ships no bundled types; `@types/markdown-it` is **absent** (verified). The spec's
dependency note (claim #7) should list **both** `markdown-it` and `@types/markdown-it`, else the
`render-deep-dive.ts` import is untyped and may trip the project's TS config.

### L-2. CRLF / empty-body / huge-file edge cases unstated.

`markdown-it` handles CRLF and large inputs fine, and an empty body just yields empty `<article>`.
Low risk, but the spec's render test list should add: empty/whitespace-only body → valid (empty)
HTML, not a throw; and a CRLF fixture (Gemini output is `\n`, but a user-edited deep-dive `.md` could
be CRLF). One assertion each.

### L-3. `langPrefix` / highlight config — confirm ascii stays in a plain `<pre>`.

The spec worries (claim #6) whether markdown-it needs highlight config to keep ascii intact. It does
**not**: with no `highlight` function, ` ```ascii ` renders to
`<pre><code class="language-ascii">…</code></pre>` with the content **HTML-escaped but byte-preserved**
(this is what makes `+`, `|`, `↓`, `\`, `/` survive). The only requirement is the CSS `<pre>` rule
(line 111) — already specced. No highlight config needed; the spec can state this affirmatively to
close the open question. The integration test (line 170-171) asserting the ascii block is present and
in `<pre>` is the right guard — keep it, and add a **byte-equality** assertion on the diagram content
(the spec says "byte-preserved" at line 160 — make the integration test assert exactly that against
the real `the-abcs-of-agent-building-deep-dive.md` MCP diagram).

---

## Testing gaps (consolidated)

The spec's test list (lines 159–174) is missing, in priority order:
1. **(Blocking) Non-ASCII `deepDiveMd`** end-to-end: KO-slug deep-dive → generate → **serve 200**
   (this is the regression-proof for B-1). Also retro-test the KO summary path.
2. **(High) Concurrency:** two overlapping first-views, and a first-view overlapping an unrelated
   `updateVideoFields` (e.g. archive of another video) → both videos' fields survive (proof for H-1).
3. **(High) Archive interaction:** archive a video with `deepDiveHtml` set → HTML moved/flag cleared;
   serve route 404s the archived HTML (proof for H-3).
4. **(High) Preamble:** decide keep/strip and assert it (proof for H-4).
5. **(Medium) `javascript:` link** does not render an active href (proof for M-1).
6. **(Medium) Heading-color CSS** targets `h3`/`h3 strong` (proof for M-3) — or at least an
   integration assertion that an `### **N.**` heading carries the heading class/color.
7. The existing "summary path still works" + the full 400-vs-404 corner table (M-4).

---

## Summary table

| # | Sev | Finding | Fix |
|---|---|---|---|
| B-1 | **Blocking** | ASCII-only path regex 404s every Korean-slug deep-dive (~half the corpus); inherited from the summary feature | Widen regex to `\p{L}\p{N}` (Unicode, `u` flag) or drop regex for the containment guard; test a KO `deepDiveMd` |
| H-1 | High | Lock-free index `updateVideoFields` is read-modify-write → concurrent whole-file writes drop fields; "harmless" claim analyzed the file, not the index | Idempotent-skip guard now; per-folder write mutex in `index-store` as shared follow-up; rescope the claim |
| H-2 | High | TOCTOU/redundant re-read in serve-after-generate | Serve the just-rendered in-memory bytes; don't write-then-re-read |
| H-3 | High | Archive doesn't move the cached HTML or clear `deepDiveHtml` (and summary HTML has the same gap) | Add HTML to `archive.ts` FilePair list or clear the flag on archive; add an Archive subsection + test |
| H-4 | High | "Of course. Here is…" preamble renders verbatim as the first paragraph | Spec must decide keep vs strip-before-first-`###`; test it |
| M-1 | Medium | `html:false` doesn't cover `javascript:` link hrefs (markdown-it default `validateLink` does — but unnamed) | Name the dependency on `validateLink`; add a `javascript:` link test |
| M-2 | Medium | `<meta source-md>` value ambiguous (`<base>.md` vs full `deepDiveMd`) | State `source-md = video.deepDiveMd` verbatim |
| M-3 | Medium | CSS contract says "colored headings" but body uses `### **N.**`/`####`, not `##`/`h2` | Name actual heading levels; style `h3`/`h3 strong`/`h4` |
| M-4 | Medium | Serve-route widening regression risk | Keep "summary still works" gate; enumerate all 400-vs-404 corners |
| L-1 | Low | `@types/markdown-it` not listed | Add to devDependencies |
| L-2 | Low | CRLF / empty-body cases unstated | Add two assertions |
| L-3 | Low | langPrefix/highlight open question | State: no highlight config needed; assert byte-equality on the real ascii diagram |

**Verdict: CHANGES-REQUIRED.** Resolve B-1 and H-1..H-4 in the spec (mostly stated decisions + a
handful of tests, not architectural rework) before implementation. A Codex adversarial pass is still
owed on this spec per `docs/plugins.md`.
