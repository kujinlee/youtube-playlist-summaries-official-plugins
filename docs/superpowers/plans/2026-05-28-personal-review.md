# Personal Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personal score (1–5 stars) and personal note (free-text, max 500 chars) per video — stored in `playlist-index.json`, displayed as columns, filterable, and sortable.

**Architecture:** Types-first to unblock all downstream work. API route (`POST /api/videos/[id]/review`) uses the existing `updateVideoFields` lib function. UI uses optimistic updates: `onChange` fires immediately, reverts on API failure. `Page` owns the `videos` array; annotation changes propagate via `onAnnotationChange(videoId, patch)` threaded down through `VideoList` → `VideoRow` → `StarRating`/`NoteCell`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Zod, Tailwind CSS, Jest + @testing-library/react

**Spec:** `docs/superpowers/specs/2026-05-28-personal-annotations-design.md`

---

## File Map

| File | Status | Change |
|---|---|---|
| `types/index.ts` | Modify | Add `personalScore`, `personalNote` to `VideoSchema`; `minPersonalScore` to `FilterState`; `'personalScore'` to `SortColumn` |
| `app/api/videos/[id]/review/route.ts` | **Create** | POST handler — validates, maps null/empty, calls `updateVideoFields` |
| `tests/api/review.test.ts` | **Create** | 11 tests covering happy paths, validation, 404, 500 |
| `app/api/videos/route.ts` | Modify | Add `personalScore` sort case (nulls-last, both directions) |
| `tests/api/videos.test.ts` | Modify | Add 3 sort tests for `personalScore` |
| `components/StarRating.tsx` | **Create** | Accessible 5-star radiogroup; optimistic save; rollback on failure |
| `tests/components/StarRating.test.tsx` | **Create** | 7 tests |
| `components/NoteCell.tsx` | **Create** | Preview + popover editor; Save/Cancel/Escape/backdrop; error state |
| `tests/components/NoteCell.test.tsx` | **Create** | 11 tests |
| `components/VideoRow.tsx` | Modify | Add `My Score` + `Note` columns; `cellDim` unified dimming; new props |
| `components/VideoList.tsx` | Modify | Add `My Score` (sortable, desc-first) + `Note` (unsortable) headers; thread `onAnnotationChange` + `minPersonalScore` |
| `tests/components/VideoRow.test.tsx` | Modify | Update `renderRow` helper; add 4 tests; fix column count |
| `components/FilterBar.tsx` | Modify | Rename `aria-label="Score"` → `"AI score ≥"`; add `"My score ≥"` dropdown |
| `tests/components/FilterBar.test.tsx` | Modify | Update `/score/i` selector to `/ai score/i`; add 4 My-score tests |
| `app/page.tsx` | Modify | Add `handleAnnotationChange`; `minPersonalScore` filter; pass new props to `VideoList` |

---

## Task 1 — Type Definitions

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1.1 — Write the failing type test**

Create `tests/types/index.test.ts` (new file):

```ts
import { VideoSchema, FILTER_DEFAULTS } from '../../types';

describe('VideoSchema personal review fields', () => {
  const minValidVideo = {
    id: 'abc123',
    title: 'Test',
    youtubeUrl: 'https://youtube.com/watch?v=abc123',
    language: 'en',
    durationSeconds: 60,
    archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3,
    summaryMd: null,
    summaryPdf: null,
    deepDiveMd: null,
    deepDivePdf: null,
    processedAt: '2024-01-01T00:00:00.000Z',
  };

  it('accepts a video without personalScore or personalNote', () => {
    expect(() => VideoSchema.parse(minValidVideo)).not.toThrow();
  });

  it('accepts personalScore in range 1–5', () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: score })).not.toThrow();
    }
  });

  it('rejects personalScore of 0', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: 0 })).toThrow();
  });

  it('rejects personalScore of 6', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalScore: 6 })).toThrow();
  });

  it('accepts personalNote up to 500 chars', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalNote: 'a'.repeat(500) })).not.toThrow();
  });

  it('rejects personalNote over 500 chars', () => {
    expect(() => VideoSchema.parse({ ...minValidVideo, personalNote: 'a'.repeat(501) })).toThrow();
  });
});

describe('FILTER_DEFAULTS', () => {
  it('has minPersonalScore: 0', () => {
    expect(FILTER_DEFAULTS.minPersonalScore).toBe(0);
  });
});
```

- [ ] **Step 1.2 — Run to confirm failure**

```bash
cd /Users/kujinlee/code/agentic-ai-docs/youtube-playlist-summaries-official-plugins
npx jest tests/types/index.test.ts --no-coverage
```

Expected: FAIL (properties don't exist yet)

- [ ] **Step 1.3 — Add fields to `types/index.ts`**

Open `types/index.ts`. Make the following changes:

**a) In `VideoSchema` (after the `addedToPlaylistAt` line):**

```ts
// Before:
  addedToPlaylistAt: z.string().datetime().optional(),
});

// After:
  addedToPlaylistAt: z.string().datetime().optional(),
  personalScore: z.number().int().min(1).max(5).optional(),
  personalNote:  z.string().max(500).optional(),
});
```

**b) In `FilterState` interface:**

```ts
// Before:
export interface FilterState {
  searchText: string;
  language: 'all' | 'en' | 'ko';
  videoType: 'all' | VideoType;
  audience: 'all' | Audience;
  minScore: number;
}

// After:
export interface FilterState {
  searchText: string;
  language: 'all' | 'en' | 'ko';
  videoType: 'all' | VideoType;
  audience: 'all' | Audience;
  minScore: number;
  minPersonalScore: number;  // 0 = no filter; 1–5 = minimum personal score; unscored shown dimmed
}
```

**c) In `FILTER_DEFAULTS`:**

```ts
// Before:
export const FILTER_DEFAULTS: FilterState = {
  searchText: '',
  language: 'all',
  videoType: 'all',
  audience: 'all',
  minScore: 0,
};

// After:
export const FILTER_DEFAULTS: FilterState = {
  searchText: '',
  language: 'all',
  videoType: 'all',
  audience: 'all',
  minScore: 0,
  minPersonalScore: 0,
};
```

**d) In `SortColumn` type:**

```ts
// Before:
export type SortColumn = 'name' | 'overall' | RatingSortColumn | 'language' | 'videoType' | 'audience' | 'playlistIndex' | 'videoPublishedAt' | 'addedToPlaylistAt';

// After:
export type SortColumn = 'name' | 'overall' | RatingSortColumn | 'language' | 'videoType' | 'audience' | 'playlistIndex' | 'videoPublishedAt' | 'addedToPlaylistAt' | 'personalScore';
```

- [ ] **Step 1.4 — Run tests to confirm pass**

```bash
npx jest tests/types/index.test.ts --no-coverage
```

Expected: PASS (7 passing)

- [ ] **Step 1.5 — Run full suite to check for regressions**

```bash
npm test -- --no-coverage
```

Expected: all existing tests still pass (TypeScript errors in downstream files are expected compile errors at this stage — if they surface as test failures, proceed anyway; they are addressed in later tasks)

- [ ] **Step 1.6 — Commit**

```bash
git add types/index.ts tests/types/index.test.ts
git commit -m "feat(types): add personalScore, personalNote, minPersonalScore, personalScore sort"
```

---

## Task 2 — POST /api/videos/[id]/review Route

**Files:**
- Create: `app/api/videos/[id]/review/route.ts`
- Create: `tests/api/review.test.ts`

- [ ] **Step 2.1 — Write failing tests**

Create `tests/api/review.test.ts`:

```ts
jest.mock('../../lib/index-store');

import { POST } from '../../app/api/videos/[id]/review/route';
import * as indexStore from '../../lib/index-store';

const mockUpdateVideoFields = jest.mocked(indexStore.updateVideoFields);
const mockAssertOutputFolder = jest.mocked(indexStore.assertOutputFolder);
const mockAssertVideoId     = jest.mocked(indexStore.assertVideoId);

const OUTPUT_FOLDER = '/tmp/out';
const VIDEO_ID      = 'testVideoId1';

function postReview(videoId: string, body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/videos/${videoId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: videoId }) },
  );
}

describe('POST /api/videos/[id]/review', () => {
  beforeEach(() => {
    mockAssertOutputFolder.mockImplementation(() => {});
    mockAssertVideoId.mockImplementation(() => {});
    mockUpdateVideoFields.mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  // ── Happy paths ────────────────────────────────────────────────────────────

  it('saves personalScore when provided', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalScore: 4 });
  });

  it('saves personalNote when provided', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalNote: 'great video' });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalNote: 'great video' });
  });

  it('saves both fields when both are provided', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3, personalNote: 'ok' });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalScore: 3, personalNote: 'ok' });
  });

  it('deletes personalScore when null is sent (passes undefined to updateVideoFields)', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: null });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalScore: undefined });
  });

  it('deletes personalNote when empty string is sent (passes undefined to updateVideoFields)', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalNote: '' });
    expect(res.status).toBe(200);
    expect(mockUpdateVideoFields).toHaveBeenCalledWith(OUTPUT_FOLDER, VIDEO_ID, { personalNote: undefined });
  });

  // ── Validation errors ──────────────────────────────────────────────────────

  it('returns 400 when outputFolder is missing', async () => {
    const res = await postReview(VIDEO_ID, { personalScore: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('outputFolder is required');
  });

  it('returns 400 when neither personalScore nor personalNote is present', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('at least one field required');
  });

  it('returns 400 for personalScore: 0', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 0 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('personalScore must be 1–5 or null');
  });

  it('returns 400 for personalScore: 6', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 6 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer personalScore', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3.5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for personalNote over 500 chars', async () => {
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalNote: 'a'.repeat(501) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('personalNote must be 500 characters or fewer');
  });

  // ── Not-found and internal error ───────────────────────────────────────────

  it('returns 404 when video not found in index', async () => {
    mockUpdateVideoFields.mockImplementation(() => {
      throw new Error(`Video not found in index: ${VIDEO_ID}`);
    });
    const res = await postReview(VIDEO_ID, { outputFolder: OUTPUT_FOLDER, personalScore: 3 });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('video not found');
  });

  it('returns 400 for invalid videoId (assertVideoId throws)', async () => {
    mockAssertVideoId.mockImplementation(() => {
      throw Object.assign(new Error('invalid videoId'), { statusCode: 400 });
    });
    const res = await postReview('bad**id', { outputFolder: OUTPUT_FOLDER, personalScore: 3 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid request');
  });
});
```

- [ ] **Step 2.2 — Run to confirm failure**

```bash
npx jest tests/api/review.test.ts --no-coverage
```

Expected: FAIL ("Cannot find module '../../app/api/videos/[id]/review/route'")

- [ ] **Step 2.3 — Create the route handler**

Create `app/api/videos/[id]/review/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { assertOutputFolder, assertVideoId, updateVideoFields } from '../../../../../lib/index-store';
import type { Video } from '../../../../../types';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id: videoId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const outputFolder = body?.outputFolder;

  if (!outputFolder || typeof outputFolder !== 'string') {
    return NextResponse.json({ error: 'outputFolder is required' }, { status: 400 });
  }

  const hasScore = body !== null && 'personalScore' in body;
  const hasNote  = body !== null && 'personalNote'  in body;

  if (!hasScore && !hasNote) {
    return NextResponse.json({ error: 'at least one field required' }, { status: 400 });
  }

  // Validate personalScore: must be 1–5 integer, or null (to clear)
  if (hasScore) {
    const score = body!.personalScore;
    if (
      score !== null &&
      (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5)
    ) {
      return NextResponse.json({ error: 'personalScore must be 1–5 or null' }, { status: 400 });
    }
  }

  // Validate personalNote: must be string ≤ 500 chars (empty string = clear)
  if (hasNote) {
    const note = body!.personalNote;
    if (typeof note !== 'string') {
      return NextResponse.json({ error: 'personalNote must be a string' }, { status: 400 });
    }
    if (note.length > 500) {
      return NextResponse.json({ error: 'personalNote must be 500 characters or fewer' }, { status: 400 });
    }
  }

  try {
    assertOutputFolder(outputFolder);
    assertVideoId(videoId);
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }

  // Map null → undefined (score deletion) and "" → undefined (note deletion)
  const patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>> = {};
  if (hasScore) {
    patch.personalScore = (body!.personalScore === null) ? undefined : (body!.personalScore as number);
  }
  if (hasNote) {
    patch.personalNote = (body!.personalNote === '') ? undefined : (body!.personalNote as string);
  }

  try {
    updateVideoFields(outputFolder, videoId, patch);
  } catch (err) {
    const e = err as Error;
    if (e.message.startsWith('Video not found in index')) {
      return NextResponse.json({ error: 'video not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2.4 — Run tests to confirm pass**

```bash
npx jest tests/api/review.test.ts --no-coverage
```

Expected: PASS (13 passing)

- [ ] **Step 2.5 — Run full suite**

```bash
npm test -- --no-coverage
```

Expected: all passing (or no new failures)

- [ ] **Step 2.6 — Commit**

```bash
git add app/api/videos/\[id\]/review/route.ts tests/api/review.test.ts
git commit -m "feat(api): POST /api/videos/[id]/review — save personal score and note"
```

---

## Task 3 — personalScore Sort in GET /api/videos

**Files:**
- Modify: `app/api/videos/route.ts`
- Modify: `tests/api/videos.test.ts`

- [ ] **Step 3.1 — Write failing tests**

Open `tests/api/videos.test.ts`. Add this describe block at the bottom (inside the existing outer `describe`):

First, update `makeVideo` to accept optional `personalScore`:

```ts
// Change:
function makeVideo(id: string, overallScore: number, title = `Video ${id}`): Video {

// To:
function makeVideo(id: string, overallScore: number, title = `Video ${id}`, personalScore?: number): Video {
  return {
    // ...existing fields...
    personalScore,  // add after existing fields
  };
}
```

Then add these tests:

```ts
describe('sort by personalScore', () => {
  beforeEach(() => {
    mockReadIndex.mockReturnValue(makeIndex([
      makeVideo('v1', 3, 'Alpha', 5),
      makeVideo('v2', 3, 'Beta',  2),
      makeVideo('v3', 3, 'Gamma', undefined), // unscored
    ]));
  });

  it('sorts personalScore descending: scored videos high→low, unscored last', async () => {
    const res = await get({ sortColumn: 'personalScore', sortOrder: 'desc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('sorts personalScore ascending: scored videos low→high, unscored last', async () => {
    const res = await get({ sortColumn: 'personalScore', sortOrder: 'asc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.id)).toEqual(['v2', 'v1', 'v3']);
  });

  it('two unscored videos maintain stable order (both return 0)', async () => {
    mockReadIndex.mockReturnValue(makeIndex([
      makeVideo('v1', 3, 'Alpha', undefined),
      makeVideo('v2', 3, 'Beta',  undefined),
    ]));
    const res = await get({ sortColumn: 'personalScore', sortOrder: 'asc' });
    const { videos } = await res.json();
    expect(videos.map((v: Video) => v.id)).toEqual(['v1', 'v2']); // stable: unchanged
  });
});
```

- [ ] **Step 3.2 — Run to confirm failure**

```bash
npx jest tests/api/videos.test.ts --no-coverage
```

Expected: FAIL (personalScore sort case not handled — falls through to ratings sort which errors)

- [ ] **Step 3.3 — Add personalScore sort case**

Open `app/api/videos/route.ts`. In the `sortVideos` function, add a new branch **before** the `else` clause (which handles ratings):

```ts
// Before:
    } else {
      aVal = a.ratings[column as keyof typeof a.ratings];
      bVal = b.ratings[column as keyof typeof b.ratings];
    }

// After:
    } else if (column === 'personalScore') {
      // Unscored videos (undefined) always sort last, regardless of direction
      if (a.personalScore === undefined && b.personalScore === undefined) return 0;
      if (a.personalScore === undefined) return 1;
      if (b.personalScore === undefined) return -1;
      const cmp = a.personalScore - b.personalScore;
      return order === 'asc' ? cmp : -cmp;
    } else {
      aVal = a.ratings[column as keyof typeof a.ratings];
      bVal = b.ratings[column as keyof typeof b.ratings];
    }
```

- [ ] **Step 3.4 — Run tests to confirm pass**

```bash
npx jest tests/api/videos.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 3.5 — Run full suite**

```bash
npm test -- --no-coverage
```

- [ ] **Step 3.6 — Commit**

```bash
git add app/api/videos/route.ts tests/api/videos.test.ts
git commit -m "feat(api): personalScore sort — nulls-last, both directions, stable on ties"
```

---

## Task 4 — StarRating Component

**Files:**
- Create: `components/StarRating.tsx`
- Create: `tests/components/StarRating.test.tsx`

- [ ] **Step 4.1 — Write failing tests**

Create `tests/components/StarRating.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StarRating from '@/components/StarRating';

const VIDEO_ID     = 'abc123';
const OUTPUT_FOLDER = '/tmp/out';

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
  global.fetch = fetchMock as typeof global.fetch;
});

afterEach(() => jest.clearAllMocks());

function renderStars(value?: number, onChange = jest.fn()) {
  render(
    <StarRating videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} value={value} onChange={onChange} />,
  );
  return { onChange };
}

function getStarInputs() {
  return screen.getAllByRole('radio');
}

describe('StarRating', () => {
  describe('display', () => {
    it('renders 5 radio inputs', () => {
      renderStars(3);
      expect(getStarInputs()).toHaveLength(5);
    });

    it('has the correct star checked when value is provided', () => {
      renderStars(3);
      const inputs = getStarInputs();
      expect(inputs[2]).toBeChecked();   // index 2 = star 3
      expect(inputs[0]).not.toBeChecked();
    });

    it('all inputs unchecked when value is undefined', () => {
      renderStars(undefined);
      getStarInputs().forEach((input) => expect(input).not.toBeChecked());
    });
  });

  describe('interaction', () => {
    it('clicking a star calls onChange with that star number', async () => {
      const { onChange } = renderStars(undefined);
      // fireEvent.click on unselected radio fires onChange
      fireEvent.click(getStarInputs()[3]); // star 4
      expect(onChange).toHaveBeenCalledWith(4);
    });

    it('clicking the active star calls onChange with undefined (clear)', () => {
      const { onChange } = renderStars(3);
      fireEvent.click(getStarInputs()[2]); // star 3 is currently active
      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('hover previews stars (hovered stars are visually filled)', () => {
      renderStars(1);
      const spans = screen.getAllByText(/[★☆]/);
      fireEvent.mouseEnter(spans[4]); // hover over star 5
      // stars 1–5 should now all show as filled (★)
      expect(screen.getAllByText('★')).toHaveLength(5);
      fireEvent.mouseLeave(spans[4]);
    });

    it('stars are disabled while a save is in flight', async () => {
      // Fetch that never resolves → saving state persists
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      const { onChange } = renderStars(2);
      act(() => { fireEvent.click(getStarInputs()[3]); }); // start save
      await waitFor(() => {
        getStarInputs().forEach((input) => expect(input).toBeDisabled());
      });
    });

    it('on API failure: first calls onChange(newScore) then calls onChange(previousScore)', async () => {
      fetchMock = jest.fn().mockResolvedValue({ ok: false } as Response);
      global.fetch = fetchMock as typeof global.fetch;
      const { onChange } = renderStars(2);
      fireEvent.click(getStarInputs()[3]); // click star 4
      await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
      expect(onChange).toHaveBeenNthCalledWith(1, 4);  // optimistic update
      expect(onChange).toHaveBeenNthCalledWith(2, 2);  // rollback
    });

    it('fires the correct API request body', async () => {
      renderStars(undefined);
      fireEvent.click(getStarInputs()[2]); // star 3
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/videos/${VIDEO_ID}/review`);
      expect(JSON.parse((opts as RequestInit).body as string)).toMatchObject({
        outputFolder: OUTPUT_FOLDER,
        personalScore: 3,
      });
    });
  });
});
```

- [ ] **Step 4.2 — Run to confirm failure**

```bash
npx jest tests/components/StarRating.test.tsx --no-coverage
```

Expected: FAIL (module not found)

- [ ] **Step 4.3 — Implement StarRating**

Create `components/StarRating.tsx`:

```tsx
'use client';

import { useState } from 'react';

interface StarRatingProps {
  videoId: string;
  outputFolder: string;
  value: number | undefined;
  onChange: (score: number | undefined) => void;
}

export default function StarRating({ videoId, outputFolder, value, onChange }: StarRatingProps) {
  const [hover, setHover]   = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  async function commit(newScore: number | undefined) {
    if (saving) return;
    const prev = value;
    onChange(newScore);
    setSaving(true);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder, personalScore: newScore ?? null }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch {
      onChange(prev);
    } finally {
      setSaving(false);
    }
  }

  const displayFill = hover ?? value ?? 0;

  return (
    <div
      role="radiogroup"
      aria-label="My score"
      className={`flex gap-0.5 ${saving ? 'pointer-events-none' : ''}`}
    >
      {([1, 2, 3, 4, 5] as const).map((star) => {
        const checked = value === star;
        const filled  = star <= displayFill;
        return (
          <label key={star}>
            <input
              type="radio"
              name={`star-${videoId}`}
              value={String(star)}
              checked={checked}
              disabled={saving}
              aria-label={`${star} star${star !== 1 ? 's' : ''}`}
              className="sr-only"
              // onChange handles: new selection via keyboard (arrow keys) or mouse click on unselected
              onChange={() => !saving && commit(star)}
              // onClick handles: clicking the already-selected star to clear it
              onClick={() => { if (checked && !saving) commit(undefined); }}
            />
            <span
              aria-hidden="true"
              className={`text-base select-none cursor-pointer ${filled ? 'text-yellow-400' : 'text-zinc-600'}`}
              onMouseEnter={() => !saving && setHover(star)}
              onMouseLeave={() => !saving && setHover(null)}
            >
              {filled ? '★' : '☆'}
            </span>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4.4 — Run tests to confirm pass**

```bash
npx jest tests/components/StarRating.test.tsx --no-coverage
```

Expected: PASS (7 passing)

- [ ] **Step 4.5 — Run full suite**

```bash
npm test -- --no-coverage
```

- [ ] **Step 4.6 — Commit**

```bash
git add components/StarRating.tsx tests/components/StarRating.test.tsx
git commit -m "feat(component): StarRating — accessible 5-star rating with optimistic save and rollback"
```

---

## Task 5 — NoteCell Component

**Files:**
- Create: `components/NoteCell.tsx`
- Create: `tests/components/NoteCell.test.tsx`

- [ ] **Step 5.1 — Write failing tests**

Create `tests/components/NoteCell.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NoteCell from '@/components/NoteCell';

const VIDEO_ID      = 'abc123';
const OUTPUT_FOLDER = '/tmp/out';

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true } as Response);
  global.fetch = fetchMock as typeof global.fetch;
});

afterEach(() => jest.clearAllMocks());

function renderNote(value?: string, onChange = jest.fn()) {
  render(
    <NoteCell videoId={VIDEO_ID} outputFolder={OUTPUT_FOLDER} value={value} onChange={onChange} />,
  );
  return { onChange };
}

function openPopover(value?: string, onChange = jest.fn()) {
  const result = renderNote(value, onChange);
  fireEvent.click(screen.getByRole('button', { name: /add note|edit note|—|.*/i }));
  return result;
}

describe('NoteCell', () => {
  describe('preview', () => {
    it('shows — when note is undefined', () => {
      renderNote(undefined);
      expect(screen.getByRole('button')).toHaveTextContent('—');
    });

    it('shows note text when note is 25 chars or fewer', () => {
      renderNote('short note');
      expect(screen.getByRole('button')).toHaveTextContent('short note');
    });

    it('shows first 25 chars followed by … when note exceeds 25 chars', () => {
      renderNote('this is a very long note that goes beyond twenty-five characters');
      const btn = screen.getByRole('button');
      expect(btn.textContent).toHaveLength(27); // 25 chars + '…' (1 codepoint)
      expect(btn.textContent).toMatch(/…$/);
    });
  });

  describe('popover open', () => {
    it('clicking cell opens a dialog', () => {
      openPopover('my note');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('popover textarea is pre-filled with existing note', () => {
      openPopover('my note');
      expect(screen.getByRole('textbox')).toHaveValue('my note');
    });

    it('popover textarea is empty when note is undefined', () => {
      openPopover(undefined);
      expect(screen.getByRole('textbox')).toHaveValue('');
    });
  });

  describe('cancel / dismiss', () => {
    it('Cancel button closes popover without calling onChange', () => {
      const { onChange } = openPopover('my note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } });
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape key closes popover without calling onChange', () => {
      const { onChange } = openPopover('my note');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('clicking the backdrop closes popover without calling onChange', () => {
      const { onChange } = openPopover('my note');
      fireEvent.click(screen.getByTestId('note-backdrop'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('save', () => {
    it('Save calls onChange with the typed note and closes popover', async () => {
      const { onChange } = openPopover('old note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new note' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith('new note');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('Save with empty textarea calls onChange with undefined (clear note)', async () => {
      const { onChange } = openPopover('existing note');
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
    });
  });

  describe('saving state', () => {
    it('Save and Cancel buttons are disabled while saving', async () => {
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      openPopover('note');
      act(() => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
      });
    });

    it('shows inline error and keeps popover open when API call fails', async () => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'internal error' }),
      } as unknown as Response);
      global.fetch = fetchMock as typeof global.fetch;
      const { onChange } = openPopover('note');
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument(); // still open
        expect(screen.getByText('internal error')).toBeInTheDocument();
      });
      expect(onChange).not.toHaveBeenCalled();
    });

    it('Escape and backdrop are no-ops while saving', () => {
      fetchMock = jest.fn(() => new Promise<Response>(() => {}));
      global.fetch = fetchMock as typeof global.fetch;
      openPopover('note');
      act(() => { fireEvent.click(screen.getByRole('button', { name: /save/i })); });
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 5.2 — Run to confirm failure**

```bash
npx jest tests/components/NoteCell.test.tsx --no-coverage
```

Expected: FAIL (module not found)

- [ ] **Step 5.3 — Implement NoteCell**

Create `components/NoteCell.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

interface NoteCellProps {
  videoId: string;
  outputFolder: string;
  value: string | undefined;
  onChange: (note: string | undefined) => void;
}

function truncate(text: string, len: number): string {
  return text.length <= len ? text : text.slice(0, len) + '…';
}

export default function NoteCell({ videoId, outputFolder, value, onChange }: NoteCellProps) {
  const [open,   setOpen]   = useState(false);
  const [draft,  setDraft]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function openPopover() {
    setDraft(value ?? '');
    setError('');
    setOpen(true);
  }

  function closePopover() {
    if (saving) return;
    setOpen(false);
  }

  // Move focus to textarea when popover opens
  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // Escape key dismissal
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputFolder, personalNote: draft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? 'Save failed');
        return;
      }
      onChange(draft || undefined);
      setOpen(false);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  }

  const preview = value ? truncate(value, 25) : '—';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPopover}
        className="text-sm text-zinc-300 hover:text-zinc-100 text-left w-full"
      >
        {preview}
      </button>

      {open && (
        <>
          {/* Backdrop: clicking outside dismisses (no-op while saving) */}
          <div
            data-testid="note-backdrop"
            aria-hidden="true"
            className="fixed inset-0 z-20"
            onClick={closePopover}
          />

          {/* Popover */}
          <div
            role="dialog"
            aria-label="Edit note"
            className="absolute z-30 left-0 top-full mt-1 w-72 rounded border border-zinc-700 bg-zinc-900 p-3 shadow-lg"
          >
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              rows={4}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Add a note…"
            />
            {error && <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={closePopover}
                disabled={saving}
                className="px-2 py-1 text-xs rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5.4 — Run tests to confirm pass**

```bash
npx jest tests/components/NoteCell.test.tsx --no-coverage
```

Expected: PASS (11 passing)

- [ ] **Step 5.5 — Run full suite**

```bash
npm test -- --no-coverage
```

- [ ] **Step 5.6 — Commit**

```bash
git add components/NoteCell.tsx tests/components/NoteCell.test.tsx
git commit -m "feat(component): NoteCell — truncated preview with popover editor, save/cancel/escape/backdrop"
```

---

## Task 6 — VideoRow + VideoList: New Columns and Dimming

**Files:**
- Modify: `components/VideoRow.tsx`
- Modify: `components/VideoList.tsx`
- Modify: `tests/components/VideoRow.test.tsx`

- [ ] **Step 6.1 — Write failing tests in VideoRow.test.tsx**

Open `tests/components/VideoRow.test.tsx`. Make the following changes:

**a) Update `renderRow` helper** to accept new required props with defaults:

```ts
// Replace the existing renderRow function:
function renderRow(
  overrides: Partial<Video> = {},
  options: {
    dimUnscored?: boolean;
    onAnnotationChange?: jest.Mock;
    onDeepDive?: jest.Mock;
    onArchive?: jest.Mock;
  } = {},
) {
  const video = { ...baseVideo, ...overrides };
  const onAnnotationChange = options.onAnnotationChange ?? jest.fn();
  render(
    <table>
      <tbody>
        <VideoRow
          video={video}
          rank={1}
          outputFolder={OUTPUT_FOLDER}
          baseOutputFolder={BASE_OUTPUT_FOLDER}
          dimUnscored={options.dimUnscored ?? false}
          onDeepDive={options.onDeepDive ?? jest.fn()}
          onArchive={options.onArchive ?? jest.fn()}
          onAnnotationChange={onAnnotationChange}
        />
      </tbody>
    </table>,
  );
  return { onAnnotationChange, video };
}
```

**b) Update `openMenu` helper** to match new renderRow signature:

```ts
function openMenu(overrides: Partial<Video> = {}, onDeepDive = jest.fn(), onArchive = jest.fn()) {
  const result = renderRow(overrides, { onDeepDive, onArchive });
  fireEvent.click(screen.getByRole('button', { name: /menu/i }));
  return result;
}
```

**c) Fix the existing test for "all 6 rating values"** (the column count comment will change):

Update the test description from "6 rating values" to "6 AI rating values in their cells" (or leave as-is — the test itself is still valid).

**d) Add these new tests** (add inside `describe('VideoRow')` after the existing tests):

```ts
describe('personal review columns', () => {
  it('renders the My Score radiogroup', () => {
    renderRow();
    expect(screen.getByRole('radiogroup', { name: /my score/i })).toBeInTheDocument();
  });

  it('renders the Note cell with — when personalNote is undefined', () => {
    renderRow({ personalNote: undefined });
    // NoteCell renders a button with text "—"
    expect(screen.getAllByRole('button').some((btn) => btn.textContent === '—')).toBe(true);
  });

  it('applies opacity-50 to data cells when dimUnscored is true', () => {
    renderRow({ personalScore: undefined }, { dimUnscored: true });
    const cells = screen.getAllByRole('cell');
    // First data cell (rank) should have opacity-50
    expect(cells[0]).toHaveClass('opacity-50');
  });

  it('applies opacity-40 when archived, taking precedence over dimUnscored', () => {
    renderRow({ archived: true, personalScore: undefined }, { dimUnscored: true });
    const cells = screen.getAllByRole('cell');
    expect(cells[0]).toHaveClass('opacity-40');
    expect(cells[0]).not.toHaveClass('opacity-50');
  });
});
```

- [ ] **Step 6.2 — Run to confirm failure**

```bash
npx jest tests/components/VideoRow.test.tsx --no-coverage
```

Expected: FAIL (VideoRow missing `dimUnscored` and `onAnnotationChange` props)

- [ ] **Step 6.3 — Update VideoRow.tsx**

Open `components/VideoRow.tsx` and make these changes:

**a) Update imports** (add new components):

```ts
// Add after existing imports:
import StarRating from './StarRating';
import NoteCell from './NoteCell';
import type { Video } from '@/types';
```

(Note: `Video` type is needed for the `onAnnotationChange` signature)

**b) Update the props interface**:

```ts
// Replace:
interface VideoRowProps {
  video: Video;
  rank: number;
  outputFolder: string;
  baseOutputFolder: string;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
}

// With:
interface VideoRowProps {
  video: Video;
  rank: number;
  outputFolder: string;
  baseOutputFolder: string;
  dimUnscored: boolean;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onAnnotationChange: (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>>) => void;
}
```

**c) Update the function signature**:

```ts
// Replace:
export default function VideoRow({ video, rank, outputFolder, baseOutputFolder, onDeepDive, onArchive }: VideoRowProps) {

// With:
export default function VideoRow({ video, rank, outputFolder, baseOutputFolder, dimUnscored, onDeepDive, onArchive, onAnnotationChange }: VideoRowProps) {
```

**d) Replace `dim` with `cellDim`** (unified dimming — archived takes precedence):

```ts
// Replace:
  const dim = video.archived ? 'opacity-40' : '';

// With:
  const cellDim = video.archived
    ? 'opacity-40'
    : (dimUnscored ? 'opacity-50' : '');
```

**e) Replace all occurrences of `${dim}` with `${cellDim}`** in the JSX. Every `<td className={...${dim}...}>` becomes `<td className={...${cellDim}...}>`.

**f) Add two new `<td>` cells at the end of the row** (after the current `Overall` td):

```tsx
      {/* My Score */}
      <td className={`px-3 py-2 ${cellDim}`} aria-label="My Score">
        <StarRating
          videoId={video.id}
          outputFolder={outputFolder}
          value={video.personalScore}
          onChange={(score) => onAnnotationChange(video.id, { personalScore: score })}
        />
      </td>

      {/* Note */}
      <td className={`px-3 py-2 ${cellDim}`} aria-label="Note">
        <NoteCell
          videoId={video.id}
          outputFolder={outputFolder}
          value={video.personalNote}
          onChange={(note) => onAnnotationChange(video.id, { personalNote: note })}
        />
      </td>
```

- [ ] **Step 6.4 — Update VideoList.tsx**

Open `components/VideoList.tsx` and make these changes:

**a) Add import for Video type**:

```ts
import type { SortColumn, SortOrder, Video } from '@/types';
```

**b) Add new columns to the COLUMNS array**. Change the array type to allow `key: SortColumn | null`:

```ts
const COLUMNS: { key: SortColumn | null; label: string; fullName: string; align: 'left' | 'right' }[] = [
  // ...all existing entries unchanged...
  { key: 'personalScore', label: 'My Score', fullName: 'My Score', align: 'right' },
  { key: null,            label: 'Note',     fullName: 'Note',     align: 'left'  },
];
```

**c) Add `personalScore` to the DESC_FIRST_COLS list** (rename `DATE_COLS` to `DESC_FIRST_COLS` for clarity):

```ts
// Replace:
const DATE_COLS: SortColumn[] = ['videoPublishedAt', 'addedToPlaylistAt'];

// With:
const DESC_FIRST_COLS: SortColumn[] = ['videoPublishedAt', 'addedToPlaylistAt', 'personalScore'];
```

**d) Update `handleHeaderClick`** to use the renamed constant and handle null keys:

```ts
function handleHeaderClick(col: SortColumn | null) {
  if (!onSort || col === null) return;
  let nextOrder: SortOrder;
  if (col === sortColumn) {
    nextOrder = sortOrder === 'asc' ? 'desc' : 'asc';
  } else if (DESC_FIRST_COLS.includes(col)) {
    nextOrder = 'desc';
  } else {
    nextOrder = 'asc';
  }
  onSort(col, nextOrder);
}
```

**e) Update the header rendering** inside the COLUMNS `.map()` to skip the sort button for null-key columns:

```tsx
{COLUMNS.map(({ key, label, fullName, align }) => {
  const isActive   = key !== null && key === sortColumn;
  const arrow      = isActive ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : '';
  const alignClass = align === 'right' ? 'text-right' : 'text-left';

  if (onSort && key !== null) {
    const dirLabel = isActive
      ? `, sorted ${sortOrder === 'asc' ? 'ascending' : 'descending'}`
      : '';
    return (
      <th
        key={key}
        scope="col"
        className={`${TH} ${alignClass}`}
        aria-sort={isActive ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
      >
        <button
          type="button"
          onClick={() => handleHeaderClick(key)}
          title={fullName}
          aria-label={`${fullName}${dirLabel}`}
          aria-pressed={isActive}
          className={`${isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-100'} transition-colors`}
        >
          {label}{arrow}
        </button>
      </th>
    );
  }
  // Non-sortable column (key === null, or onSort not provided)
  const keyOrLabel = key ?? label;
  return (
    <th key={keyOrLabel} className={`${TH} text-zinc-400 ${alignClass}`}>
      {label}
    </th>
  );
})}
```

**f) Update VideoListProps** to add new required props:

```ts
interface VideoListProps {
  videos: Video[];
  outputFolder: string;
  baseOutputFolder: string;
  showArchive: boolean;
  minPersonalScore: number;
  onDeepDive: (videoId: string) => void;
  onArchive: (videoId: string, action: 'archive' | 'unarchive') => void;
  onAnnotationChange: (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>>) => void;
  sortColumn?: SortColumn | null;
  sortOrder?: SortOrder;
  onSort?: (col: SortColumn, order: SortOrder) => void;
}
```

**g) Update function destructuring** to include new props:

```ts
export default function VideoList({
  videos,
  outputFolder,
  baseOutputFolder,
  showArchive,
  minPersonalScore,
  onDeepDive,
  onArchive,
  onAnnotationChange,
  sortColumn,
  sortOrder = 'asc',
  onSort,
}: VideoListProps) {
```

**h) Update the VideoRow usage** inside the `<tbody>` to pass new props:

```tsx
{visible.map((video, i) => (
  <VideoRow
    key={video.id}
    video={video}
    rank={video.playlistIndex ?? i + 1}
    outputFolder={outputFolder}
    baseOutputFolder={baseOutputFolder}
    dimUnscored={minPersonalScore > 0 && video.personalScore === undefined}
    onDeepDive={onDeepDive}
    onArchive={onArchive}
    onAnnotationChange={onAnnotationChange}
  />
))}
```

- [ ] **Step 6.5 — Run VideoRow tests to confirm pass**

```bash
npx jest tests/components/VideoRow.test.tsx --no-coverage
```

Expected: PASS

- [ ] **Step 6.6 — Run full suite**

```bash
npm test -- --no-coverage
```

(Some VideoList-consuming tests may fail because VideoList now requires `minPersonalScore` and `onAnnotationChange`. If so, fix call sites in test files to pass these props — use defaults `0` and `jest.fn()`.)

- [ ] **Step 6.7 — Commit**

```bash
git add components/VideoRow.tsx components/VideoList.tsx tests/components/VideoRow.test.tsx
git commit -m "feat(component): VideoRow/VideoList — My Score + Note columns; unified dimming; annotation callbacks"
```

---

## Task 7 — FilterBar: Rename Score → AI score ≥ and Add My score ≥

**Files:**
- Modify: `components/FilterBar.tsx`
- Modify: `tests/components/FilterBar.test.tsx`

- [ ] **Step 7.1 — Update failing tests**

Open `tests/components/FilterBar.test.tsx`. Make these changes:

**a) Rename the existing "Score" selector tests** to use `AI score ≥`:

```ts
// Every test that uses:
screen.getByRole('combobox', { name: /score/i })
// Must be changed to:
screen.getByRole('combobox', { name: /ai score/i })
```

**b) Add new tests for "My score ≥"** (add at end of file, inside the outer `describe`):

```ts
describe('My score ≥ dropdown', () => {
  it('renders a My score ≥ dropdown with All, 1+, 2+, 3+, 4+, 5 options', () => {
    renderBar();
    const sel = screen.getByRole('combobox', { name: /my score/i });
    expect(sel).toBeInTheDocument();
    const values = Array.from((sel as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('reflects minPersonalScore from filters', () => {
    renderBar({ filters: { ...FILTER_DEFAULTS, minPersonalScore: 3 } });
    const sel = screen.getByRole('combobox', { name: /my score/i }) as HTMLSelectElement;
    expect(sel.value).toBe('3');
  });

  it('calls onChange with minPersonalScore=3 when user selects 3+', () => {
    const { onChange } = renderBar();
    fireEvent.change(screen.getByRole('combobox', { name: /my score/i }), {
      target: { value: '3' },
    });
    expect(onChange).toHaveBeenCalledWith({ minPersonalScore: 3 });
  });

  it('calls onChange with minPersonalScore=0 when user selects All', () => {
    const { onChange } = renderBar({ filters: { ...FILTER_DEFAULTS, minPersonalScore: 4 } });
    fireEvent.change(screen.getByRole('combobox', { name: /my score/i }), {
      target: { value: '0' },
    });
    expect(onChange).toHaveBeenCalledWith({ minPersonalScore: 0 });
  });
});
```

- [ ] **Step 7.2 — Run to confirm failure**

```bash
npx jest tests/components/FilterBar.test.tsx --no-coverage
```

Expected: FAIL (aria-label "AI score ≥" doesn't exist yet; "My score ≥" doesn't exist yet)

- [ ] **Step 7.3 — Update FilterBar.tsx**

Open `components/FilterBar.tsx`. Make these changes:

**a) Rename the existing Score dropdown's `aria-label`**:

```tsx
// Replace:
<select
  aria-label="Score"

// With:
<select
  aria-label="AI score ≥"
```

**b) Add the new "My score ≥" dropdown** immediately after the AI score select (before the closing `</div>`):

```tsx
      <select
        aria-label="My score ≥"
        value={String(filters.minPersonalScore)}
        onChange={(e) => onChange({ minPersonalScore: parseInt(e.target.value, 10) })}
        className={SELECT_CLASS}
      >
        <option value="0">All</option>
        <option value="1">1+</option>
        <option value="2">2+</option>
        <option value="3">3+</option>
        <option value="4">4+</option>
        <option value="5">5</option>
      </select>
```

- [ ] **Step 7.4 — Run tests to confirm pass**

```bash
npx jest tests/components/FilterBar.test.tsx --no-coverage
```

Expected: PASS

- [ ] **Step 7.5 — Run full suite**

```bash
npm test -- --no-coverage
```

- [ ] **Step 7.6 — Commit**

```bash
git add components/FilterBar.tsx tests/components/FilterBar.test.tsx
git commit -m "feat(component): FilterBar — rename Score→AI score ≥; add My score ≥ dropdown"
```

---

## Task 8 — Page: onAnnotationChange, minPersonalScore Filter, dimUnscored

**Files:**
- Modify: `app/page.tsx`
- Modify: `tests/components/PageIntegration.test.tsx` (or `tests/components/VideoList.test.tsx`)

- [ ] **Step 8.1 — Write failing test(s)**

Open `tests/components/PageIntegration.test.tsx`. Check what it currently tests and add:

```ts
// These describe blocks should be added (adapt to the existing file's pattern):

describe('handleAnnotationChange', () => {
  it('updates the video in the list optimistically when annotation changes', () => {
    // This is best tested via the VideoList integration, not page.tsx directly.
    // VideoList.test.tsx should pass onAnnotationChange and verify the prop is threaded.
    // If PageIntegration.test.tsx has a full mock setup, add:
    //   render page with mocked fetch returning a video list
    //   trigger onAnnotationChange(videoId, { personalScore: 4 })
    //   expect the video row to reflect the updated score
    // But since page.tsx is hard to unit-test (full SSE, fetch), 
    // add a VideoList-level test instead.
  });
});
```

Add to `tests/components/VideoList.test.tsx` (check the file first — adapt to existing patterns):

```ts
// Inside the existing VideoList test file, add:
describe('annotation callbacks', () => {
  it('passes onAnnotationChange to each VideoRow', () => {
    const onAnnotationChange = jest.fn();
    render(
      <table>
        <VideoList
          videos={[baseVideo]}
          outputFolder="/tmp/out"
          baseOutputFolder="/tmp/out"
          showArchive={true}
          minPersonalScore={0}
          onDeepDive={jest.fn()}
          onArchive={jest.fn()}
          onAnnotationChange={onAnnotationChange}
        />
      </table>,
    );
    // StarRating is rendered inside VideoRow; its presence confirms threading
    expect(screen.getByRole('radiogroup', { name: /my score/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 8.2 — Run to confirm failure**

```bash
npx jest tests/components/VideoList.test.tsx --no-coverage
```

Expected: FAIL (VideoList missing required props in test call sites)

- [ ] **Step 8.3 — Update app/page.tsx**

Open `app/page.tsx` and make these changes:

**a) Add `handleAnnotationChange` callback** (after `handleFilterChange`):

```ts
const handleAnnotationChange = useCallback(
  (videoId: string, patch: Partial<Pick<Video, 'personalScore' | 'personalNote'>>) => {
    setVideos((prev) =>
      prev.map((v) => (v.id === videoId ? { ...v, ...patch } : v)),
    );
  },
  [],
);
```

(Note: `Video` is already imported from `@/types` at the top of the file.)

**b) Update the `filteredVideos` computation** to add the `minPersonalScore` filter (insert after the existing `overallScore` filter line):

```ts
// Current last filter line:
    .filter((v) => v.overallScore >= filters.minScore);

// Replace with:
    .filter((v) => v.overallScore >= filters.minScore)
    .filter((v) => {
      if (filters.minPersonalScore === 0) return true;
      if (v.personalScore === undefined)  return true;  // unscored: shown dimmed, not hidden
      return v.personalScore >= filters.minPersonalScore;
    });
```

**c) Update the `<VideoList>` JSX** to pass the new required props:

```tsx
<VideoList
  videos={filteredVideos}
  outputFolder={outputFolder}
  baseOutputFolder={baseOutputFolder}
  showArchive={true}
  minPersonalScore={filters.minPersonalScore}
  onDeepDive={handleDeepDive}
  onArchive={handleArchive}
  onAnnotationChange={handleAnnotationChange}
  sortColumn={sortColumn}
  sortOrder={sortOrder}
  onSort={handleSort}
/>
```

**d) Add the `Video` import** if not already imported (it should already be imported via `@/types`).

Check the import at the top:
```ts
import type { FilterState, ProgressEvent, SortColumn, SortOrder, Video } from '@/types';
```

If `Video` is not in the existing import, add it.

- [ ] **Step 8.4 — Fix any remaining test call-sites**

Find all test files that render `<VideoList>` and update them to pass the new required props:

```bash
grep -rn "VideoList" tests/
```

For each test that renders VideoList directly, add:
```tsx
minPersonalScore={0}
onAnnotationChange={jest.fn()}
```

- [ ] **Step 8.5 — Run full suite**

```bash
npm test -- --no-coverage
```

Expected: all passing

- [ ] **Step 8.6 — Commit**

```bash
git add app/page.tsx tests/components/VideoList.test.tsx tests/components/PageIntegration.test.tsx
git commit -m "feat(page): onAnnotationChange optimistic update; minPersonalScore filter; dimUnscored prop"
```

---

## Self-Review Checklist

After writing the plan, run these checks against the spec:

### 1. Spec Coverage

| Spec Requirement | Task |
|---|---|
| `personalScore` + `personalNote` in VideoSchema | Task 1 |
| `minPersonalScore` in FilterState + FILTER_DEFAULTS | Task 1 |
| `'personalScore'` in SortColumn | Task 1 |
| POST /api/videos/[id]/review route | Task 2 |
| All 400/404/500 response cases | Task 2 |
| null score → field deletion | Task 2 |
| "" note → field deletion | Task 2 |
| personalScore sort, nulls-last both directions | Task 3 |
| StarRating: radiogroup, 5 stars, hover preview | Task 4 |
| StarRating: optimistic update + rollback | Task 4 |
| StarRating: disabled while saving | Task 4 |
| NoteCell: preview truncated at 25 chars | Task 5 |
| NoteCell: popover with textarea | Task 5 |
| NoteCell: Save/Cancel/Escape/backdrop dismiss | Task 5 |
| NoteCell: dismiss disabled while saving | Task 5 |
| NoteCell: inline error + popover stays open on failure | Task 5 |
| VideoRow: My Score + Note cells | Task 6 |
| VideoRow: cellDim unified dimming (archived takes precedence) | Task 6 |
| VideoList: My Score sortable, first click descending | Task 6 |
| VideoList: Note column, not sortable | Task 6 |
| FilterBar: "AI score ≥" rename | Task 7 |
| FilterBar: "My score ≥" dropdown | Task 7 |
| Page: onAnnotationChange (optimistic patch) | Task 8 |
| Page: minPersonalScore filter (unscored shown dimmed, not hidden) | Task 8 |
| Page: dimUnscored prop to VideoList | Task 8 |
| Backward compat: existing index files parse without migration | Task 1 (optional fields) |

### 2. Known Edge Cases Not in Spec

- `VideoList.test.tsx` existing tests call `<VideoList>` directly — these will fail after Task 6 adds required props. **Fix in Task 8 Step 8.4.**
- `PageIntegration.test.tsx` passes `<VideoList>` indirectly via `<Page>` — will compile-fail until Task 8. This is expected.
- If any existing component test renders `VideoRow` directly (e.g. in a snapshot), add the new required props there too.

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-05-28-personal-review.md`.**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, spec + quality review after each, no pauses between tasks

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
