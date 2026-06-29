# Plan Adversarial Review — Dig Slide Captions (PR 1)

**Plan:** docs/superpowers/plans/2026-06-29-dig-slide-captions.md
**⚠️ Codex gap:** Codex CLI was at its usage limit (resets ~Jul 28) → per the project fallback policy this was run as a **Claude adversarial review** (fresh subagent, full file access, adversarial mandate). Re-attempt a Codex pass before merge if access returns.

**Outcome:** 5 Blocking + several High, all about the same root cause — the selector-rename Step 6 was under-specified (vague paraphrases, missed comment/title sites, brittle whole-block assertion). All addressed in the plan; no architectural changes.

## Findings + resolution
| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | Blocking | `crop.test.ts:43` regex `/\.dg figure\.dig-slide-crop\{…width:min\(100%,540px\)/` breaks after rename. | Step 6 now gives exact regex → `/\.dg \.dig-slide-crop\{[^}]*width:min\(100%,540px\)/`. |
| 2 | Blocking | `crop.test.ts:35-36` `<figure[^>]*style="…width:`/`capPx` guards become vacuous (figure no longer carries style; crop is now a div). | Step 6: widen guards to `<(figure\|div)[^>]*style="…` so they still catch an inline width/capPx on the crop div. |
| 3 | Blocking | `size.test.ts:50` exact whole-print-block `toContain` breaks on rename AND again when Task 2 adds `.dg-caps-toggle`. | Step 6: replace the brittle whole-block match with order-independent per-declaration `toContain` substrings (survives Task 2). |
| 4 | Blocking | `dig-slide-size.spec.ts` locator :133 + comments :23/:139 reference `figure.dig-slide-crop`. | Step 6: exact locator → `.dig-slide-crop`; comment text updated. |
| 5 | Blocking | `dig-slide-crop.spec.ts` locators :110/:122, test title :109, comments :105/:118/:139 reference `figure.dig-slide-crop`. | Step 6: exact locators → `.dig-slide-crop` / `.dig-slide-crop img.dig-slide`; title + comments updated. `:141` `.closest('.dig-slide-crop')` unchanged (class persists). |
| 6 | High | `.dg img.dig-slide` border-radius is inherited from `STRUCTURAL_CSS .dg img{border-radius:6px}`; intent not stated. | Step 4: note border-radius is intentionally inherited (unchanged from current behavior). |
| 7 | High | `captionsScript` initial `apply(read(),false)` is essential (head script set only the class, not aria-pressed/button text) — undocumented. | Step 6 (Task 2): comment added explaining the sync dependency. |
| 8 | Low | Consecutive-slide zoom requires two clicks (click closes, then opens). | Task 3 Step 4: brief comment added. |
| 9 | — | `.closest` via feature-detect ternary is ES5-safe. | No action (confirmed). |
| 10 | High | C3 test: `first.hasToggle` dereferences possibly-null `first` → TypeError instead of clean fail. | Task 2 Step 8: add `if(!first) return;` after the not-null assertion. |
| 11,13,14,15 | Med/Low | head-ordering test correct; version policy correct (generate.ts untouched); local var rename + id/class redundancy harmless. | No action (confirmed correct). |
| 12 | Med | No E2E asserting `.dig-cap` visible in print when captions on (only CSS-string unit assertion). | Deferred as a known minor (noted in plan); unit CSS assertion + toggle E2E cover the logic. |

**Unchanged-but-verified assertions** (pass as-is after rename, documented in Step 6 so the implementer doesn't "fix" them): `crop.test.ts:27/:49/:58` (`class="dig-slide-crop"` substring survives figure→div), `:65-67` (`.dig-slide-crop>img` regex has no `figure` prefix), `dig-slide-crop.spec.ts:141` (`.dig-slide-crop` class persists).
