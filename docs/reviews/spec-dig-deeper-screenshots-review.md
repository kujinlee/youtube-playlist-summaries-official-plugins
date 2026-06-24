# Adversarial Review — Dig-Deeper with Slide Screenshots (Spec)

**Date:** 2026-06-24
**Reviewer:** Claude (opus) adversarial review — **Codex fallback**.
**Codex gap:** Codex is at its usage limit until 2026-07-18 (per project record). Per `docs/plugins.md` fallback policy, a rigorous Claude adversarial review stands in. **Re-attempt the Codex-specific pass before merge** if access returns.
**Spec reviewed:** `docs/superpowers/specs/2026-06-24-section-dig-deeper-screenshots-design.md` (commit `eb241dd`)

---

## Verdict (reviewer)

**Not ready to plan against** until three load-bearing claims are verified by a spike: (1) `videoMetadata` clip-grounding on the installed SDK (B3), (2) absolute-vs-clip-relative timestamp frame-of-reference (B4), (3) the cost thesis that rests on them (M1). Plus the static-HTML dug-state mechanism (B1) and the POST/GET SSE redesign (B2) must be specified, and several units are missing (H6).

---

## Findings

### BLOCKING

- **B1 — Static summary HTML cannot render a per-section, state-aware control.** The summary HTML is written once at gen time; `digControl` is emitted uniformly, gated on `!!video.deepDiveMd` (`render.ts:83`), not per-section dug-state. No mechanism specified for how a static file learns which sections are dug.
- **B2 — SSE design contradicts the project's two-route pattern.** Existing: POST trigger creates a job (`job-registry.ts`), GET `/stream?jobId=` only subscribes (`deep-dive/stream/route.ts:6-19`). Spec's single side-effecting `GET .../stream` both mutates state and spends money → CSRF/prefetch-triggerable. **Confirmed** against code.
- **B3 — `videoMetadata` clipping UNVERIFIED / likely unsupported on installed SDK.** `@google/generative-ai@0.24.1` has **0** `videoMetadata`/`startOffset` types (**confirmed**); `@google/genai` not installed (**confirmed**). If `videoMetadata` is silently dropped, every dig uploads the full video → cost model inverts.
- **B4 — Absolute-vs-clip-relative timestamp assumption is a guess.** `ffmpeg -ss (sec - S)` is only correct if Gemini emits absolute seconds. Unverified; prompt instruction ≠ guaranteed behavior. If clip-relative, all `[[SLIDE]]` tokens fail the `sec ∈ [S,E]` validation and all screenshots are wrong.

### HIGH

- **H1 — `section.prose`/`startSec` data threading elided.** `prose` is on `ParsedSection` (`types.ts:15`), not the magazine model (`types.ts:40-47`) and not the summary HTML. Route must re-parse the summary `.md` via `parseSummaryMarkdown`; "summary model" is ambiguous.
- **H2 — Windowed `resolveTranscriptTokens` silently tail-drops.** Resolver derives `videoDuration` from the array it's given (`transcript-timestamps.ts:84-85`) and drops candidates `>= duration` (`:97`) → last segment(s) of each window dropped. Works but lossy; undocumented.
- **H3 — Command injection / unvalidated inputs into yt-dlp + ffmpeg.** No spawn discipline stated. `sec` is Gemini-influenced. Must use `execFile`/`spawn` argv arrays, validate `videoId` (`VIDEO_ID_RE`, `index-store.ts:8`), coerce numerics, construct `youtubeUrl` server-side.
- **H4 — Caption → markdown/HTML injection.** Gemini caption interpolated into `![caption](...)`; `]`/`)`/newlines break syntax; companion renderer unspecified (if it doesn't use `markdown-it({html:false})`, XSS is live).
- **H5 — `[[SLIDE:sec|caption]]` grammar ambiguous.** No rule for `|`/`]]` in caption, non-numeric/negative/float `sec`, >3 slides, duplicate `sec` (filename collision on `<sec>.jpg`).
- **H6 — Missing units:** companion-doc HTML renderer (with base64 image inlining — `renderDeepDiveHtml` doesn't inline images today); `type=dig-deeper` serve route (`html/[id]/route.ts:27-30` hard-rejects unknown types with 400); index fields `digDeeperMd`/`digDeeperHtml`.
- **H7 — In-process write queue insufficient.** No per-`(videoId,sectionId)` in-flight guard → double-dig wastes Gemini+download and races asset/doc writes. Need: in-flight guard + write-assets-before-doc-commit ordering.

### MEDIUM

- **M1 — Cost model unfounded at DEFAULT res** (depends on B3/B4). Recompute from real `usageMetadata` after the spike.
- **M2 — `--download-sections` may download a large prefix** (no true ranged seek for some formats). "Seconds of 720p" optimistic.
- **M3 — Asset-path guard conflated with the `.md` guard.** PR#13's `assertSafeDeepDiveMd` validates a filename, not `assets/<videoId>/<sec>.jpg`. Need a dedicated asset-path containment assertion.
- **M4 — Obsidian/HTML path invariant** should be locked: `.md` uses `assets/...` relative-to-`raw/`; HTML always base64-inlines, never relative `img src`.
- **M5 — Empty-window + zero-slide section** yields thin prose-only output that still costs a call; "coverage ≥ summary" unverifiable. Acceptable MVP, call it out.
- **M6 — `digVersion` does nothing.** Either give it a use (provenance stamp / `↻` semantics) or drop it.

### LOW

- **L1 — `sectionId = startSec` collides** for sections sharing a start second.
- **L2 — `<sec>.jpg` filename ignores section identity** → boundary-overlap sharing/overwrite. Bucket by sectionId if it matters.
- **L3 — `.cache/` gitignore vs committed assets** — resolve in spec (assets committed; `.cache/` ignored), not an "open risk."
- **L4 — yt-dlp/ffmpeg availability/version** unaddressed; missing binary should route to text-only fallback, not 500.

---

## Disposition (author)

- **B1, B2, H1–H7, M2–M6, L1–L4:** addressed by spec revision (commit following this review).
- **B3, B4, M1:** cannot be resolved by static analysis — converted into a **mandatory Task 0 verification spike** with an explicit decision gate (clipping confirmed → proceed with cost model; clipping unconfirmable → SDK migration to `@google/genai` or re-evaluate feature value). The spike's measured `usageMetadata` token count replaces the estimated cost figures before any further implementation.
