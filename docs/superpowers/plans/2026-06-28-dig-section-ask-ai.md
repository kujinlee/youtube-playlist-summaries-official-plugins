# Per-Section + Whole-Video "Ask AI" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Ask AI" entry points to the dig-deeper doc — one whole-video (top bar) and one per section (heading) — that copy a Gemini prompt to the clipboard and open Gemini, scoped to the whole video or to that section's time range.

**Architecture:** Pure prompt builders + a provider config in `lib/ask-gemini.ts` (jest-tested); the render embeds per-element `data-ai-prompt`/`data-ai-url` attributes and a self-contained inline `ASK_AI_SCRIPT` (clipboard + open + toast). Render-only; no version bump.

**Tech Stack:** TypeScript, plain inline DOM JS, jest, Playwright.

## Global Constraints

- Prompts carry **video link + timestamp only** (no prose text). (Spec Feature 2.)
- Section end is derived from the **next section's `startSec`** (render-local; `MergedSection` has no `endSec`); `null` → "onward" phrasing. (Spec B1.)
- `data-ai-prompt` = `esc(rawPrompt)` (HTML-attribute escape, **no** percent-encoding); `data-ai-url` = `esc(AI_PROVIDER.buildUrl(rawPrompt))` (percent-encodes the prompt **inside the URL only**). (Spec M2.)
- `renderDigDeeperDoc` gains `language?: 'en' | 'ko'` — **optional, default `'en'`** (27 existing callers must keep compiling). (Spec B2.)
- `buildGeminiPrompt(video)` must keep returning its exact current strings (it delegates). (Spec L1.)
- Interactive behavior (clipboard + toast) → Playwright E2E; inline scripts are not jest-executable. (Spec H3.)
- `window.open(..., 'noopener,noreferrer')`. (Spec Security.)

---

### Task 1: Prompt builders + provider config (`lib/ask-gemini.ts`)

**Files:**
- Modify: `lib/ask-gemini.ts`
- Test: `tests/lib/ask-gemini.test.ts`

**Interfaces:**
- Produces:
  - `buildWholeVideoPrompt(videoUrl: string, lang: 'en' | 'ko'): string`
  - `buildSectionPrompt(videoUrl: string, startSec: number, endSec: number | null, lang: 'en' | 'ko'): string` — appends `&t={startSec}s` to `videoUrl` (callers pass a `watch?v=…` URL, which already has a query).
  - `AI_PROVIDER: { name: string; buildUrl(prompt: string): string }`
  - `buildGeminiPrompt(video)` unchanged externally (now delegates).
- Consumes: `formatTimestamp` from `lib/transcript-timestamps` (m:ss / h:mm:ss).

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/ask-gemini.test.ts`:

```ts
import {
  buildWholeVideoPrompt, buildSectionPrompt, AI_PROVIDER,
} from '../../lib/ask-gemini';

const URL_W = 'https://www.youtube.com/watch?v=abc';

describe('buildWholeVideoPrompt', () => {
  it('en', () => {
    expect(buildWholeVideoPrompt(URL_W, 'en'))
      .toBe(`Please review this video first; I'd like to ask questions about it: ${URL_W}`);
  });
  it('ko', () => {
    expect(buildWholeVideoPrompt(URL_W, 'ko'))
      .toBe(`아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: ${URL_W}`);
  });
});

describe('buildSectionPrompt', () => {
  it('en with range', () => {
    expect(buildSectionPrompt(URL_W, 75, 130, 'en'))
      .toBe(`Please review this section of the video (from 1:15 to 2:10), then I'd like to ask questions about it: ${URL_W}&t=75s`);
  });
  it('en onward (null end)', () => {
    expect(buildSectionPrompt(URL_W, 75, null, 'en'))
      .toBe(`Please review this section of the video (from 1:15 onward), then I'd like to ask questions about it: ${URL_W}&t=75s`);
  });
  it('ko with range', () => {
    expect(buildSectionPrompt(URL_W, 75, 130, 'ko'))
      .toBe(`이 영상의 해당 구간(1:15부터 2:10까지)을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: ${URL_W}&t=75s`);
  });
  it('ko onward (null end)', () => {
    expect(buildSectionPrompt(URL_W, 75, null, 'ko'))
      .toBe(`이 영상의 해당 구간(1:15부터)을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: ${URL_W}&t=75s`);
  });
});

describe('AI_PROVIDER', () => {
  it('builds a Gemini url that percent-encodes only the prompt', () => {
    const url = AI_PROVIDER.buildUrl('hi: https://www.youtube.com/watch?v=abc&t=1s');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://gemini.google.com/app');
    expect(u.searchParams.get('prompt')).toBe('hi: https://www.youtube.com/watch?v=abc&t=1s');
    expect(u.searchParams.get('autosubmit')).toBe('false');
  });
});
```

The existing `buildGeminiPrompt` tests (EN/KO/fallback) must still pass after the delegation refactor — do not modify them.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest ask-gemini`
Expected: FAIL — new exports do not exist.

- [ ] **Step 3: Implement**

Replace the body of `lib/ask-gemini.ts` with:

```ts
import type { Video } from '@/types';
import { formatTimestamp } from '@/lib/transcript-timestamps';

const GEMINI_APP_URL = 'https://gemini.google.com/app';

/** Whole-video prompt: review the video, then invite questions. Non-'ko' → English. */
export function buildWholeVideoPrompt(videoUrl: string, lang: 'en' | 'ko'): string {
  if (lang === 'ko') {
    return `아래 영상을 먼저 검토해 주세요. 이 영상에 대해 질문하고 싶습니다: ${videoUrl}`;
  }
  return `Please review this video first; I'd like to ask questions about it: ${videoUrl}`;
}

/**
 * Section-scoped prompt: review the section [startSec, endSec], then invite questions.
 * `videoUrl` must be a `watch?v=…` URL (already has a query) so `&t=` is correct.
 * `endSec === null` → open-ended ("onward") phrasing.
 */
export function buildSectionPrompt(
  videoUrl: string, startSec: number, endSec: number | null, lang: 'en' | 'ko',
): string {
  const at = `${videoUrl}&t=${startSec}s`;
  const start = formatTimestamp(startSec);
  if (lang === 'ko') {
    const range = endSec !== null ? `${start}부터 ${formatTimestamp(endSec)}까지` : `${start}부터`;
    return `이 영상의 해당 구간(${range})을 먼저 검토해 주세요. 이 부분에 대해 질문하고 싶습니다: ${at}`;
  }
  const range = endSec !== null ? `from ${start} to ${formatTimestamp(endSec)}` : `from ${start} onward`;
  return `Please review this section of the video (${range}), then I'd like to ask questions about it: ${at}`;
}

/** Build the Gemini web-app deep link; only the prompt value is percent-encoded. */
export function buildGeminiUrl(prompt: string): string {
  return `${GEMINI_APP_URL}?prompt=${encodeURIComponent(prompt)}&autosubmit=false`;
}

/** Provider config — swap here to add another AI later. */
export const AI_PROVIDER = {
  name: 'Gemini',
  buildUrl: buildGeminiUrl,
};

/** Whole-video prompt for a Video (delegates to buildWholeVideoPrompt). */
export function buildGeminiPrompt(video: Video): string {
  return buildWholeVideoPrompt(video.youtubeUrl, video.language === 'ko' ? 'ko' : 'en');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest ask-gemini`
Expected: PASS (new tests + the unchanged `buildGeminiPrompt` EN/KO/fallback tests).

- [ ] **Step 5: Full suite + commit**

Run: `npm test` then `npx tsc --noEmit` (expect green/clean).

```bash
git add lib/ask-gemini.ts tests/lib/ask-gemini.test.ts
git commit -m "feat(ask-ai): section + whole-video prompt builders + provider config"
```

---

### Task 2: Wire Ask-AI links + script into the dig doc

**Files:**
- Modify: `lib/html-doc/render-dig-deeper.ts` (args + topbar + section heading + CSS + script + shell)
- Modify: `app/api/html/[id]/route.ts:195` (pass `language`)
- Test: `tests/lib/html-doc/render-dig-deeper.test.ts` (render contract)
- Test (E2E): `tests/e2e/dig-deeper.spec.ts` (clipboard + toast)

**Interfaces:**
- Consumes: `buildWholeVideoPrompt`, `buildSectionPrompt`, `AI_PROVIDER` (Task 1).
- Produces: `.ask-ai` links carrying `data-ai-prompt` + `data-ai-url`; an `#_dg-ai-toast`.

- [ ] **Step 1: Write the failing jest tests**

Add to `tests/lib/html-doc/render-dig-deeper.test.ts` **inside the `Behavior 9` describe (≈line 876)** — its `html` is built (in a local `beforeAll`) from `makeSummary()` (≈line 426), which has two timed sections, so both a top-bar and a per-section `.ask-ai` render. (There is no module-level `html`; each behavior describe builds its own.)

```ts
    it('renders a whole-video Ask-AI link in the top bar', () => {
      expect(html).toMatch(/<a class="ask-ai"[^>]*data-ai-prompt="[^"]*Please review this video first/);
      expect(html).toContain('Ask AI about this video');
    });

    it('renders a per-section Ask-AI link with the section prompt + gemini url', () => {
      // section prompt is HTML-attr-escaped: the &t= becomes &amp;t=
      expect(html).toMatch(/<a class="ask-ai"[^>]*data-ai-prompt="[^"]*this section of the video/);
      expect(html).toMatch(/data-ai-url="https:\/\/gemini\.google\.com\/app\?prompt=/);
    });

    it('includes the ask-ai toast + script', () => {
      expect(html).toContain('id="_dg-ai-toast"');
      expect(html).toContain("closest('.ask-ai')");
      expect(html).toContain('clipboard');
    });
```

And a focused describe for language threading + the null-startSec guard (reuse the file's `makeTempDir`/types-cast helpers from the dig-slide describe added in Feature 1; if absent, define a local summary builder as below):

```ts
describe('renderDigDeeperDoc — Ask-AI links', () => {
  function summaryTwoSections(): ParsedSummary {
    return {
      title: 'T', channel: null, duration: null,
      url: 'https://www.youtube.com/watch?v=vid123', lang: 'EN', videoId: 'vid123',
      tldr: null, takeaways: [], sourceMd: 'test.md',
      sections: [
        { numeral: '1', title: 'A', prose: 'p', timeRange: { startSec: 10, endSec: 20 } },
        { numeral: '2', title: 'B', prose: 'p', timeRange: { startSec: 40, endSec: 50 } },
      ],
    } as unknown as ParsedSummary;
  }

  it('section end = NEXT section start; last section is "onward"; ko threads through', () => {
    const html = renderDigDeeperDoc({
      summary: summaryTwoSections(), envelope: null, dug: [],
      mdPath: '/tmp/x/doc.md', videoId: 'vid123', language: 'ko',
    });
    // section 1 range uses next start (40s = 0:40): "0:10부터 0:40까지"
    expect(html).toContain('0:10부터 0:40까지');
    // last section is open-ended: "0:40부터)"
    expect(html).toContain('0:40부터)');
  });

  it('defaults language to en when omitted', () => {
    const html = renderDigDeeperDoc({
      summary: summaryTwoSections(), envelope: null, dug: [],
      mdPath: '/tmp/x/doc.md', videoId: 'vid123',
    });
    expect(html).toContain('this section of the video (from 0:10 to 0:40)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest render-dig-deeper -t "Ask-AI"`
Expected: FAIL — no `.ask-ai` markup / `language` arg yet.

- [ ] **Step 3: Add the `language` arg (optional, default 'en')**

In `lib/html-doc/render-dig-deeper.ts`, extend the args type and destructure:

```ts
export function renderDigDeeperDoc(args: {
  summary: ParsedSummary;
  envelope: ModelEnvelope | null;
  dug: DugSection[];
  mdPath: string;
  videoId: string;
  language?: 'en' | 'ko';
}): string {
  const { summary, envelope, dug, mdPath, videoId, language = 'en' } = args;
```

Add the imports at the top of the file:

```ts
import { buildWholeVideoPrompt, buildSectionPrompt, AI_PROVIDER } from '@/lib/ask-gemini';
```

And build the video URL + a small attr helper just after `const videoId` is in scope (after `const title = summary.title;`):

```ts
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  // an .ask-ai anchor: data-ai-prompt is HTML-attr-escaped (NOT percent-encoded);
  // data-ai-url percent-encodes the prompt inside the gemini URL.
  const askAi = (prompt: string, label: string): string =>
    `<a class="ask-ai" data-ai-prompt="${esc(prompt)}" data-ai-url="${esc(AI_PROVIDER.buildUrl(prompt))}">${label}</a>`;
```

- [ ] **Step 4: Top-bar whole-video link**

Replace the `topBar` line with:

```ts
  const wholeAsk = askAi(buildWholeVideoPrompt(videoUrl, language), '💬 Ask AI about this video');
  const topBar = `<div class="dg-topbar">${summaryLink} <button class="dg-expand-all">⤢ expand all</button> ${wholeAsk}</div>`;
```

- [ ] **Step 5: Per-section link (end = next section start)**

Change the sections map to expose the index and compute `endSec`. Update the `.map` signature and append the section Ask-AI to `control`:

```ts
  const sectionsHtml = sections.map((ms, i) => {
```

Then, where `control` is being assembled (after the existing dig-trigger/toggle logic, before the `heading` is built), append:

```ts
    if (startSec !== null) {
      const endSec = sections.slice(i + 1).find((s) => s.startSec !== null)?.startSec ?? null;
      control += ` ${askAi(buildSectionPrompt(videoUrl, startSec, endSec, language), '💬 ask AI')}`;
    }
```

(Place this so it runs for every section with a `startSec`, dug or not — the section Ask-AI is independent of dug state.)

- [ ] **Step 6: CSS + toast + script**

Append to `DIG_DOC_CSS` (before its closing backtick):

```ts
.dg .ask-ai{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--meta);font-size:.8rem;font-weight:400;text-decoration:none;white-space:nowrap;cursor:pointer}
.dg .ask-ai:hover{text-decoration:underline}
#_dg-ai-toast{display:none;position:fixed;left:50%;bottom:1.4rem;transform:translateX(-50%);z-index:9600;background:var(--card,#222);color:var(--ink,#fff);border:1px solid var(--rule);border-radius:6px;padding:.5em .9em;font-size:.85rem;box-shadow:0 4px 18px rgba(0,0,0,.2)}
#_dg-ai-toast[data-show]{display:block}
```

Add the toast markup next to the zoom overlay (after `${zoomOverlay}` is fine — define the constant near it):

```ts
  const aiToast = `<div id="_dg-ai-toast" role="status"></div>`;
```

Add the script constant (ES5-plain, near `zoomScript`):

```ts
  const askAiScript = `<script>(function(){
  var toast=document.getElementById('_dg-ai-toast');
  function show(m){if(!toast)return;toast.textContent=m;toast.setAttribute('data-show','');setTimeout(function(){toast.removeAttribute('data-show');},2500);}
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('.ask-ai'):null;
    if(!a)return;
    e.preventDefault();
    var p=a.getAttribute('data-ai-prompt')||'',u=a.getAttribute('data-ai-url')||'';
    if(u)window.open(u,'_blank','noopener,noreferrer');
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(p).then(function(){show('✓ copied — paste (⌘V) into Gemini');},function(){show('Could not copy — select the link text and copy it');});
    }else{show('Could not copy — select the link text and copy it');}
  });
})();</script>`;
```

Include `${aiToast}` and `${askAiScript}` in the page shell:

```ts
${expandAllDialogs}${zoomOverlay}${aiToast}
${NAV_SCRIPT}${THEME_TOGGLE_SCRIPT}${zoomScript}${askAiScript}
```

- [ ] **Step 7: Pass `language` from the serve route**

In `app/api/html/[id]/route.ts:195`, change the dig-deeper render call to:

```ts
    return serveHtml(renderDigDeeperDoc({ summary: parsed, envelope, dug, mdPath: summaryMdPath, videoId, language: video.language }));
```

- [ ] **Step 8: Run the jest tests**

Run: `npx jest render-dig-deeper`
Expected: PASS (new Ask-AI tests + all existing).

- [ ] **Step 9: Write the failing E2E test**

In `tests/e2e/dig-deeper.spec.ts`, add (reusing `makeCompanionHtmlWithSlides()` + the F5a route pattern). Stub `window.open` so no real Gemini navigation happens, and grant clipboard:

```ts
test('A1 (Ask-AI): clicking a section Ask-AI copies the prompt and shows the toast; opens the gemini url', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((u?: string | URL) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open;
  });
  const html = makeCompanionHtmlWithSlides();
  await page.route(`**/api/html/${VIDEO_ID_SLIDES}**`, (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: html }),
  );
  await page.goto(`http://localhost:3000/api/html/${VIDEO_ID_SLIDES}?outputFolder=${encodeURIComponent(OUTPUT_FOLDER)}&type=dig-deeper`);

  // .first() is the top-bar WHOLE-VIDEO link (top bar is emitted before sections);
  // its prompt says "this video" (the section prompt builder is unit-tested in Task 1).
  const ask = page.locator('.ask-ai').first();
  await expect(ask).toBeVisible();
  await ask.click();

  // toast appears
  await expect(page.locator('#_dg-ai-toast')).toBeVisible();

  // clipboard holds the prompt
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('this video');

  // gemini url was opened
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened.some((u) => u.startsWith('https://gemini.google.com/app?prompt='))).toBe(true);
});
```

- [ ] **Step 10: Run the E2E**

Run: `npx playwright test dig-deeper --grep "A1"`
Expected: PASS (toast visible; clipboard contains the prompt; gemini url recorded).

- [ ] **Step 11: Full suite + commit**

Run: `npm test` then `npx tsc --noEmit` (expect green/clean).

```bash
git add lib/html-doc/render-dig-deeper.ts "app/api/html/[id]/route.ts" tests/lib/html-doc/render-dig-deeper.test.ts tests/e2e/dig-deeper.spec.ts
git commit -m "feat(dig): per-section + whole-video Ask-AI links (clipboard + open Gemini)"
```

---

## Notes for the implementer
- The new `.ask-ai` click handler and the zoom click handler are both on `document`; they don't conflict (`.ask-ai` uses `closest('.ask-ai')`, zoom checks `dig-slide` / open-state). nav.ts ignores `.ask-ai` (its `closest` checks `.dig-toggle`/`.dig-refresh`/`.dig-trigger`).
- Do NOT percent-encode `data-ai-prompt` — it is the literal clipboard text; only `esc()` it for the attribute. The `data-ai-url` is where percent-encoding happens (inside `AI_PROVIDER.buildUrl`).
- Keep `askAiScript` ES5-plain to match `NAV_SCRIPT`/`zoomScript`.
- Verification (Phase 4): try a `ko` video to confirm Korean prompts; confirm the section button vs whole-video button is the (2)-vs-(1) ingestion experiment the user wanted.
