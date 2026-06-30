# Dig sub-heading gold style — Codex adversarial review

**Model:** gpt-5.5 (Codex online, no fallback). **Branch:** `feat/dig-subheading-gold-style`. Duration ~96s.
**Scope:** render-only `.dg .dug h3` change (`.95rem→1.12rem`, `var(--ink)→var(--gold)`, letter-spacing `.02em→.01em`) + strengthened test.

**Verdict: Clean. No findings at any severity (Blocking/High/Medium/Low all None).**

## Verified (all PASS)
- **Palette collision** — `--gold` is shared with `.lead` (:36) and equals `--link` value; NOT a defect: `.dg .dug h3` differs by selector context, `font-size:1.12rem`, `font-weight:700`, margins. (Links are inline/hover-underlined; sub-heading is block bold larger.)
- **Print legibility** — print reapplies light palette for all theme states (theme.ts:71); light gold `#b07700` on card `#fbf9f6`. No print rule nullifies `--gold`. Adequate contrast.
- **Specificity** — `.dg .dug h3` (0,2,1) more specific than `.dg h3` (0,1,1); no later `h3` color override.
- **Test quality** — property assertions separate (not order-coupled via `[^}]*`); structural `.dug` containment asserted; no gaps.
- **Orphan/figcaption regression** — orphan body still wrapped in `.dug` (:318, tested); `figcaption`/`.dig-cap` on separate selector path, untouched.

**Codex note:** `git diff master..HEAD` was empty during the run (changes uncommitted at that moment) → Codex read working-tree files directly; all five checklist items verified against actual source.

## Cross-check with Claude review
Both reviews independently reached the same conclusion (0 issues) and verified the same five seams. No discrepancy.
