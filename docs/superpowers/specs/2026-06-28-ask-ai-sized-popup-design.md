# Ask-AI: Sized Popup Window (instead of a full tab)

**Date:** 2026-06-28
**Status:** Design — approved in conversation ("spec and build the sized popup").
**Component:** `lib/html-doc/render-dig-deeper.ts` (the `askAiScript` inline launcher only).
**Version impact:** none — render-only, no `DIG_GENERATOR_VERSION` bump.

## Problem
The Ask-AI launcher opens Gemini in a **full new tab** (`window.open(u,'_blank','noopener,noreferrer')`). The user wants Gemini to open as a **smaller, resizable, closable window positioned beside the document**, so they can read the doc and chat side-by-side — using their **gemini.google.com subscription** (history, login), not a paid API.

## Why a popup satisfies all constraints
A `window.open` popup is a **top-level browsing context** (a real browser window), not an embedded frame. It loads the actual gemini.google.com with the user's existing Google session → **subscription preserved**, no `X-Frame-Options`/`frame-ancestors` wall (that only blocks iframes). The user resizes/moves/closes it natively; it scrolls independently. Zero API cost. This is the only option that delivers whole-video grounding + subscription + side-by-side + independent scroll together (see the cost analysis that ruled out the docked API pane: ~$35–140/mo vs the flat $20 subscription).

## Design
Change **only** the `window.open` call inside `askAiScript`. Everything else (clipboard copy, `#_dg-ai-toast` confirmation, the `.ask-ai` links, `data-ai-prompt`/`data-ai-url`) is unchanged.

New launcher behavior (ES5-plain inline JS):
- Compute a right-side popup from the screen work area:
  - `w = max(420, round(screen.availWidth * 0.42))` (≈ right 42%, min 420px usable)
  - `h = screen.availHeight || 800`
  - `left = screen.availWidth - w`, `top = 0`
  - features = `'popup=1,width='+w+',height='+h+',left='+left+',top='+top`
- `var win = window.open(u, '_blank', features);`
- Best-effort sever the back-reference: `try { if (win) win.opener = null; } catch (e) {}` (cross-origin may throw → ignored).
- If `win` is null (popup blocked), no-op: the prompt is already on the clipboard and the toast already showed, so the user can paste into a Gemini they open manually. (The call is click-initiated, so blocking is rare.)

### Why drop `noopener`/`noreferrer`
`noreferrer` implies `noopener`, and with `noopener` `window.open` (a) returns `null` even on success (so we can't get the handle to sever the opener or detect a block) and (b) is treated by some browsers as "just open a window," which can **ignore the size/position features** — defeating the whole feature. So we open **without** those flags (reliable sizing + a usable handle) and sever `window.opener` manually.

**Security assessment (acceptable):** dropping `noopener` means the opened Gemini window briefly holds `window.opener` → the localhost doc, and Gemini receives a `localhost` referrer. The destination is Gemini (trusted), and the dig-deeper doc is a static page with **no sensitive state, no auth, no forms** to attack via reverse-tabnabbing. The `win.opener = null` post-open sever removes the reference wherever the browser allows it. Net risk: negligible. Documented inline.

## Testing
- **jest** (`render-dig-deeper.test.ts`): `askAiScript` contains the sized-popup logic — assert the rendered HTML includes `screen.availWidth` and `width=` and `win.opener` (the sever). The existing `closest('.ask-ai')` / clipboard / toast assertions stay green.
- **Playwright** (`dig-deeper.spec.ts`):
  - **A3 (new):** stub `window.open` to capture its `features` argument; click an `.ask-ai`; assert `window.open` was called with the gemini url AND a features string containing `width=` and `height=` (proves the launcher requests a sized popup, not a plain tab). The actual OS window sizing is browser behavior and out of scope to assert.
  - **A1/A2 unchanged:** they record only the URL arg (extra `features` arg is ignored), so they keep passing.

## Scope
**In:** sized-popup `window.open` in `askAiScript` + opener sever + tests.
**Out:** docked in-page pane (ruled out: can't use subscription, $35–140/mo API); triggering Chrome split view (no web API); auto-filling the prompt (needs a browser extension; clipboard copy already covers it).

## Risks
1. **A browser ignores popup sizing** (rare without `noopener`) → Gemini opens as a normal window/tab; still functional, still subscription. Acceptable degradation.
2. **Popup blocked** → no-op; prompt already copied. Click-initiated, so rare.
3. **`win.opener = null` throws cross-origin** → caught; sized popup still opens. The residual opener reference is the negligible risk assessed above.
