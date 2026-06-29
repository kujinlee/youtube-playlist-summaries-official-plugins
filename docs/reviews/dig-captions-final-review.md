# PR1 (dig slide captions) — Final Whole-Branch Review (opus)

**Scope:** 366228b..acb0ac7 (3 task commits). **Verdict: READY TO MERGE.** 0 Critical/Important/new-Minor. Tests: jest 1505/1505, E2E C1–C6 6/6, tsc clean (pdf.test.ts = known pre-existing parallel-load flake, unrelated).

## Seam verification — all PASS
1. figure/figcaption + crop rename — every inlined slide `<figure class="dig-slide-fig">`; cropped `div.dig-slide-crop>img`, uncropped bare img; figcaption only when alt truthy; missing-asset span + external img unchanged; NO surviving `figure.dig-slide-crop` selector in lib/; `.dig-slide-crop` class + zoom `.dig-slide` hook resolve.
2. caption↔toggle — `.dg-hide-caps .dig-cap{display:none}`; default shown; pre-paint adds class only when 'off'; fail-safe shown on blocked storage.
3. toggle↔zoom — zoom open reads `dg-hide-caps` at click time (pre-zoom toggle honored). `#_dg-zoom-cap` uses class `dg-zoom-cap` (not `dig-cap`), so visibility is JS-inline-driven — correct & consistent; C6 covers it.
4. esc()/textContent — server figcaption `esc(altAttr)`; zoom `cap.textContent` from decoded DOM text; no injection path.
5. print — hides `.dg-size` + `.dg-caps-toggle`, resets slide size; `dg-hide-caps` media-independent so captions follow toggle in print.
6. render-only — generate.ts/package.json/lock untouched; DIG_GENERATOR_VERSION stays 8; no new dep.

Independently verified: zoom img created in JS has NO `.dig-slide` class (click-on-zoom-img → close, not re-open).

## Minor triage (reviewer: all DEFER, none merge-blocking)
| Item | Reviewer verdict | Controller action |
|---|---|---|
| T1 size.test print assertions unscoped toContain | DEFER — backstopped by E2E S7 computed-width ≤541 | DEFER (kept) |
| T1 trimmed SECURITY-CRITICAL containment comment | DEFER — guard code intact | **FIX (cheap, restore safety rationale)** |
| T1 cropMap=undefined path implicit | DEFER — captions.test.ts:31 exercises default | DEFER (kept) |
| T2 C4 may pass vacuously | DEFER — pageerror assert + invariant hold | **FIX (non-vacuous hit-counter, mirrors size S6)** |
| T3 .dg-zoom-cap no initial display:none | DEFER — no runtime impact | **FIX (1-token explicitness)** |

Minimal fix wave applied for the 3 genuinely-valuable cheap items; the 2 backstopped/covered items left deferred.

## Assessment
Clean render-only change; all seams verified against live code; crop rename fully propagated; no injection path. Ready to merge.
