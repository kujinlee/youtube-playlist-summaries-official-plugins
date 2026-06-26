# Dig Deeper: Code/Config Slides as Images (not transcribed fences)

**Date:** 2026-06-26
**Status:** Design — awaiting user review
**Supersedes the code-handling half of:** `2026-06-25-dig-slide-selectivity-design.md` (PR #28)

---

## Problem

PR #28 (dig-slide-selectivity) instructed Gemini to **transcribe** any slide showing a
command, terminal/CLI, code, or config into a fenced code block instead of screenshotting it,
on the theory that transcribed code is "sharper, copyable, and themed."

In practice the first real code slide (the OKF section of video `P_E29-87THI`, section 149)
rendered as a thin, incomplete fragment:

```
---
type: metric
```

This reads as neither a proper code block nor an image — a bare `---` with no closing fence —
and the user perceived it as a broken image. Investigation confirmed:

- The companion `.md` and the server render are **correct** — it is a real `<pre><code>` block
  with **zero** `<img>` tags. There is no rendering bug.
- Across **all** dig docs there is exactly **one** transcribed code block (n=1), so the
  transcription path has essentially no track record.
- Transcription reliability is unprovable at n=1, and Gemini samples video coarsely (~1 fps,
  reduced resolution), so dense on-screen code can be under-read.

**Decision:** when a slide's value is the on-screen code/config itself, show the **captured
slide image** (authoritative, 720p) rather than a verbatim transcription that may be wrong or
incomplete. Visual fidelity wins for this content class.

---

## Why the image is additive, not redundant (prose-grounds-meaning / image-preserves-fidelity)

The dig request sends Gemini the **actual video clip** (`file_uri` + `video_metadata` temporal
clip, `mime_type: video/mp4`) **together with** the indexed transcript, and instructs it to
elaborate "grounded in the transcript and video content provided." So:

- **The prose already carries the slide's *meaning*.** Gemini watches the slide and explains it
  in words (e.g., the OKF prose already describes the required `type` frontmatter field — read
  off the slide). The explanation does not depend on a transcription block.
- **The `[[SLIDE:]]` token is not a second understanding pass.** It only marks a timestamp; the
  screenshot is grabbed separately by ffmpeg at 720p. The image is a faithful picture of the
  same slide Gemini already understood.
- **The image preserves *fidelity* the prose can't guarantee.** Because Gemini samples video
  coarsely while the ffmpeg grab is a sharp 720p frame, the screenshot can preserve fine detail
  (every line of a config block, exact symbols) that Gemini's coarse sampling may under-read and
  therefore omit from prose. Gemini also elaborates *salient* content, not exhaustively.

Net: prose explains, image preserves fidelity, and we drop the unreliable middle layer
(verbatim transcription). The two are complementary by construction — the reader gets Gemini's
interpretation in words plus the ground-truth pixels to check it against.

---

## Scope of change

The change is almost entirely in the **generation prompt** (`lib/dig/generate.ts`). The capture
pipeline (`lib/dig/slides.ts`, yt-dlp + ffmpeg), token parsing (`lib/dig/slide-tokens.ts`),
companion storage (`lib/dig/companion-doc.ts`), and rendering (`lib/html-doc/render-dig-deeper.ts`,
base64 inline + missing-slide placeholder) **already handle images and need no change.**

### Policy (new prompt wording)

1. **Remove** the rule: *"If the clip shows a command, terminal/CLI, code, or config, transcribe
   it into a fenced code block … do not screenshot it."*
2. **Extend** the `[[SLIDE:]]` trigger list to include **code / terminal / CLI / config slides
   whose on-screen text carries meaning** — treated like any other genuine visual.
3. **Still excluded** (unchanged): title cards, bullet lists, quotes, tips, speaker-on-camera.
4. **No fabrication:** emit `[[SLIDE:]]` only when the code/config is **actually shown on a
   slide**. If code is merely spoken or described with no on-screen slide, it stays as plain
   prose — no fence, no image.
5. **Caption** for a code/config slide is a short human-readable description (e.g.,
   *"OKF frontmatter: the required `type` field"*), not a verbatim transcription.
6. The existing **≤3 `[[SLIDE:]]` per section** cap is unchanged; code/config slides count
   toward the same budget. "Most sections need zero slides" guidance stays.

### Result

No code-fence transcription path remains in dig output. What was the `type: metric` fence
becomes the actual slide screenshot for the OKF section after re-dig.

---

## Versioning & migration

- **Bump `DIG_GENERATOR_VERSION` 2 → 3** (`lib/dig/generate.ts:13`). This is the entire migration
  trigger.
- Every existing dug section (stamped `genVersion: 2`) immediately computes `isStale` against the
  new constant and renders the PR #28 `↻ outdated` `.dig-refresh` control.
- Re-dig is **lazy / on-demand**: the user clicks `↻ outdated` (or "expand all", which PR #28
  wired to refresh stale sections); the section regenerates under the new prompt and the
  code/config slide returns as a screenshot. **No bulk regeneration, no Gemini calls on page
  load.**
- The OKF doc specifically: one re-dig of section 149 → the `P_E29-87THI` clip is captured → the
  `type: metric` fence is replaced by the slide image.
- **No data migration script, no file rewrites** — the version bump plus the existing
  stale-refresh UI does it all.

---

## Testing

| Layer | What changes |
|---|---|
| **Prompt content** | Assert the built prompt **no longer** instructs "transcribe code … do not screenshot", and **does** include code/config in the `[[SLIDE:]]` trigger list. This is the contract for the policy flip. Pure string builder → straightforward unit test, written first (RED). |
| **Selectivity tests** (PR #28: `dig/slide-tokens`, `dig/companion-doc`) | Update any fixtures/assertions that encoded "code → fence" so they reflect "code → slide". |
| **Version stamp / staleness** | Existing test asserting the route stamps `DIG_GENERATOR_VERSION` stays green; adjust/add a staleness test so `genVersion: 2` sections compute `isStale` against `3`. |
| **Capture / render** | Unchanged — `slides.ts` and `render-dig-deeper.ts` already handle images; existing tests cover them. |

**Honest limit:** the policy is enforced by *prompt wording*. Gemini is probabilistic, so
"code slide → screenshot" is a strong instruction, not a guarantee. Tests verify the *prompt*
says the right thing; they cannot verify Gemini always obeys. **Acceptance** is verified by
re-digging the OKF section and confirming the slide image appears in place of the fence.

---

## Out of scope

- Reliability *detection* / model self-confidence (the chosen approach — image-first — removes the
  need for it).
- Keeping transcription as a secondary copyable element (explicitly rejected: image-only).
- Per-content-type slide budgets (keep the unified ≤3 cap).
- Bulk regeneration of all existing dug sections (lazy re-dig only).

---

## Enumerated Behaviors (for the implementation plan)

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Code/config slide → image | clip shows on-screen code/config whose text carries meaning | prompt yields a `[[SLIDE:]]` token (no fence); capture → image |
| 2 | No fabricated slide | code only spoken/described, not on a slide | plain prose, no fence, no `[[SLIDE:]]` |
| 3 | Genuine graphic → image | diagram/chart/architecture/UI | unchanged — `[[SLIDE:]]` |
| 4 | Non-visual text excluded | title card, bullet list, quote, tip, speaker | no `[[SLIDE:]]`, no fence |
| 5 | Slide budget | section with many code/visual slides | ≤3 `[[SLIDE:]]` total |
| 6 | Existing dug section stale | `genVersion: 2` section loaded after bump | renders `↻ outdated`; re-dig regenerates under v3 |
| 7 | Prompt no longer transcribes code | build prompt | string excludes "transcribe … do not screenshot"; includes code/config in `[[SLIDE:]]` list |
