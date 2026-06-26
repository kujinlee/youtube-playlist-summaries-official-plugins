# Claude Code Review — Serial-Prefix Invariant + Arch-Guard

Branch: `feat/serial-invariant-guards`
Reviewer: Claude (general-purpose subagent)
Date: 2026-06-26

## Strengths
- `checkSerialInvariant` reuses `applySerial` as single source of prefix truth; prefix-before-disk ordering correct (behavior #9).
- All skip/branch conditions sound: `serial == null`, falsy-field skip, short-circuit else.
- `exists` dependency-injected → hermetic unit test.
- Tests map 1:1 to behaviors table (all rows covered, incl. #9 and every PATH_FIELD).
- Arch-guard RED-ness verified empirically (injecting stripper fails + names file, revert clean).
- `recursive: true` reliable on Node v20.18.2; found all 22 route.ts.
- `PATH_FIELDS` export with doc comment = clean single source of truth.

## Issues

### Important
1. **Arch-guard matches comments → false positives** (`tests/api/videos-arch-guard.test.ts:19-22`).
   `\bstripSerialPrefix\b` runs against raw file text, so a *comment* mentioning the symbol trips
   the guard (verified: `// stripSerialPrefix test injection` in route.ts fails the test). Latent
   maintenance hazard — a future explanatory comment could break CI and incentivize deleting the
   guard. **Fix:** match call/import shapes — `/\bstripSerialPrefix\s*\(/` and
   `/import[^;]*\bstripSerialPrefix\b/` — or strip comments before matching.

### Minor
2. `serial` of 0: schema is `int().positive()` so never 0; `serial == null` correctly doesn't skip 0. Safe by schema, no action.
3. Invariant verifies existence, not path-containment (caller's job, out of scope). JSDoc slightly oversells "resolve on disk" — note containment is the resolver's job.
4. Unicode basenames handled (applySerial only concatenates, never compares across NFC/NFD) but untested. Optional one-line test.
5. `it.each` `_label`/`_why` unused noise — could use object-form `it.each`. Cosmetic.

## Assessment
**Fix-first (one Important item)** — tighten arch-guard to call/import shapes before merge.
