# PR1 (dig captions) Task 1 — Codex Adversarial Review

**Diff:** 366228b..eeb9bf6. Model: frontier (--fresh). **Codex available again (no fallback this run).**
**Outcome:** 6/6 checks PASS — 0 Blocking/High/Medium/Low.

| Check | Verdict |
|---|---|
| 1 XSS/escape | PASS — only figcaption build is `esc(altAttr)`; empty alt → no figcaption; img alt also escaped. |
| 2 missing-asset/external paths | PASS — both return before the figure/caption path; unchanged. |
| 3 non-vacuous negative assertions | PASS — `not.toContain('<figcaption')` / `'<figure class="dig-slide-fig"'` target literal tags, not CSS text; catch real regressions. |
| 4 selector-rename completeness / zoom | PASS — no surviving `figure.dig-slide-crop`; `class="dig-slide-crop"` substring + `.dig-slide-crop` class survive; zoom keys off `img.dig-slide`. |
| 5 dead CSS / centering | PASS — no dead old selector; margins on `.dig-slide-fig`, children `margin:0 auto`. |
| 6 render-only | PASS — generate.ts absent from diff; no version bump. |

No fixes required from Codex. (Claude review minors — restore security comment, narrow coverage — tracked for final triage in `task-dig-captions-t1-review.md`.)
