# Codex Adversarial Review — Stage 1 Plan

**Date:** 2026-06-30
**Verdict:** Do not proceed as-is. 2 Blocking + 1 HIGH (plan contradicted its own approved spec). All addressed in plan v2.

## BLOCKING
1. **Audit exit code** — spec says "Exit 0 always (report tool)"; plan Task-3 script had `process.exit(suspects.length>0?1:0)`. → exit 0 always.
2. **Audit serial resolution** — spec says resolve serial from the index record, not filename; plan parsed `NNN_` from filename. → use `v.serialNumber` from the index.

## HIGH
- **Structural-only endings blindly passed** — plan returned `complete:true` for table-row/URL/link endings, but spec says flag them as suspicious low-confidence. → table-row / URL-only / link-only final line → `complete:false, confidence:'low'`. Horizontal-rule and closing-fence remain genuinely complete (doc-236 case).

## MEDIUM (addressed)
- Fence parity too naive (4-backtick block containing ``` line; mixed ```/~~~). → track opener marker + length; closer must match style and be ≥ length.
- Missing fixtures: real link-only assertion; bare-▶-line ending; semicolon / ellipsis / trailing-whitespace / multiple-blank-lines; structural low-confidence assertion. → added.
- Pipeline test too weak (only prefix) → assert reason text + non-blocking (returns normally).
- Audit test too narrow → assert serial-from-index, exit-0, structural low-confidence case.

## INFO (no change)
- `TERMINAL` regex matches the contract (bare `)` excluded; closing quote after punctuation allowed).
- Pipeline insertion point correct (warns on resolved post-timestamp summary).
- Batch-docs covered — batch → `ensureHtmlDoc` → `writeSummaryDoc`, so the warning fires there too. No separate wiring.

## Resolution
Plan v2 fixes both Blocking + the HIGH + the MEDIUM test/fence gaps. AFK: human-approval gate satisfied by this adversarial review.
