# Adversarial Review — Serial-Prefix Invariant + Arch-Guard

Branch: `feat/serial-invariant-guards`
Date: 2026-06-26

> **Codex gap:** Codex was at its usage limit; per the fallback policy a **Claude adversarial
> review** was substituted (fresh subagent, full file access, adversarial mandate). The
> Codex-specific pass can be re-attempted before merge if access returns.

## Verdict: pass-with-reservations

Core invariant logic correct: `applySerial`-based prefix check is idempotent and folds
wrong-serial into a prefix violation; prefix-before-missing ordering correct; `== null` skip
catches null/undefined; `!value` skips falsy fields.

## Findings + resolution

| # | Sev | Finding | Resolution |
|---|---|---|---|
| H1 | High | No structural test that all 8 PATH_FIELDS are reachable | **Fixed** — added "reaches all eight PATH_FIELDS when every one is dirty" test (8 violations) |
| H2a | High | Arch-guard regex matches comments/strings → false positives | **Fixed** — match call `sym(` + import shapes only; verified prose comment no longer trips |
| H2b | High | `readdirSync({recursive:true}) as string[]` cast / Node ver | **No change** — Node v20.18.2 (≥18.17), cast safe; documented |
| M1 | Med | `serialNumber = 0` untested | **Fixed** — added test; 0 processed faithfully as `000_` (validity is schema's job) |
| M2 | Med | `exists` rooting is caller's responsibility, unenforced | **Doc'd** — JSDoc now states caller owns rooting + existence-not-containment; factory deferred (no caller yet) |
| M3 | Med | A3 RED-check is manual, not auto-tested | **Doc'd** — note added in test file + plan moved A3 to Manual Verification |
| M4 | Med | `vid[field] as ...` bypasses keyof checking | **Fixed** — added compile-time `PathField extends keyof Video` assertion (tsc-enforced) |
| L1/L2 | Low | Type widening / it.each label noise | L2 resolved in arch-guard rewrite; L1 no action |

## Cross-check with Claude review
Both reviews independently flagged the comment-matching false positive (Claude Important #1 ≡
Codex H2a) — fixed once. Claude's containment-JSDoc note ≡ Codex M2 — folded into the JSDoc edit.

## Post-fix verification
- 16/16 invariant+arch-guard tests pass; full suite 1368 pass; `tsc --noEmit` exit 0.
- Arch-guard RED re-proven on hardened matcher: prose comment passes, real call fails+names file, revert green.
