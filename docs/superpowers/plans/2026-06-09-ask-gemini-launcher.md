# Ask Gemini About This Video — Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a video-row menu button, "Ask Gemini about this video", that copies a language-aware prompt to the clipboard and opens Gemini's web app in a new tab, reproducing the user's manual "paste URL → chat" flow in one click.

**Architecture:** Pure frontend, no backend. Two pure builder functions in `lib/ask-gemini.ts` (`buildGeminiPrompt`, `buildGeminiUrl`), one small stateful client component `components/AskGeminiMenuItem.tsx` that performs the clipboard write + `window.open` inside the click gesture and renders a transient inline confirmation, and a one-line wiring into `components/VideoMenu.tsx`. No API route, no Gemini API call, no SSE, no `Video` schema change, no persistence.

**Tech Stack:** TypeScript (strict), React client component, jest + ts-jest (unit), @testing-library/react + jsdom (component). Path alias `@/*` → repo root.

**Spec:** `docs/superpowers/specs/2026-06-09-ask-gemini-launcher-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ask-gemini.ts` (create) | Pure builders: language-aware prompt + encoded Gemini URL. No side effects. |
| `tests/lib/ask-gemini.test.ts` (create) | Unit tests for both builders (EN/KO/default, encoding). |
| `components/AskGeminiMenuItem.tsx` (create) | The button + click handler (clipboard + `window.open`) + transient confirmation state machine + auto-close timer. |
| `tests/components/AskGeminiMenuItem.test.tsx` (create) | Component tests: success, KO prompt, clipboard-reject fallback, clipboard-unavailable fallback, timer cleanup. |
| `components/VideoMenu.tsx` (modify) | Render `<AskGeminiMenuItem>` as a menu item under "Watch on YouTube". |
| `tests/components/VideoMenu.test.tsx` (modify) | Assert the item renders enabled within the menu. |

---

### Task 1: Pure builders (`lib/ask-gemini.ts`)

**Files:**
- Create: `lib/ask-gemini.ts`
- Test: `tests/lib/ask-gemini.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/ask-gemini.test.ts`:

```ts
import { buildGeminiPrompt, buildGeminiUrl } from '../../lib/ask-gemini';
import type { Video } from '@/types';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/abc', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: null, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

const EN = "Please review this video first; I'd like to ask questions about it: https://youtu.be/abc";
const KO = '아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: https://youtu.be/abc';

describe('buildGeminiPrompt', () => {
  it('builds the English prompt with the URL appended', () => {
    expect(buildGeminiPrompt(video({ language: 'en' }))).toBe(EN);
  });

  it('builds the Korean prompt with the URL appended', () => {
    expect(buildGeminiPrompt(video({ language: 'ko' }))).toBe(KO);
  });

  it('falls back to English for an unexpected language', () => {
    const v = video({ language: 'fr' as unknown as Video['language'] });
    expect(buildGeminiPrompt(v)).toBe(EN);
  });
});

describe('buildGeminiUrl', () => {
  it('encodes the prompt and sets autosubmit=false', () => {
    const url = buildGeminiUrl('hi there: https://youtu.be/abc?t=1&x=2');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://gemini.google.com/app');
    expect(u.searchParams.get('prompt')).toBe('hi there: https://youtu.be/abc?t=1&x=2');
    expect(u.searchParams.get('autosubmit')).toBe('false');
  });

  it('encodes Hangul and reserved characters in the prompt value', () => {
    const url = buildGeminiUrl('질문: a&b?');
    expect(url).toContain('prompt=' + encodeURIComponent('질문: a&b?'));
    expect(url).toContain('&autosubmit=false');
    expect(new URL(url).searchParams.get('prompt')).toBe('질문: a&b?');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest ask-gemini`
Expected: FAIL — `Cannot find module '../../lib/ask-gemini'`.

- [ ] **Step 3: Write the implementation**

Create `lib/ask-gemini.ts`:

```ts
import type { Video } from '@/types';

const GEMINI_APP_URL = 'https://gemini.google.com/app';

/**
 * Build a language-aware prompt asking Gemini to review a YouTube video and invite
 * follow-up questions. The raw video URL is appended verbatim so Gemini watches the
 * real video. `language` is a required 'en' | 'ko' enum; anything else falls back to
 * English defensively.
 */
export function buildGeminiPrompt(video: Video): string {
  const url = video.youtubeUrl;
  if (video.language === 'ko') {
    return `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: ${url}`;
  }
  return `Please review this video first; I'd like to ask questions about it: ${url}`;
}

/**
 * Build the Gemini web-app deep link. `?prompt=` is auto-filled only for users with a
 * "Send to Gemini"-style browser extension and ignored otherwise (the clipboard copy
 * covers everyone else). `autosubmit=false` keeps the extension from sending before
 * the user edits. Only the prompt value is percent-encoded.
 */
export function buildGeminiUrl(prompt: string): string {
  return `${GEMINI_APP_URL}?prompt=${encodeURIComponent(prompt)}&autosubmit=false`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest ask-gemini`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ask-gemini.ts tests/lib/ask-gemini.test.ts
git commit -m "feat(ask-gemini): pure prompt + URL builders"
```

---

### Task 2: Launcher component (`components/AskGeminiMenuItem.tsx`)

**Files:**
- Create: `components/AskGeminiMenuItem.tsx`
- Test: `tests/components/AskGeminiMenuItem.test.tsx`

**Behavior contract (from spec Enumerated Behaviors #6–#10):**
- Click → `window.open(buildGeminiUrl(prompt), '_blank', 'noopener,noreferrer')` and `navigator.clipboard.writeText(prompt)`, both fired synchronously in the handler.
- **`window.open` return value is ignored** — with `noopener` it returns `null` even on success, so it cannot distinguish blocked from success. Confirmation is driven solely by the clipboard promise.
- Clipboard resolves → **success** state ("✓ Prompt copied…"), schedule `onClose` after `AUTO_CLOSE_MS` (2500).
- Clipboard rejects, or `navigator.clipboard?.writeText` is unavailable → **fallback** state showing the prompt in a read-only textarea (no auto-close).
- Timer cleared on unmount.

- [ ] **Step 1: Write the failing tests**

Create `tests/components/AskGeminiMenuItem.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, act, fireEvent } from '@testing-library/react';
import AskGeminiMenuItem from '../../components/AskGeminiMenuItem';
import type { Video } from '@/types';

function video(extra: Partial<Video> = {}): Video {
  return {
    id: 'v', title: 'T', youtubeUrl: 'https://youtu.be/abc', language: 'en',
    durationSeconds: 60, archived: false,
    ratings: { usefulness: 4, depth: 4, originality: 4, recency: 4, completeness: 4 },
    overallScore: 4, summaryMd: null, summaryPdf: null, deepDiveMd: null, deepDivePdf: null,
    summaryHtml: null, processedAt: '2026-06-09T00:00:00.000Z', ...extra,
  } as Video;
}

const EN = "Please review this video first; I'd like to ask questions about it: https://youtu.be/abc";
const KO = '아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: https://youtu.be/abc';
const EXPECTED_URL =
  'https://gemini.google.com/app?prompt=' + encodeURIComponent(EN) + '&autosubmit=false';

// Pass a mock to install navigator.clipboard.writeText; pass null to simulate the
// clipboard API being unavailable (navigator.clipboard === undefined).
function setClipboard(writeText: jest.Mock | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

const askButton = () => screen.getByRole('button', { name: /ask gemini about this video/i });

// Flush the clipboard promise chain + fake timers the way the rest of the suite does
// (see Header.test.tsx). advanceTimersByTimeAsync pumps microtasks between timers, so the
// .then/.catch settle reliably regardless of resolve-vs-reject tick depth.
async function flush(ms = 0) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  setClipboard(null); // restore_all_mocks does not undo defineProperty — reset explicitly
});

it('copies the prompt, opens Gemini, shows success, and auto-closes', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  const open = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video({ language: 'en' })} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  expect(writeText).toHaveBeenCalledWith(EN);
  expect(open).toHaveBeenCalledWith(EXPECTED_URL, '_blank', 'noopener,noreferrer');
  expect(screen.getByRole('status')).toHaveTextContent(/prompt copied/i);
  expect(onClose).not.toHaveBeenCalled();

  await flush(2500);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('uses the Korean prompt for ko videos', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  jest.spyOn(window, 'open').mockReturnValue({} as Window);
  render(<AskGeminiMenuItem video={video({ language: 'ko' })} onClose={jest.fn()} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });
  expect(writeText).toHaveBeenCalledWith(KO);
});

it('falls back to a copyable prompt and still opens Gemini when the clipboard write rejects', async () => {
  const writeText = jest.fn().mockRejectedValue(new Error('denied'));
  setClipboard(writeText);
  const open = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  expect(open).toHaveBeenCalledWith(EXPECTED_URL, '_blank', 'noopener,noreferrer'); // Gemini still opened
  expect(screen.getByRole('alert')).toHaveTextContent(/copy this prompt and paste/i);
  expect(screen.getByDisplayValue(EN)).toBeInTheDocument();

  await flush(5000);
  expect(onClose).not.toHaveBeenCalled(); // fallback does not auto-close
});

it('falls back and still opens Gemini when the clipboard API is unavailable', async () => {
  setClipboard(null); // navigator.clipboard === undefined
  const open = jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });

  expect(open).toHaveBeenCalledWith(EXPECTED_URL, '_blank', 'noopener,noreferrer');
  expect(screen.getByRole('alert')).toHaveTextContent(/copy this prompt and paste/i);
  expect(screen.getByDisplayValue(EN)).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it('clears the auto-close timer on unmount', async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  jest.spyOn(window, 'open').mockReturnValue({} as Window);
  const onClose = jest.fn();
  const { unmount } = render(<AskGeminiMenuItem video={video()} onClose={onClose} />);

  await act(async () => { fireEvent.click(askButton()); await jest.advanceTimersByTimeAsync(0); });
  unmount();

  await flush(5000);
  expect(onClose).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest AskGeminiMenuItem`
Expected: FAIL — `Cannot find module '../../components/AskGeminiMenuItem'`.

- [ ] **Step 3: Write the implementation**

Create `components/AskGeminiMenuItem.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Video } from '@/types';
import { buildGeminiPrompt, buildGeminiUrl } from '@/lib/ask-gemini';

interface AskGeminiMenuItemProps {
  video: Video;
  onClose: () => void;
}

const itemClass = 'block w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-700';
const AUTO_CLOSE_MS = 2500;

type Confirmation =
  | { kind: 'idle' }
  | { kind: 'success' }
  | { kind: 'fallback'; prompt: string };

export default function AskGeminiMenuItem({ video, onClose }: AskGeminiMenuItemProps) {
  const [confirmation, setConfirmation] = useState<Confirmation>({ kind: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function handleClick() {
    const prompt = buildGeminiPrompt(video);
    // noopener,noreferrer for security; with noopener the return value is null even on
    // success, so it is intentionally ignored. Confirmation is driven by the clipboard promise.
    window.open(buildGeminiUrl(prompt), '_blank', 'noopener,noreferrer');

    const write = navigator.clipboard?.writeText?.(prompt);
    if (write && typeof write.then === 'function') {
      write.then(() => {
        setConfirmation({ kind: 'success' });
        timerRef.current = setTimeout(onClose, AUTO_CLOSE_MS);
      }).catch(() => {
        setConfirmation({ kind: 'fallback', prompt });
      });
    } else {
      setConfirmation({ kind: 'fallback', prompt });
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} className={itemClass}>
        Ask Gemini about this video
      </button>

      {confirmation.kind === 'success' && (
        <div role="status" className="px-4 py-2 text-xs text-emerald-400">
          ✓ Prompt copied — paste (⌘V / Ctrl+V) into Gemini
        </div>
      )}

      {confirmation.kind === 'fallback' && (
        <div role="alert" className="px-4 py-2 text-xs text-amber-400">
          Could not copy automatically. Copy this prompt and paste into Gemini:
          <textarea
            readOnly
            tabIndex={-1}
            value={confirmation.prompt}
            rows={3}
            className="mt-1 w-full rounded bg-zinc-900 p-1 text-zinc-200"
          />
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest AskGeminiMenuItem`
Expected: PASS — 5 tests (success, KO, reject-fallback, unavailable-fallback, unmount-cleanup).

- [ ] **Step 5: Commit**

```bash
git add components/AskGeminiMenuItem.tsx tests/components/AskGeminiMenuItem.test.tsx
git commit -m "feat(ask-gemini): launcher component with clipboard + open + confirmation"
```

---

### Task 3: Wire into the video menu (`components/VideoMenu.tsx`)

**Files:**
- Modify: `components/VideoMenu.tsx` (add import; add `<li>` after "Watch on YouTube")
- Test: `tests/components/VideoMenu.test.tsx` (add one assertion)

- [ ] **Step 1: Write the failing test**

Add to `tests/components/VideoMenu.test.tsx` (append at end of file):

```tsx
it('renders an enabled "Ask Gemini about this video" button', () => {
  renderMenu(video());
  expect(
    screen.getByRole('button', { name: /ask gemini about this video/i }),
  ).toBeEnabled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest VideoMenu`
Expected: FAIL — `Unable to find role="button"` with name "Ask Gemini about this video".

- [ ] **Step 3: Wire the component in**

In `components/VideoMenu.tsx`, add the import after the existing `import type { Video } from '@/types';` line (line 3):

```tsx
import AskGeminiMenuItem from './AskGeminiMenuItem';
```

Then insert a new `<li>` immediately after the "Watch on YouTube" `<li>` block (after its closing `</li>` near line 59), before the "Open in Obsidian" `<li>`:

```tsx
      <li role="none">
        <AskGeminiMenuItem video={video} onClose={onClose} />
      </li>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest VideoMenu`
Expected: PASS — existing tests + the new one.

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; all tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add components/VideoMenu.tsx tests/components/VideoMenu.test.tsx
git commit -m "feat(ask-gemini): add launcher to the video row menu"
```

---

## Final Review

After all three tasks:

- [ ] Run `npx tsc --noEmit` — no type errors.
- [ ] Run `npm test` — full suite green (note: `tests/lib/pdf.test.ts` "renders ASCII art" can flake under jest parallelism due to Puppeteer launch contention; a re-run resolves it — unrelated to this feature).
- [ ] Claude code review (`superpowers:requesting-code-review`) → `docs/reviews/task-ask-gemini-review.md`.
- [ ] Adversarial review (`codex:rescue --fresh`; Claude-Opus fallback while Codex is rate-limited until 2026-07-03) → `docs/reviews/task-ask-gemini-codex.md`.
- [ ] Address all High/Blocking findings; present Medium for decision.
- [ ] Finish branch (`superpowers:finishing-a-development-branch`).

---

## Self-Review (against spec)

**Spec coverage:**
- Approach 2 (clipboard guaranteed + `?prompt=…&autosubmit=false`) → Task 1 `buildGeminiUrl` + Task 2 click handler. ✅
- Exact EN/KO prompt strings → Task 1 tests + impl. ✅
- URL Contract (both params asserted) → Task 1 `buildGeminiUrl` tests + Task 2 `EXPECTED_URL` assertion. ✅
- `window.open` return value ignored (noopener returns null even on success) → Task 2 impl comment + no test depends on the return value. ✅
- Two outcomes (success auto-close, fallback stays open) → Task 2 success + reject-fallback tests. ✅
- Clipboard-unavailable branch (spec-mandated) → Task 2 unavailable-fallback test. ✅
- "Gemini still opened when clipboard fails" invariant → `open` asserted in both fallback tests. ✅
- Success = `role="status"`, fallback = `role="alert"` (codebase convention) → Task 2 impl + tests. ✅
- Timer cleanup on unmount → Task 2 unmount-cleanup test. ✅
- Always-enabled menu item → Task 3 test. ✅
- Behaviors #1–#5 (builders) → Task 1; #6–#10 (component) → Tasks 2–3. ✅
- No backend / no schema change / no persistence → no task touches `types/`, `app/api/`, or any index writer. ✅

**Placeholder scan:** none — every code step contains complete code and exact commands.

**Type consistency:** `buildGeminiPrompt(video: Video): string` and `buildGeminiUrl(prompt: string): string` are referenced identically in Tasks 1–2. `Confirmation` union and `AUTO_CLOSE_MS` (2500) are consistent between the component impl and its tests. The `EN`/`KO` constants match byte-for-byte between Task 1 and Task 2 tests and the impl strings.
