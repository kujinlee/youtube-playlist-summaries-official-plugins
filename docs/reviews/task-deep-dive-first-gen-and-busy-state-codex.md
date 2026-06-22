# Adversarial Review — Deep-Dive First-Gen + Busy-State Fixes (Codex slot)

**Branch:** `fix/deep-dive-first-gen-and-busy-state`
**Date:** 2026-06-21

> **Codex fallback:** The Codex CLI hit its usage limit (resets 2026-07-18). Per the project's
> Codex-unavailable fallback policy, a rigorous **Claude adversarial review** was run in its place
> (fresh subagent, full file access, adversarial mandate). This satisfies the gate. **Re-attempt the
> Codex-specific pass before merge if access returns.**

## Findings

### Blocking
None.

### High
**Path traversal via unsanitized `deepDiveMd` in `runDeepDiveHtml` (defense-in-depth gap).**
`md` (the new override OR the index-sourced `video.deepDiveMd`) was joined into `path.join(outputFolder, md)` and `htmls/${base}.html` with no containment check, asymmetric with the html serve route which validates via `HTML_REL_RE` + resolved-path containment. Not a direct external-input exploit (the value is server-derived; an attacker would need write access to the index), but a corrupted/hand-edited index with `summaryMd: "../../etc/payload.md"` would let reads/writes escape `outputFolder`.

**→ Addressed.** Added `assertSafeDeepDiveMd(outputFolder, md)` in `lib/html-doc/generate-deep-dive.ts`: a Unicode-aware bare-`.md`-filename regex (no slashes → no `..`) plus a `path.resolve` containment backstop, mirroring the serve route. Applied to **both** `runDeepDiveHtml` (override + index) and `reRenderDeepDiveHtml` (index), closing the asymmetry. Two tests added (traversal override rejected; traversal-from-corrupted-index rejected).

### Medium
1. **Open error bar can be silently replaced** if the user starts a job on a different video while an error bar is open (`onError` clears ⏳ but leaves `deepDive`/`htmlJob` set; a new job replaces the bar without `onClose`/`onError` for the old one). Pre-existing (state replacement was always possible); this fix lowers the visual barrier slightly by clearing the ⏳. **Decision: accept** — not a correctness/data issue; documented by the single-active-job comment added at the `busyVideoId` declaration.
2. **`setBusyVideoId` after `setDeepDive`/`setHtmlJob`** relies on React 18 automatic batching. **Decision: accept** — correct under React 18 default; low risk.
3. **`!video.deepDiveHtml` branch lacks a dedicated no-override test.** Already covered: `ensure.test.ts` test #4 ("md present, current version, no deepDiveHtml → runDeepDiveHtml only") asserts `toHaveBeenCalledWith(VIDEO_ID, outputFolder)` (no third arg). **No action needed.**

### Low / Nits
- Confirmed `doneTimer` is cleared on unmount in both status bars (no leak).
- Inline `onError={() => setBusyVideoId(null)}` creates a new ref each render but is stored in `onErrorRef` (not a `useEffect` dep) → no re-subscribe, no stale closure. Consistent with the existing `onClose` style.
- `reRenderDeepDiveHtml` does wasted work before the missing-`.md` fallback — pre-existing, out of scope.

### Cross-area
- Traversal payload would not be caught by the functional override test (which uses a safe filename) — addressed by the dedicated guard tests above.
- Lazy serve route still calls `runDeepDiveHtml` with no override → falls back to the index + its own route-level 404 guard. No regression.

## Verdict
No Blocking issues. The single High finding (defense-in-depth path containment) is addressed. 918/918 jest green, clean `tsc`.
