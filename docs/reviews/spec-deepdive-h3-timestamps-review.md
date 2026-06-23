# Adversarial Spec Review — deepdive-h3-timestamps

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: **needs-rework** → no Blocking; core approach approved (additive — only one existing test breaks, already planned). All High/Medium folded into spec; implementation guardrails + added tests carried into the plan.

## Applied to spec
- **H1 — fence-aware H3 split is load-bearing.** `rest` can contain `### `/`## `-looking lines INSIDE fences (the ASCII-diagram fixture does). The H3 splitter MUST copy `splitSections`' `inFence` toggle (`/^\s*(```|~~~)/`) verbatim — a naïve `rest.split(/^### /m)` would tear fenced content out of `<pre><code>`. Spec now mandates this; test asserts a fenced `### ` survives inside `<pre><code>`.
- **H2 — regex pinned `/^###\s+(.*)$/`.** Matches H3 only (rejects `#### ` — `#` isn't `\s` — and `###x` with no space, which CommonMark renders as prose). Spec pins it; tests for `###x`→prose and `#### `→not-folded added in plan.
- **H3 — prose-▶ limitation acknowledged.** `extractTimestamp` consumes the first non-blank line if it starts with `▶` regardless of well-formedness; a subsection body line legitimately starting with `▶` (not a TS line) is dropped — same accepted contract as H2. Noted as a known limitation alongside H4.
- **M1 — verification target re-stated.** Don't gate on "→20 ts" for `yB16BT1IMag` until grep confirms all 11 raw ▶ are H3-led (not H4-led). Criterion is now "every H3-led ▶ becomes `class="ts"`; H4-led ▶ remain raw (counted separately)."
- **M4 — migration claim re-scoped.** Minor bump `{2,1}→{2,2}` → `needsRegenerate` is false (major-only) → only **major-2** docs hit the cheap `reRenderDeepDiveHtml` path. **Pre-major-2 docs (`deepDiveVersion` absent/`{1,x}`) hit a full Gemini regenerate** regardless of this change — the "lazy re-render works" claim is scoped to major-2 docs.

## Carried into the PLAN (implementation guardrails + tests)
- **LOW-2 / M2 — HTML composition:** build the `<h3>` as a STRING (`<h3>${md.renderInline(heading)}${tsHtml}</h3>`), `md.render` bodies SEPARATELY; NEVER inject `<a class="ts">` into a markdown string fed to `md.render` (`html:false` would escape it). Plain `### Detail` must produce byte-identical `<h3>Detail</h3>` to today (keeps existing test line 199 green); bold `### **X**` → `<h3><strong>X</strong></h3>` via `renderInline`. Add a bold-H3-in-section test.
- **M3 — version test + E2E:** update `version.test.ts:6` to `{2,2}`; confirm the E2E `{2,0}` fixtures (`deep-dive-doc.spec.ts:171,312`) don't silently shift from no-op into the re-render branch (they inject `current` or stored major < 2 — verify behavior/progress events unchanged). `ensure.test.ts` injects `current` explicitly → decoupled, safe.
- **LOW-1 — migration script must surface non-`rerendered` statuses** (`skipped-no-md` etc.), not silently skip.
- **LOW-4 — idempotency test:** the H3 label appears exactly once in output (no double-render).
- **LOW-5 — empty-preH3 test:** an H2 section whose body starts immediately with `### ` (takeFirstParagraph → para='' since `### ` matches BLOCK_START_RE) → no `class="lead"`, first sub folded.

## Verified-correct (reviewer)
No existing render test breaks (the `SEC_MD` `### Detail` fixture has no ▶ → folds to unchanged `<h3>Detail</h3>`; `not.toContain('▶')` still holds). Section counter (`counter-increment:sec` on h2 only) + `.dd h3` CSS unaffected by manual `<h3>`. markdown-it adds no heading `id`/anchor (no plugin) → manual `<h3>` loses nothing. `needsRegenerate` major-only confirmed. `reRenderDeepDiveHtml(videoId, folder)` reads `video.deepDiveMd` from the index, re-runs `renderDeepDiveHtml` (no Gemini) → a `.md` with H3 ▶ renders them as `class="ts"` after re-render. Exactly one test break (`version.test.ts:6`), already planned.
