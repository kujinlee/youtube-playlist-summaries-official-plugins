# Stage 1 Dual Review — Detect (detector + warn + audit)

**Branch:** `fix/summary-truncation-guard` · **Date:** 2026-06-30 · No Blocking/Critical. All findings addressed.

## Claude review — no Critical; 2 Important (both fixed)
1. **Detector called on two artifacts** (pipeline = raw body; audit = full on-disk file w/ frontmatter). Works today but contract said "body". → docstring updated to "document (incl. frontmatter)" + added a full-file test (frontmatter + H1 + meta + callout, complete & truncated).
2. **`fenceOpenAtEnd` tolerated leading whitespace** (indented ``` mis-counted as closer). → fence opener/closer split: opener `^(`{3,}|~{3,})` (lang tag ok), closer `FENCE_LINE` (bare only); no leading-whitespace tolerance.
- Confirmed clean: detector fingerprints, non-blocking integration, serial-from-index, archived fallback, never-throws, script exit-0, test adequacy.

## Codex review — no Blocking; 1 HIGH + 2 MEDIUM + 2 LOW (all fixed)
- **HIGH — script could throw/exit-nonzero before reporting.** `auditSummaries(folder)` uncaught; no-folder exited 1. → script wraps the run in try/catch, prints diagnostics to stderr, **exits 0 always** (incl. no-folder).
- **MEDIUM — path traversal via index-controlled `summaryMd`.** `../secret.md` resolved outside the corpus. → containment check (resolve within root; validate raw summaryMd BEFORE the archived join so `../x` can't collapse in-root); unsafe entry → `unsafe path (outside corpus)` suspect. Mirrors `archive.ts`.
- **MEDIUM — fence closer with trailing text** (`` ```notacloser ``) mis-counted as a valid closer. → closer must match `FENCE_LINE` (marker + spaces only). Same fix as Claude #2.
- **LOW — pipeline test under-proved "still writes".** → now asserts `trunc.md` on disk contains the suspicious body.
- **LOW — missing edge-case tests.** → added invalid-fence-closer, full-file-with-frontmatter, path-traversal tests.
- Confirmed clean: bare-▶ ending flagged; padDividers no false trailing-HR; no-op impl would fail tests.

## Verification
tsc clean; 1361 jest green. Smoke audit on agentic-ai vault: doc-236 not flagged; 4 archived false-positives gone; found+fixed doc-49 truncation; remaining suspect = 1 real orphan (166) surfaced for user decision.
