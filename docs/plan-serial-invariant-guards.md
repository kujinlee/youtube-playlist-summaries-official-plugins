# Plan: Serial-Prefix Invariant + Arch-Guard Tests

Follow-up PR closing the regression class behind the serial-prefix-strip bug
(a stripper in `GET /api/videos` removed `NNN_` prefixes from index filename fields).
Turns "discover by inspection" into "caught by CI".

## Deliverables

1. `lib/serial-invariant.ts` — `checkSerialInvariant(videos, exists)` → `SerialViolation[]`
   (the data-shape invariant: serialled ⇒ prefixed + resolves on disk).
2. `tests/lib/serial-invariant.test.ts` — unit behaviors against injected `exists`.
3. `tests/api/videos-arch-guard.test.ts` — source-text guard: no filename stripper
   (`stripSerialPrefix` / `migrateToSlugFilenames`) in any `app/api/**/route.ts` request handler.

## Design notes

- `PATH_FIELDS` (the 8 nullable path fields) already lives in `lib/serial-migrate.ts`.
  Re-export and reuse — single source of truth, no drift.
- Correctness check reuses `applySerial(value, serial)`: if `applySerial(v, s) !== v`
  the field is mis-prefixed (unprefixed OR wrong serial). One helper, no regex duplication.
- `exists` is dependency-injected so the unit test is hermetic (no real disk).
  Callers (script / startup) pass a real `existsSync`-backed resolver rooted at the output folder.
- Invariant is **conditional on serialNumber**: a video with no `serialNumber` is not yet
  serialled, so its bare filenames are legal — skip it entirely.

## Enumerated Behaviors — `checkSerialInvariant(videos, exists)`

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | Clean serialled video | serialNumber=7, summaryMd=`007_x.md`, exists→true | `[]` (no violations) |
| 2 | Unprefixed field | serialNumber=7, summaryMd=`x.md` | 1 violation `{field:summaryMd, reason:'prefix', value:'x.md', expected:'007_x.md'}` |
| 3 | Wrong-serial prefix | serialNumber=7, summaryMd=`002_x.md` | 1 violation `{reason:'prefix', expected:'007_x.md'}` |
| 4 | Prefixed but missing on disk | serialNumber=7, summaryMd=`007_x.md`, exists→false | 1 violation `{reason:'missing', value:'007_x.md'}` |
| 5 | Video without serialNumber | serialNumber=undefined, summaryMd=`x.md` (bare) | `[]` — not yet serialled, bare is legal |
| 6 | Null / absent field | serialNumber=7, summaryMd=null, deepDiveMd undefined | `[]` — nullable fields skipped |
| 7 | Subdirectory path | serialNumber=7, summaryPdf=`pdfs/x.pdf`, exists→true | 1 violation `{reason:'prefix', expected:'pdfs/007_x.pdf'}` (prefix on basename, dir preserved) |
| 8 | Multi-field mix | serialNumber=7: summaryMd=`007_x.md`(ok,exists), deepDiveMd=`x-dd.md`(bare) | 1 violation, only deepDiveMd |
| 9 | Prefix wins over missing | serialNumber=7, summaryMd=`x.md` (bare), exists→false | 1 violation `reason:'prefix'` — fix prefix first, don't disk-check a known-wrong path |
| 10 | Multiple videos | two videos, one clean one dirty | only the dirty video's violation reported |

## Enumerated Behaviors — arch-guard

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| A1 | No stripper in request path | scan every `app/api/**/route.ts` | none **call or import** `stripSerialPrefix` (prose mentions allowed) |
| A2 | No legacy migrator in request path | scan every `app/api/**/route.ts` | none call or import `migrateToSlugFilenames` |

### Manual Verification (not auto-tested)

- **A3 — Guard catches the regression.** During development, inject a real `stripSerialPrefix(...)`
  call (or import) into the videos route → arch-guard fails and names the file; revert → green.
  Also verified: a prose comment mentioning the symbol does **not** trip the guard. Not auto-mutated
  in CI — mutating production source inside a test run is the riskier option.

### Decision: `serialNumber = 0`

Schema is `z.number().int().positive()` so 0 cannot occur. The invariant's skip is `== null` (not
falsiness), so a 0 — if it ever bypassed the schema — is processed faithfully as the `000_` serial,
not treated as "unassigned". Serial *validity* is the schema's responsibility; this invariant only
checks prefix-correctness given whatever serial is present. Documented by an explicit test.

## Out of scope

- Wiring the invariant into a startup assertion or CI corpus scan (separate decision —
  fixture-based jest guard is the deliverable; real-corpus scan belongs in script/startup).
- Folder-unification effort.
