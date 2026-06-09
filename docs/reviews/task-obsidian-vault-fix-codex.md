# Codex Adversarial Review — Obsidian vault link fix

**Date:** 2026-06-08
**Model:** gpt-5.5 (`scripts/codex-frontier-model.py`)
**Mode:** `--fresh`
**Scope:** working-tree diff of `components/VideoMenu.tsx` + `tests/components/VideoRow.test.tsx`

## Verdict: not blocking.

## Findings

**Medium — Windows paths produce a bogus vault name.**
`obsidianHref()` normalizes only `/` (line 23) and uses `out.startsWith(`${base}/`)` (line 25). On
Windows, folders arrive with `\` separators; the check fails and `split('/')` returns the whole
raw path as the vault. **Disposition: out of scope** — this is a local macOS tool (darwin); all
data paths are POSIX. Not handled by design.

**Low — Empty `outputFolder` produces `vault=`.**
`base='' && out=''` → `rel=''`, `segments=[]`, vault falls through to `''`. Likely unreachable with
real data; no guard, not covered by tests. **Disposition:** added a non-empty-folder invariant
comment; behavior unchanged (link wouldn't have worked under old logic either).

**Low — Adversarial prefix-boundary case untested.**
Code correctly uses `${base}/` to avoid the `base=/a/data` vs `output=/a/data-2/raw` false match;
the look-alike variant just wasn't asserted. **Disposition:** added a regression test for it.

## What was NOT found (explicitly cleared)

- No double-encoding or missing-encoding issue — `encodeURIComponent` correctly handles `/` in the file path.
- No silent behavior change for existing flat-layout tests/e2e — fallback returns `basename(outputFolder)` as before.
- Forward-compat with the planned `<base>/<slug>/raw` layout is clean: `vault=<slug>`, `file=raw/<note>`.
- No deep-dive / `null deepDiveMd` test gap.

## Disposition

No Blocking/High findings. Two Lows hardened (prefix-boundary test + invariant comment); Medium
(Windows) intentionally deferred as out of scope for a macOS-local tool.
