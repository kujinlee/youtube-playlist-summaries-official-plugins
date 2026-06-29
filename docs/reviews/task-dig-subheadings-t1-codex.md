# PR2 (dig sub-headings) Task 1 — Codex Adversarial Review

**Diff:** 2dcc9ef..ab4747e. Model: frontier (--fresh, Codex online). **Outcome: 6/6 PASS — 0 findings. Safe to merge.**

1. Korean contract holds — entire-response-Korean instruction intact; new bullet says "same language…(do NOT switch to English)". No conflict.
2. Escaped backticks `\`###\``/`\`#\``/`\`##\`` render literal; no accidental `${}`.
3. **No heading contradiction** — existing line is "no headings for the section TITLE" (not "no headings anywhere"); new bullet scopes to body structure + "(section title rendered separately)" + "do not restate the section title". (This was the controller-flagged risk → cleared.)
4. Version bump consistent — VERSION=9, test toBe(9), v8 history kept + v9 "re-dig to apply"; intentional staleness of v8 digs (`< VERSION`), not a side effect.
5. Prompt-contract tests non-vacuous — assert `###`, sub-heading, long, `never \`#\` or \`##\``, same-language, exact "do NOT switch to English". Deleting the bullet/anchor fails them.
6. Scope clean — only generate.ts + generate.test.ts.

No fixes required. (Claude review Minors — looser `###`/`/###/` regexes — tracked for final triage.)
