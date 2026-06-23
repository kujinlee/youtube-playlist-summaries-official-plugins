# Adversarial Plan Review — deepdive-h3-timestamps

**NOTE: Codex at usage limit (until Jul 18 2026); Claude (opus) adversarial review per docs/plugins.md fallback.**

Verdict: **needs-rework** → 2 Blocking (test defects) + 1 Medium applied. The reviewer traced `renderSubsections` + all 7 new tests against real markdown-it (`html:false`) output and confirmed the render logic produces the expected strings **byte-for-byte**; only two test-level issues fail the suite.

## Applied
- **B1 — false-failing negative assertion.** The "no-▶ subsection" test's `not.toContain('class="ts" href="…&t=0s"…(0:00')` is an exact PREFIX of the fixture's own H2 ts link (the H2 ▶ is at `t=0s`, label `(0:00–0:30)`) → the assertion throws even though the H3 is correctly link-free. → Dropped that line; the `toContain('<h3>Plain Sub</h3>')` already proves the H3 has no trailing `.ts`.
- **B2 — version bump breaks `VideoMenu.test.tsx`.** `VideoMenu.tsx:80` marks a doc stale via `isOlder(deepDiveVersion ?? {1,0}, CURRENT_DEEP_DIVE_VERSION)`. After `{2,1}→{2,2}`, the test's `{2,1}` fixture becomes stale → renders a `<button>` instead of a `<a>` → `getByRole('link', {name:/Deep Dive doc/i})` throws. → Plan now updates `tests/components/VideoMenu.test.tsx` `deepDiveVersion: {2,1}` → `{2,2}` (line ~34 is the link test that breaks; lines ~51 busy / ~67 count survive but bump all three for consistency).
- **M1 — explicit grep step** added to Step 6: `grep -rn "minor: 1" tests/` and reconcile each hit (feeds `CURRENT_DEEP_DIVE_VERSION` → bump; local literal passed as `current` arg → leave).

## Verified-correct (reviewer, by executed trace — do not re-litigate)
- Fold test `<h3>Sub A <a class="ts" href="…&amp;t=36s" …>(0:36–1:42)</a></h3>` matches byte-for-byte (`renderInline('Sub A')==='Sub A'`; `esc` `&`→`&amp;`; en-dash untouched); `not.toContain('▶')` holds (both ▶ consumed); label appears once.
- Bold (`<strong>`), fenced-`###`-survives-in-`<pre><code>`, `###x`→prose, malformed-▶-consumed, empty-preH3 (no `lead`) — all traced and pass.
- Existing `section restructure` tests (`### Detail` no-▶) still pass through `renderSubsections` (`<h3>Detail</h3>` + `<li>point one</li>`, no `▶`); no whitespace regression (`.toContain` insensitive to the single-`\n` join boundary).
- TS clean (`tsAnchor`/`renderSubsections` types match `extractTimestamp`'s return; `esc`/`md` in scope).
- E2E `{2,0}` fixtures unaffected (`isOlder({2,0},{2,2})` still `true`, same branch); `ensure.test.ts` `{2,1}` + `version.test.ts:16` are explicit `current`-arg literals, not the constant → out of scope (correctly).
- L1 (cosmetic): `version.test.ts:16`'s `{2,1}` is intentionally NOT bumped (tests `needsRegenerate` semantics). L2: "byte-identical" wording for ▶-less H3 is functionally true; trivial join-whitespace differs, no test asserts it.
