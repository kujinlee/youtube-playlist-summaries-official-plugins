# Plan Adversarial Review — Dig Section Sub-Headings (PR 2)

**Plan:** docs/superpowers/plans/2026-06-29-dig-section-subheadings.md. Model: frontier (--fresh, Codex online). **No Blocking/High.** AFK mode: this adversarial review substitutes for the user approval gate.

## Findings + resolution
| Sev | Finding | Resolution |
|---|---|---|
| Medium (M1) | Task 1 verification too narrow — version bump also hits merge-staleness (`dig-merge.ts:104,154`), route-stamping (`route.ts:166`), companion-doc paths. They import the constant (auto-track) but aren't run before the Task 1 commit. | Plan Task 1 Step 5 broadened to run `dig-merge.test.ts dig-post.test.ts companion-doc.test.ts` after the bump. |
| Medium (M2) | First render test checks `<div class="dug">` and `<h3>How it works</h3>` as SEPARATE assertions → doesn't prove the h3 is INSIDE `.dug`. | Plan Task 2 Step 1 tightened to one structural regex `/<div class="dug">[\s\S]*<h3>How it works<\/h3>/`. |
| Low | Korean-safety could be anchored tighter. | Plan Task 1 Step 1 adds an assertion pinning the exact phrase "do NOT switch to English". |

## Confirmed SAFE (no action)
- **Orphan `.dug` visibility (the flagged risk):** orphan section is `<section class="dg-orphans">` (NOT `data-dug="true"`); the only hiding rule is `section[data-dug="true"].show-gist .dug` — a new orphan `.dug` is always visible. SAFE.
- **No hardcoded version-8 sites** beyond `generate.ts:13` (the constant) + `generate.test.ts:191` (the literal test the plan updates). Staleness = `matched.genVersion < DIG_GENERATOR_VERSION`; fresh stamped with the imported constant. Bump intentionally staleifies existing v8 docs; no unintended side effect.
- Backtick escaping `\`###\``/`\`#\``/`\`##\`` syntactically correct.
- Korean contract preserved ("same language as the rest of your response").
- `###` no collision with companion-doc sentinel parsing or rendering (→ `<h3>` inside `.dug`).
- `.dg .dug h3` (0,2,1) beats `.dg h3` (0,1,1); orphan title h3 stays outside `.dug` (not restyled).
- Existing orphan tests don't assert body-outside-`.dug` → wrap is additive.
- Generation/render task split matches spec; no missing task.
