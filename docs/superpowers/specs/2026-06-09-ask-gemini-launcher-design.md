# Ask Gemini About This Video — Launcher (Design Spec)

**Date:** 2026-06-09
**Status:** Approved design → ready for implementation plan
**Scope:** Single, self-contained frontend feature. No backend.

---

## Goal

Add a video-row menu item, **"Ask Gemini about this video"**, that reproduces the user's
manual workflow (paste a YouTube URL into Gemini, then chat about the video) with one click:
copy a ready-made, language-aware prompt to the clipboard and open Gemini's web app in a new
tab. The user lands in Gemini's *own* multi-turn chat — which can watch the actual video — and
pastes (or, with the optional browser extension, gets it auto-filled).

This is the **"Open in Obsidian" pattern**: hand off to an external tool that already does the
job, rather than rebuild a chat UI in-app.

---

## Chosen Approach (Approach 2)

A clipboard-guaranteed launcher with a `?prompt=` URL enhancement for extension users.

- **Clipboard is the guaranteed path.** Every user can paste (⌘V / Ctrl+V) into Gemini.
- **`?prompt=…&autosubmit=false` is a no-cost enhancement.** Gemini's web app does **not**
  natively honor a prompt-in-URL; only third-party Chrome extensions ("Send to Gemini",
  "Gemini URL Prompt") do. So the URL param auto-fills *only* for users who installed such an
  extension. For everyone else it is silently ignored, and the clipboard copy covers them.
  `autosubmit=false` means the extension fills but does not auto-send, so the user can edit
  before submitting.

### Rejected alternatives

- **Approach 1 (clipboard only):** identical build cost minus one harmless URL param. We
  include the param because it is nearly free and strictly additive.
- **Approach 3 (in-app chat via Gemini API):** rebuilds what Gemini already does, adds a chat
  state machine + streaming UI + history persistence + ongoing API cost, and grounds answers
  on a weaker transcript rather than Gemini watching the real video. Rejected as over-build.

---

## Architecture & Data Flow

No backend. No API route, no Gemini API call, no SSE/job-registry, no `Video` schema change,
no persistence. Two pieces:

1. **`lib/ask-gemini.ts`** — pure, side-effect-free builders (unit-tested):
   - `buildGeminiPrompt(video: Video): string`
   - `buildGeminiUrl(prompt: string): string`

2. **`components/VideoMenu.tsx`** — a new menu `<button>` whose click handler calls the
   builders, performs the two browser side-effects (clipboard write + `window.open`), and
   renders a transient inline confirmation.

```
click "Ask Gemini about this video"
  └─ prompt = buildGeminiPrompt(video)          // pure, language-aware
  └─ url    = buildGeminiUrl(prompt)            // pure, encoded
  └─ navigator.clipboard.writeText(prompt)      // async; drives confirmation/fallback text
  └─ window.open(url, '_blank', 'noopener,noreferrer')   // new tab; return value ignored (see note)
  └─ render inline confirmation in the menu, auto-close after ~2.5s (success only)
```

Both side-effects fire **synchronously inside the click handler** so they run in the browser's
user-gesture context (clipboard writes and `window.open` are gesture-gated; deferring them
risks silent blocking).

**`window.open` return value is not used.** With `noopener` set, `window.open` returns `null`
**even on success** (per the HTML spec), so the return value cannot distinguish a blocked popup
from a successful one. We keep `noopener,noreferrer` for security (the opened tab gets no
`window.opener` handle and no referrer) and accept that a blocked popup is not separately
detected: the clipboard copy still succeeds, and the user can open Gemini manually. The
confirmation is driven solely by the clipboard promise (resolve → success; reject/unavailable →
fallback).

---

## Prompt & URL Builders (exact contracts)

### `buildGeminiPrompt(video)`

Selects text by `video.language` (a required `'en' | 'ko'` enum; any unexpected value defaults
to English defensively). Interpolates `video.youtubeUrl` (a required URL).

| `video.language` | Returned string |
|---|---|
| `'en'` (and default) | `Please review this video first; I'd like to ask questions about it: <youtubeUrl>` |
| `'ko'` | `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: <youtubeUrl>` |

`<youtubeUrl>` is the raw `video.youtubeUrl` value, appended verbatim (no trailing punctuation
after the URL).

### `buildGeminiUrl(prompt)`

Returns `https://gemini.google.com/app?prompt=<ENCODED>&autosubmit=false`, where `<ENCODED>` is
`encodeURIComponent(prompt)`. Param order is fixed: `prompt` then `autosubmit`. `autosubmit` is
the literal string `false` (not encoded). The function does not encode the whole query itself —
only the prompt value is encoded.

---

## URL Contracts

| Component | Link/Action text | Full URL with all params |
|---|---|---|
| VideoMenu "Ask Gemini about this video" | (button → `window.open`) | `https://gemini.google.com/app?prompt=<encodeURIComponent(buildGeminiPrompt(video))>&autosubmit=false` |

There is exactly one generated URL. Both query params (`prompt`, `autosubmit`) are asserted in
tests.

---

## Confirmation / Dismissal

The inline confirmation is a transient message rendered inside the already-open menu (not a
separate modal/overlay). The menu's existing dismissal paths (Escape, backdrop click) are
unchanged.

| Element | Dismissal mechanism | Expected result |
|---|---|---|
| Inline confirmation — **success** state | Auto-close timer (~2.5s after a successful copy) | Confirmation clears and the menu closes via the existing `onClose` |
| Inline confirmation — **fallback** state | **No auto-close** (the prompt text must stay readable) | Persists until the user dismisses the menu manually |
| Inline confirmation (any state) | User clicks backdrop / presses Escape | Menu closes immediately (existing behavior); any pending timer is cleared on unmount |
| Menu (host) | Existing Escape / backdrop | Unchanged |

Only the **success** state auto-closes. The fallback state stays open so the user can read/copy
the prompt manually.

---

## Error Handling

| Failure | Detection | Behavior |
|---|---|---|
| Clipboard write rejects (focus/permission/insecure context) | `navigator.clipboard.writeText(...)` promise rejects, or `navigator.clipboard?.writeText` is undefined | Confirmation switches to a **fallback** state that displays the prompt text so the user can select-copy it manually. Gemini tab still opened. No throw. |
| Clipboard write succeeds | promise resolves | Confirmation shows **"✓ Prompt copied — paste (⌘V / Ctrl+V) into Gemini"**, auto-closes ~2.5s. |
| Popup blocked | *not detected* — see the `window.open` note above | No dedicated state. The clipboard copy still succeeded; the user opens Gemini manually. |

Side-effect ordering: call `window.open` and `navigator.clipboard.writeText` both within the
gesture; the confirmation state is driven **solely by the clipboard promise** (resolve →
success; reject/unavailable → fallback). The `window.open` return value is ignored. A clipboard
failure must not prevent opening Gemini, and a failure to open Gemini must not prevent the
clipboard copy.

---

## Enumerated Behaviors (implementation contract)

| # | Behavior | Trigger | Expected |
|---|---|---|---|
| 1 | EN prompt | `buildGeminiPrompt` with `language: 'en'` | `Please review this video first; I'd like to ask questions about it: <url>` |
| 2 | KO prompt | `buildGeminiPrompt` with `language: 'ko'` | `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: <url>` |
| 3 | Unknown language defaults to EN | `buildGeminiPrompt` with an out-of-enum language (defensive) | EN string |
| 4 | URL encoding | `buildGeminiUrl(prompt)` | `https://gemini.google.com/app?prompt=<encodeURIComponent(prompt)>&autosubmit=false` |
| 5 | URL special chars | prompt containing spaces, `:`, `?`, `&`, Hangul | all encoded in the `prompt` value; `autosubmit=false` intact and parseable |
| 6 | Menu item always enabled | render VideoMenu for any video | item is an enabled `<button>` (never `aria-disabled`) |
| 7 | Click copies + opens | click the item | `clipboard.writeText` called with `buildGeminiPrompt(video)`; `window.open` called with `buildGeminiUrl(...)` and `'_blank','noopener,noreferrer'`; return value ignored |
| 8 | Success confirmation | click, clipboard resolves | "✓ Prompt copied…" shown; auto-closes ~2.5s |
| 9 | Clipboard-reject fallback | click, `writeText` rejects (or clipboard unavailable) | fallback state shows the prompt text; no unhandled rejection; Gemini still opened; no auto-close |
| 10 | Timer cleanup | menu unmounts before timer fires | no state update after unmount (no act/leak warning) |

---

## Testing Strategy

- **Unit (jest + ts-jest)** — `lib/ask-gemini.ts`, TDD:
  behaviors #1–#5. Pure functions, exact-string assertions, both query params asserted.
- **Component (@testing-library/react)** — `AskGeminiMenuItem` (+ one wiring assertion in
  `VideoMenu`): behaviors #6–#10. Mock `navigator.clipboard.writeText` (resolve, reject, and
  *unavailable* cases) and `window.open`; assert call arguments, the confirmation text, the
  fallback path, that `window.open` still fires when the clipboard fails, and timer cleanup.
  Use `role="status"` for the success state and `role="alert"` for the fallback (matching the
  codebase's success/error convention). Flush async with
  `await act(async () => { await jest.advanceTimersByTimeAsync(0); })` (fake timers).
- **E2E:** none — an external browser tab cannot be asserted; the component test is the
  coverage boundary.

Mocking boundary: clipboard and `window.open` are mocked at the component-test level; the
builders are tested directly with no mocks.

---

## Out of Scope (YAGNI)

- In-app chat UI, message history, or any persistence of the conversation (it lives in Gemini).
- Any Gemini API call or cost.
- Bundling the existing summary/transcript into the prompt (Approach B, rejected — Gemini
  watches the real video; keeps the payload small enough for `?prompt=`).
- Localizing the menu **label** (existing menu labels are English; consistent with the app).
- Detecting whether the user has the Gemini browser extension installed.

---

## Open Questions

None. All decisions resolved during brainstorming.
