# Playlist Picker (A recent + B channel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "paste the exact playlist URL" field with a picker offering recent playlists (from local index files) and a channel's public playlists (via the YouTube API key), and persist + display the human playlist name instead of the `list=` id.

**Architecture:** A pluggable playlist-source seam (`lib/playlists/`) where every source returns a normalized `PlaylistOption`. Two providers now — `recent` (pure fs) and `channel` (YouTube API) — behind thin GET routes. A `playlistTitle` field is persisted to `playlist-index.json` at ingest and backfilled for existing playlists. The picker UI (recent combobox + channel modal) writes a selected playlist's URL into the existing Header URL field; the existing ingest flow is unchanged. A third source (OAuth, roadmap item C) can be added as another provider without touching the UI.

**Tech Stack:** Next.js (App Router), TypeScript, React, `googleapis`, Zod (index schema), Jest + ts-jest (unit/component), @testing-library/react, Playwright (E2E), Tailwind (zinc palette).

**Spec:** `docs/superpowers/specs/2026-06-30-playlist-picker-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing Next.js route/handler code** (per AGENTS.md — this Next.js has breaking changes vs training data).
- **Test layout (this repo, verified `jest.config.ts:11-17`):** tests live under `tests/lib/**/*.test.ts`, `tests/api/**/*.test.ts`, `tests/scripts/**/*.test.ts`, `tests/components/**/*.test.tsx` — **never** beside source. Component tests (`.test.tsx`) MUST start with `/** @jest-environment jsdom */`. Run with plain **`npx jest <pattern>`** (config is auto-discovered — do NOT pass `-c jest.config.js`). Test imports are relative from the test's dir (e.g. `tests/api/x.test.ts` → `../../app/...`, `../../lib/...`; `tests/lib/playlists/x.test.ts` → `../../../lib/...`). Mock with `jest.mock('<relative path>')` + `jest.mocked(...)`, mirroring `tests/api/videos.test.ts`.
- **Scripts use relative imports**, never `@/*` (ts-node CommonJS override doesn't resolve path aliases; only jest's moduleNameMapper does).
- **All output-folder / root access goes through `assertOutputFolder`** (within-home + realpath symlink guard) at every public entry point — routes AND providers (defense-in-depth).
- **Mock at the lib boundary** in unit/component tests (`lib/youtube.ts`, fs via temp dirs); E2E mocks at the API-route level. No real API calls in tests.
- **Canonical playlist URL** is `https://youtube.com/playlist?list=<id>` — strip `si=` and other params when building a URL from an id.
- **Label fallback chain (never show a bare hash):** `playlistTitle` → folder slug → `"Untitled playlist"`. The raw `list=` id is never a display label.
- **jest uses SWC and does not typecheck** — run `npx tsc --noEmit` as the real type gate after code tasks.
- **Frequent commits:** one commit per task after its tests pass.
- **Dark mode is the app default;** reuse the existing zinc palette — no new design tokens.

---

## File Structure

**Create (source):**
- `lib/playlists/types.ts` — `PlaylistOption`, `PlaylistSource`
- `lib/playlists/recent-provider.ts` — `listRecentPlaylists(root)`
- `lib/playlists/channel-provider.ts` — `listChannelPlaylists(handle, apiKey)`
- `lib/playlists/backfill-titles.ts` — `backfillPlaylistTitles(root, apiKey)`
- `scripts/backfill-playlist-titles.ts` — CLI wrapper
- `app/api/playlists/recent/route.ts`
- `app/api/playlists/channel/route.ts`
- `components/PlaylistPicker.tsx` — recent combobox (wraps the URL input)
- `components/ChannelPlaylistPanel.tsx` — channel modal

**Create (tests):**
- `tests/lib/playlists/types.test.ts`, `tests/lib/playlist-index-title.test.ts`
- `tests/lib/pipeline-playlist-title.test.ts`
- `tests/lib/playlists/recent-provider.test.ts`
- `tests/lib/youtube-channel.test.ts`
- `tests/lib/playlists/channel-provider.test.ts`
- `tests/lib/playlists/backfill-titles.test.ts`
- `tests/api/playlists-recent.test.ts`, `tests/api/playlists-channel.test.ts`
- `tests/components/PlaylistPicker.test.tsx`, `tests/components/ChannelPlaylistPanel.test.tsx`, `tests/components/Header-picker.test.tsx`
- `tests/e2e/playlist-picker.spec.ts`

**Modify:**
- `types/index.ts` — add `playlistTitle` to `PlaylistIndexSchema`
- `lib/youtube.ts` — add `resolveChannelId`, `fetchChannelPlaylists`, `buildPlaylistUrl`, `parseChannelHandle`, `ChannelNotFoundError`
- `lib/pipeline.ts` (~line 271) — stamp `playlistTitle` at ingest (omit on fetch failure)
- `app/api/videos/route.ts:114` — include `playlistTitle` in the response
- `tests/api/videos.test.ts` — add a `playlistTitle` case
- `app/page.tsx` — thread `currentPlaylistTitle` state → Header
- `components/Header.tsx` — mount picker + panel; `applyPickedUrl`; name caption
- `package.json` — add `backfill-playlist-titles` script

---

## Task 1: `PlaylistOption` type + `playlistTitle` schema field

**Files:**
- Create: `lib/playlists/types.ts`, `tests/lib/playlists/types.test.ts`, `tests/lib/playlist-index-title.test.ts`
- Modify: `types/index.ts` (PlaylistIndexSchema)

**Interfaces:**
- Produces: `type PlaylistSource = 'recent' | 'channel'`; `type PlaylistOption = { id: string; title: string; url: string; source: PlaylistSource; meta?: { videoCount?: number; channelTitle?: string; thumbnailUrl?: string } }`. `PlaylistIndex` gains optional `playlistTitle?: string`.

- [ ] **Step 1: Write the failing schema test**

```ts
// tests/lib/playlist-index-title.test.ts
import { PlaylistIndexSchema } from '../../types/index';

describe('PlaylistIndexSchema playlistTitle', () => {
  const base = { playlistUrl: 'https://youtube.com/playlist?list=PLabc', outputFolder: '/tmp/x/raw', videos: [] };
  it('accepts an index with playlistTitle', () => {
    expect(PlaylistIndexSchema.parse({ ...base, playlistTitle: 'Building with Claude' }).playlistTitle).toBe('Building with Claude');
  });
  it('accepts an index without playlistTitle (optional, legacy)', () => {
    expect(PlaylistIndexSchema.parse(base).playlistTitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest playlist-index-title`
Expected: FAIL — `playlistTitle` absent from the parsed object / stripped as unknown key.

- [ ] **Step 3: Add the field to the schema**

In `types/index.ts`, add to `PlaylistIndexSchema` (next to `playlistUrl`):

```ts
  playlistTitle: z.string().optional(),
```

- [ ] **Step 4: Create the PlaylistOption type + a shape test**

```ts
// lib/playlists/types.ts
export type PlaylistSource = 'recent' | 'channel'; // 'oauth' added by roadmap item C

export type PlaylistOption = {
  /** list= id — machine key, e.g. PLXX3HKP5ZNN3upet7agBU2W4l3jkYstZ2 */
  id: string;
  /** Human name shown in the UI. */
  title: string;
  /** Canonical https://youtube.com/playlist?list=<id> (no si=). */
  url: string;
  source: PlaylistSource;
  meta?: { videoCount?: number; channelTitle?: string; thumbnailUrl?: string };
};
```

```ts
// tests/lib/playlists/types.test.ts
import type { PlaylistOption } from '../../../lib/playlists/types';

it('PlaylistOption is constructible with required + optional fields', () => {
  const o: PlaylistOption = {
    id: 'PLabc', title: 'X', url: 'https://youtube.com/playlist?list=PLabc',
    source: 'recent', meta: { videoCount: 3 },
  };
  expect(o.source).toBe('recent');
});
```

- [ ] **Step 5: Run tests + type gate**

Run: `npx jest playlist-index-title types.test` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/playlists/types.ts tests/lib/playlists/types.test.ts types/index.ts tests/lib/playlist-index-title.test.ts
git commit -m "feat(playlists): PlaylistOption type + optional playlistTitle on index schema"
```

---

## Task 2: Persist `playlistTitle` at ingest (omit on failure)

**Files:**
- Modify: `lib/pipeline.ts` (~line 271 index stamp)
- Create: `tests/lib/pipeline-playlist-title.test.ts`

**Interfaces:**
- Consumes: `fetchPlaylistTitle(playlistId, apiKey)` (existing, `lib/youtube.ts:101`).
- Produces: after `runIngestion`, the index's top-level `playlistTitle` is the fetched title; **on fetch failure the field is omitted** (never the id — spec "never show a bare hash").

- [ ] **Step 1: Write the failing tests (success + omit-on-failure)**

```ts
// tests/lib/pipeline-playlist-title.test.ts
jest.mock('../../lib/youtube', () => ({
  fetchPlaylistVideos: jest.fn(async () => []),
  fetchPlaylistTitle: jest.fn(),
}));
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runIngestion } from '../../lib/pipeline';
import { readIndex } from '../../lib/index-store';
import { fetchPlaylistTitle } from '../../lib/youtube';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.homedir(), '.pl-title-')); process.env.YOUTUBE_API_KEY = 'k'; });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

it('stamps playlistTitle into the index on ingest', async () => {
  (fetchPlaylistTitle as jest.Mock).mockResolvedValue('Building with Claude');
  await runIngestion('https://youtube.com/playlist?list=PLabc', dir, () => {});
  expect(readIndex(dir).playlistTitle).toBe('Building with Claude');
});

it('omits playlistTitle (never the id) when the title fetch fails', async () => {
  (fetchPlaylistTitle as jest.Mock).mockRejectedValue(new Error('quota'));
  await runIngestion('https://youtube.com/playlist?list=PLabc', dir, () => {});
  expect(readIndex(dir).playlistTitle).toBeUndefined();
});
```

> Temp dir is under `os.homedir()` so `assertOutputFolder` (within-home) admits it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest pipeline-playlist-title`
Expected: FAIL — `playlistTitle` undefined in the success case.

- [ ] **Step 3: Implement the stamp**

In `lib/pipeline.ts`, replace the playlistUrl stamp block (~line 268-272):

```ts
  // Stamp playlistUrl + human title into the index before processing. Title fetch
  // degrades to OMITTED on failure (network/auth/quota) — never persists a bare id.
  const playlistId = (() => { try { return new URL(playlistUrl).searchParams.get('list'); } catch { return null; } })();
  let playlistTitle: string | undefined;
  if (playlistId) {
    try { playlistTitle = await fetchPlaylistTitle(playlistId, apiKey); } catch { playlistTitle = undefined; }
  }
  const existing = readIndex(outputFolder);
  writeIndex(outputFolder, { ...existing, playlistUrl, outputFolder, ...(playlistTitle ? { playlistTitle } : {}) });
```

Add `fetchPlaylistTitle` to the existing `./youtube` import in `lib/pipeline.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest pipeline-playlist-title`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full pipeline suite (regression)**

Run: `npx jest pipeline`
Expected: PASS — the added title fetch/stamp regresses nothing. (If existing pipeline tests don't mock `fetchPlaylistTitle`, they still pass because the stamp is best-effort; verify.)

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline.ts tests/lib/pipeline-playlist-title.test.ts
git commit -m "feat(playlists): persist playlistTitle at ingest (omit on fetch failure)"
```

---

## Task 3: Recent provider (pure fs, folder-mtime sort)

**Files:**
- Create: `lib/playlists/recent-provider.ts`, `tests/lib/playlists/recent-provider.test.ts`

**Interfaces:**
- Consumes: `PlaylistOption` (Task 1), `assertOutputFolder` (`lib/index-store.ts`).
- Produces: `listRecentPlaylists(root: string): PlaylistOption[]` — calls `assertOutputFolder(root)` first; scans `<root>/*/raw/playlist-index.json` **and** `<root>/*/playlist-index.json` (nested + flat); sorted by **playlist-folder** mtime desc; `archived/` and invalid indexes skipped; label fallback applied; `url` rebuilt canonically from the id.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/playlists/recent-provider.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listRecentPlaylists } from '../../../lib/playlists/recent-provider';

function writePlaylist(root: string, dir: string, index: object) {
  const raw = path.join(root, dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'playlist-index.json'), JSON.stringify(index));
}

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.homedir(), '.recent-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

it('returns titled options for playlists with playlistTitle', () => {
  writePlaylist(root, 'agentic', { playlistUrl: 'https://youtube.com/playlist?list=PLa&si=z', playlistTitle: 'Building with Claude', videos: [{ id: 'a' }, { id: 'b' }] });
  expect(listRecentPlaylists(root)).toEqual([
    { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 2 } },
  ]);
});

it('falls back to folder slug when playlistTitle is missing (never the id)', () => {
  writePlaylist(root, 'cs146s-modern-software', { playlistUrl: 'https://youtube.com/playlist?list=PLb', videos: [] });
  expect(listRecentPlaylists(root)[0].title).toBe('cs146s-modern-software');
});

it('sorts by playlist-folder mtime, newest first', () => {
  writePlaylist(root, 'older', { playlistUrl: 'https://youtube.com/playlist?list=PLold', playlistTitle: 'Old', videos: [] });
  writePlaylist(root, 'newer', { playlistUrl: 'https://youtube.com/playlist?list=PLnew', playlistTitle: 'New', videos: [] });
  fs.utimesSync(path.join(root, 'older'), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(root, 'newer'), new Date(9000), new Date(9000));
  expect(listRecentPlaylists(root).map((o) => o.id)).toEqual(['PLnew', 'PLold']);
});

it('skips archived/ and corrupt/indexless folders', () => {
  fs.mkdirSync(path.join(root, 'archived', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'archived', 'raw', 'playlist-index.json'), '{"playlistUrl":"https://youtube.com/playlist?list=PLarch","videos":[]}');
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
  fs.mkdirSync(path.join(root, 'corrupt', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'corrupt', 'raw', 'playlist-index.json'), '{ not json');
  writePlaylist(root, 'good', { playlistUrl: 'https://youtube.com/playlist?list=PLgood', playlistTitle: 'Good', videos: [] });
  expect(listRecentPlaylists(root).map((o) => o.id)).toEqual(['PLgood']);
});

it('returns [] for a missing root (within home)', () => {
  expect(listRecentPlaylists(path.join(root, 'nope'))).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest recent-provider`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/playlists/recent-provider.ts
import fs from 'fs';
import path from 'path';
import { assertOutputFolder } from '../index-store';
import type { PlaylistOption } from './types';

function extractId(url: string): string | null {
  try { return new URL(url).searchParams.get('list'); } catch { return null; }
}

/** Read one playlist folder's index (nested raw/ or flat). Returns null if none/invalid. */
function readCandidate(dir: string): { index: { playlistUrl?: string; playlistTitle?: string; videos?: unknown[] } } | null {
  for (const candidate of [path.join(dir, 'raw'), dir]) {
    const file = path.join(candidate, 'playlist-index.json');
    if (!fs.existsSync(file)) continue;
    try { return { index: JSON.parse(fs.readFileSync(file, 'utf-8')) }; } catch { return null; }
  }
  return null;
}

export function listRecentPlaylists(root: string): PlaylistOption[] {
  assertOutputFolder(root); // within-home + realpath guard (throws → route returns 400)
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; } // missing dir → []

  const rows: { option: PlaylistOption; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archived') continue;
    const dir = path.join(root, entry.name);
    const found = readCandidate(dir);
    if (!found) continue;
    const id = extractId(found.index.playlistUrl ?? '');
    if (!id) continue;
    const title = found.index.playlistTitle || entry.name || 'Untitled playlist'; // never the id
    const videoCount = Array.isArray(found.index.videos) ? found.index.videos.length : undefined;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(dir).mtimeMs; } catch { /* keep 0 */ } // playlist-folder mtime
    rows.push({
      option: { id, title, url: `https://youtube.com/playlist?list=${id}`, source: 'recent', meta: { videoCount } },
      mtimeMs,
    });
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => r.option);
}
```

- [ ] **Step 4: Run tests + type gate**

Run: `npx jest recent-provider` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/playlists/recent-provider.ts tests/lib/playlists/recent-provider.test.ts
git commit -m "feat(playlists): recent provider — folder-mtime-sorted PlaylistOption[] (home-guarded)"
```

---

## Task 4: `GET /api/playlists/recent`

**Files:**
- Create: `app/api/playlists/recent/route.ts`, `tests/api/playlists-recent.test.ts`

**Interfaces:**
- Consumes: `listRecentPlaylists` (Task 3), `assertOutputFolder` (`lib/index-store.ts`).
- Produces: `GET /api/playlists/recent?root=<enc>` → `200 { playlists: PlaylistOption[] }`; `400 { error }` on missing/invalid root.

- [ ] **Step 1: Read the Next.js route-handler docs** — check `node_modules/next/dist/docs/` for the App Router GET handler signature; match `app/api/html/[id]/route.ts`.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/api/playlists-recent.test.ts
jest.mock('../../lib/playlists/recent-provider', () => ({
  listRecentPlaylists: jest.fn(() => [{ id: 'PLa', title: 'X', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: {} }]),
}));
import { GET } from '../../app/api/playlists/recent/route';

const req = (u: string) => new Request(u);

it('400 when root is missing', async () => {
  expect((await GET(req('http://x/api/playlists/recent'))).status).toBe(400);
});
it('400 when root fails the home guard', async () => {
  expect((await GET(req('http://x/api/playlists/recent?root=' + encodeURIComponent('/etc')))).status).toBe(400);
});
it('200 { playlists } for a valid root', async () => {
  const res = await GET(req('http://x/api/playlists/recent?root=' + encodeURIComponent(process.env.HOME + '/some-data-root')));
  expect(res.status).toBe(200);
  expect((await res.json()).playlists[0].id).toBe('PLa');
});
```

- [ ] **Step 3: Run test to verify it fails** — Run: `npx jest playlists-recent` → FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// app/api/playlists/recent/route.ts
import { assertOutputFolder } from '../../../../lib/index-store';
import { listRecentPlaylists } from '../../../../lib/playlists/recent-provider';

export async function GET(request: Request) {
  const root = new URL(request.url).searchParams.get('root');
  if (!root) return Response.json({ error: 'root is required' }, { status: 400 });
  try {
    assertOutputFolder(root); // within-home + realpath guard
    return Response.json({ playlists: listRecentPlaylists(root) });
  } catch {
    return Response.json({ error: 'invalid root' }, { status: 400 });
  }
}
```

> Note: `listRecentPlaylists` also calls `assertOutputFolder`; the route's try/catch converts a bad root (from either) into a 400.

- [ ] **Step 5: Run tests to verify they pass** — Run: `npx jest playlists-recent` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/playlists/recent/route.ts tests/api/playlists-recent.test.ts
git commit -m "feat(playlists): GET /api/playlists/recent (home-guarded, { playlists })"
```

---

## Task 5: Channel API + strict handle parsing in `lib/youtube.ts`

**Files:**
- Modify: `lib/youtube.ts`
- Create: `tests/lib/youtube-channel.test.ts`

**Interfaces:**
- Produces:
  - `parseChannelHandle(input): { handle?: string; channelId?: string }` — URL-aware, YouTube-host-only, strict allowlist; `{}` for anything invalid.
  - `resolveChannelId(input, apiKey): Promise<{ channelId; channelTitle }>` — throws `ChannelNotFoundError` when `{}` or no channel.
  - `fetchChannelPlaylists(channelId, apiKey): Promise<{ id; title; itemCount?; thumbnailUrl? }[]>` — one page, `maxResults: 50`.
  - `buildPlaylistUrl(id): string` → `https://youtube.com/playlist?list=<id>`.
  - `export class ChannelNotFoundError extends Error {}`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/youtube-channel.test.ts
const channelsList = jest.fn();
const playlistsList = jest.fn();
jest.mock('googleapis', () => ({
  google: { youtube: () => ({ channels: { list: channelsList }, playlists: { list: playlistsList } }) },
}));
import { parseChannelHandle, resolveChannelId, fetchChannelPlaylists, buildPlaylistUrl, ChannelNotFoundError } from '../../lib/youtube';

beforeEach(() => { channelsList.mockReset(); playlistsList.mockReset(); });

describe('parseChannelHandle (strict, YouTube-host-only)', () => {
  it('accepts @handle and bare handle', () => {
    expect(parseChannelHandle('@Anthropic')).toEqual({ handle: 'Anthropic' });
    expect(parseChannelHandle('Anthropic')).toEqual({ handle: 'Anthropic' });
  });
  it('accepts a youtube.com/@handle URL', () => {
    expect(parseChannelHandle('https://youtube.com/@Anthropic')).toEqual({ handle: 'Anthropic' });
    expect(parseChannelHandle('https://www.youtube.com/@Anthropic')).toEqual({ handle: 'Anthropic' });
  });
  it('accepts a /channel/UC… URL and a bare channel id', () => {
    expect(parseChannelHandle('https://youtube.com/channel/UC1234567890abcdefghijkl')).toEqual({ channelId: 'UC1234567890abcdefghijkl' });
    expect(parseChannelHandle('UC1234567890abcdefghijkl')).toEqual({ channelId: 'UC1234567890abcdefghijkl' });
  });
  it('rejects a non-YouTube host → {}', () => {
    expect(parseChannelHandle('https://evil.example/@Anthropic')).toEqual({});
  });
  it('rejects embedded @ / illegal chars / oversized → {}', () => {
    expect(parseChannelHandle('x@y')).toEqual({});
    expect(parseChannelHandle('bad name!')).toEqual({});
    expect(parseChannelHandle('a'.repeat(31))).toEqual({});
  });
});

it('resolveChannelId returns id+title for a known handle', async () => {
  channelsList.mockResolvedValue({ data: { items: [{ id: 'UC1', snippet: { title: 'Anthropic' } }] } });
  await expect(resolveChannelId('@Anthropic', 'k')).resolves.toEqual({ channelId: 'UC1', channelTitle: 'Anthropic' });
  expect(channelsList).toHaveBeenCalledWith(expect.objectContaining({ forHandle: 'Anthropic' }));
});
it('resolveChannelId throws ChannelNotFoundError on empty result', async () => {
  channelsList.mockResolvedValue({ data: { items: [] } });
  await expect(resolveChannelId('@nope', 'k')).rejects.toBeInstanceOf(ChannelNotFoundError);
});
it('resolveChannelId throws ChannelNotFoundError on unparseable input (no API call)', async () => {
  await expect(resolveChannelId('https://evil.example/@x', 'k')).rejects.toBeInstanceOf(ChannelNotFoundError);
  expect(channelsList).not.toHaveBeenCalled();
});
it('fetchChannelPlaylists maps snippet + contentDetails', async () => {
  playlistsList.mockResolvedValue({ data: { items: [
    { id: 'PLa', snippet: { title: 'A', thumbnails: { medium: { url: 'http://t/a.jpg' } } }, contentDetails: { itemCount: 7 } },
  ] } });
  await expect(fetchChannelPlaylists('UC1', 'k')).resolves.toEqual([{ id: 'PLa', title: 'A', itemCount: 7, thumbnailUrl: 'http://t/a.jpg' }]);
});
it('buildPlaylistUrl is canonical', () => { expect(buildPlaylistUrl('PLa')).toBe('https://youtube.com/playlist?list=PLa'); });
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest youtube-channel` → FAIL (exports not defined).

- [ ] **Step 3: Implement in `lib/youtube.ts`**

```ts
export class ChannelNotFoundError extends Error {}

export function buildPlaylistUrl(id: string): string {
  return `https://youtube.com/playlist?list=${id}`;
}

const HANDLE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

// Strict, YouTube-host-only parse (Codex H2). {} for anything invalid → callers map to ChannelNotFound.
export function parseChannelHandle(input: string): { handle?: string; channelId?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};
  const looksUrl = /^https?:\/\//i.test(trimmed) || /^(www\.|m\.)?youtube\.com\//i.test(trimmed);
  if (looksUrl) {
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`); } catch { return {}; }
    if (!YT_HOSTS.has(url.hostname.toLowerCase())) return {};
    const at = url.pathname.match(/^\/@([A-Za-z0-9._-]{1,30})$/);
    if (at) return { handle: at[1] };
    const chan = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{20,})$/);
    if (chan) return { channelId: chan[1] };
    return {};
  }
  if (/[/\s]/.test(trimmed)) return {};       // no path/space in a non-URL form
  if (CHANNEL_ID_RE.test(trimmed)) return { channelId: trimmed };
  const bare = trimmed.replace(/^@/, '');
  if (bare.includes('@')) return {};          // embedded @ (e.g. x@y)
  if (HANDLE_RE.test(bare)) return { handle: bare };
  return {};
}

export async function resolveChannelId(input: string, apiKey: string): Promise<{ channelId: string; channelTitle: string }> {
  const parsed = parseChannelHandle(input);
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  const pick = (item?: { id?: string | null; snippet?: { title?: string | null } | null }) => {
    if (!item?.id) throw new ChannelNotFoundError(`channel not found: ${input}`);
    return { channelId: item.id, channelTitle: item.snippet?.title ?? item.id };
  };
  if (parsed.channelId) return pick((await yt.channels.list({ part: ['snippet'], id: [parsed.channelId] })).data.items?.[0]);
  if (parsed.handle) return pick((await yt.channels.list({ part: ['snippet'], forHandle: parsed.handle })).data.items?.[0]);
  throw new ChannelNotFoundError(`unrecognized channel input: ${input}`);
}

export async function fetchChannelPlaylists(channelId: string, apiKey: string): Promise<{ id: string; title: string; itemCount?: number; thumbnailUrl?: string }[]> {
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  const res = await yt.playlists.list({ part: ['snippet', 'contentDetails'], channelId, maxResults: 50 });
  return (res.data.items ?? []).filter((i) => i.id).map((i) => ({
    id: i.id as string,
    title: i.snippet?.title ?? (i.id as string),
    itemCount: i.contentDetails?.itemCount ?? undefined,
    thumbnailUrl: i.snippet?.thumbnails?.medium?.url ?? i.snippet?.thumbnails?.default?.url ?? undefined,
  }));
}
```

- [ ] **Step 4: Run tests + type gate** — Run: `npx jest youtube-channel` then `npx tsc --noEmit` → PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube.ts tests/lib/youtube-channel.test.ts
git commit -m "feat(playlists): channel resolve/list + strict YouTube-host handle parse"
```

---

## Task 6: Channel provider

**Files:**
- Create: `lib/playlists/channel-provider.ts`, `tests/lib/playlists/channel-provider.test.ts`

**Interfaces:**
- Consumes: `resolveChannelId`, `fetchChannelPlaylists`, `buildPlaylistUrl` (Task 5); `PlaylistOption` (Task 1).
- Produces: `listChannelPlaylists(handle, apiKey): Promise<{ channelTitle; playlists: PlaylistOption[] }>` — normalizes to `PlaylistOption[]` (`source: 'channel'`, `meta.channelTitle`, `meta.videoCount = itemCount`, `meta.thumbnailUrl`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/playlists/channel-provider.test.ts
jest.mock('../../../lib/youtube', () => ({
  resolveChannelId: jest.fn(async () => ({ channelId: 'UC1', channelTitle: 'Anthropic' })),
  fetchChannelPlaylists: jest.fn(async () => [{ id: 'PLa', title: 'A', itemCount: 7, thumbnailUrl: 'http://t/a.jpg' }]),
  buildPlaylistUrl: (id: string) => `https://youtube.com/playlist?list=${id}`,
  ChannelNotFoundError: class extends Error {},
}));
import { listChannelPlaylists } from '../../../lib/playlists/channel-provider';

it('normalizes channel playlists into PlaylistOption[]', async () => {
  const out = await listChannelPlaylists('@Anthropic', 'k');
  expect(out.channelTitle).toBe('Anthropic');
  expect(out.playlists).toEqual([{
    id: 'PLa', title: 'A', url: 'https://youtube.com/playlist?list=PLa', source: 'channel',
    meta: { videoCount: 7, channelTitle: 'Anthropic', thumbnailUrl: 'http://t/a.jpg' },
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest channel-provider` → FAIL.

- [ ] **Step 3: Implement**

```ts
// lib/playlists/channel-provider.ts
import { resolveChannelId, fetchChannelPlaylists, buildPlaylistUrl } from '../youtube';
import type { PlaylistOption } from './types';

export async function listChannelPlaylists(handle: string, apiKey: string): Promise<{ channelTitle: string; playlists: PlaylistOption[] }> {
  const { channelId, channelTitle } = await resolveChannelId(handle, apiKey);
  const raw = await fetchChannelPlaylists(channelId, apiKey);
  const playlists: PlaylistOption[] = raw.map((p) => ({
    id: p.id, title: p.title, url: buildPlaylistUrl(p.id), source: 'channel',
    meta: { videoCount: p.itemCount, channelTitle, thumbnailUrl: p.thumbnailUrl },
  }));
  return { channelTitle, playlists };
}
```

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx jest channel-provider` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/playlists/channel-provider.ts tests/lib/playlists/channel-provider.test.ts
git commit -m "feat(playlists): channel provider — normalize to PlaylistOption[]"
```

---

## Task 7: `GET /api/playlists/channel`

**Files:**
- Create: `app/api/playlists/channel/route.ts`, `tests/api/playlists-channel.test.ts`

**Interfaces:**
- Consumes: `listChannelPlaylists` (Task 6), `ChannelNotFoundError` (Task 5).
- Produces: `GET /api/playlists/channel?handle=<enc>` → `200 { channelTitle, playlists }`; `400` missing handle; `404` not found; `502` upstream; `500` no API key.

- [ ] **Step 1: Read the Next.js route-handler docs** (as Task 4 Step 1).

- [ ] **Step 2: Write the failing tests (incl. 500-no-key)**

```ts
// tests/api/playlists-channel.test.ts
const listChannelPlaylists = jest.fn();
jest.mock('../../lib/playlists/channel-provider', () => ({ listChannelPlaylists }));
jest.mock('../../lib/youtube', () => ({ ChannelNotFoundError: class extends Error {} }));
import { GET } from '../../app/api/playlists/channel/route';
import { ChannelNotFoundError } from '../../lib/youtube';

const req = (u: string) => new Request(u);
const OLD = process.env.YOUTUBE_API_KEY;
beforeEach(() => { listChannelPlaylists.mockReset(); process.env.YOUTUBE_API_KEY = 'k'; });
afterAll(() => { process.env.YOUTUBE_API_KEY = OLD; });

it('400 when handle missing', async () => {
  expect((await GET(req('http://x/api/playlists/channel'))).status).toBe(400);
});
it('500 when YOUTUBE_API_KEY is unset', async () => {
  delete process.env.YOUTUBE_API_KEY;
  expect((await GET(req('http://x/api/playlists/channel?handle=@x'))).status).toBe(500);
});
it('200 with results', async () => {
  listChannelPlaylists.mockResolvedValue({ channelTitle: 'Anthropic', playlists: [{ id: 'PLa' }] });
  const res = await GET(req('http://x/api/playlists/channel?handle=@Anthropic'));
  expect(res.status).toBe(200);
  expect((await res.json()).channelTitle).toBe('Anthropic');
});
it('404 on ChannelNotFoundError', async () => {
  listChannelPlaylists.mockRejectedValue(new ChannelNotFoundError('nope'));
  expect((await GET(req('http://x/api/playlists/channel?handle=@nope'))).status).toBe(404);
});
it('502 on upstream error', async () => {
  listChannelPlaylists.mockRejectedValue(new Error('quota'));
  expect((await GET(req('http://x/api/playlists/channel?handle=@x'))).status).toBe(502);
});
```

- [ ] **Step 3: Run test to verify it fails** — Run: `npx jest playlists-channel` → FAIL.

- [ ] **Step 4: Implement**

```ts
// app/api/playlists/channel/route.ts
import { listChannelPlaylists } from '../../../../lib/playlists/channel-provider';
import { ChannelNotFoundError } from '../../../../lib/youtube';

export async function GET(request: Request) {
  const handle = new URL(request.url).searchParams.get('handle');
  if (!handle) return Response.json({ error: 'handle is required' }, { status: 400 });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return Response.json({ error: 'server missing YOUTUBE_API_KEY' }, { status: 500 });
  try {
    return Response.json(await listChannelPlaylists(handle, apiKey));
  } catch (err) {
    if (err instanceof ChannelNotFoundError) return Response.json({ error: `No channel found for '${handle}'` }, { status: 404 });
    return Response.json({ error: 'Could not reach YouTube' }, { status: 502 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass** — Run: `npx jest playlists-channel` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/playlists/channel/route.ts tests/api/playlists-channel.test.ts
git commit -m "feat(playlists): GET /api/playlists/channel (400/404/500/502 mapped)"
```

---

## Task 8: Backfill script for existing playlists

**Files:**
- Create: `lib/playlists/backfill-titles.ts`, `scripts/backfill-playlist-titles.ts`, `tests/lib/playlists/backfill-titles.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `readIndex`/`writeIndex`/`assertOutputFolder` (`lib/index-store.ts`), `fetchPlaylistTitle` (`lib/youtube.ts`).
- Produces: `backfillPlaylistTitles(root, apiKey): Promise<{ updated: string[]; skipped: string[]; failed: string[] }>` — calls `assertOutputFolder(root)`; for each playlist folder missing `playlistTitle`, fetch by id and write it; leave populated ones (skipped); record fetch failures (failed) without throwing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/playlists/backfill-titles.test.ts
jest.mock('../../../lib/youtube', () => ({
  fetchPlaylistTitle: jest.fn(async (id: string) => id === 'PLbad' ? Promise.reject(new Error('quota')) : `Title ${id}`),
}));
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backfillPlaylistTitles } from '../../../lib/playlists/backfill-titles';

function writePlaylist(root: string, dir: string, index: object) {
  const raw = path.join(root, dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  const file = path.join(raw, 'playlist-index.json');
  fs.writeFileSync(file, JSON.stringify(index));
  return file;
}
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.homedir(), '.bf-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

it('writes titles for missing, skips populated, records failures', async () => {
  const f1 = writePlaylist(root, 'a', { playlistUrl: 'https://youtube.com/playlist?list=PLa', videos: [] });
  writePlaylist(root, 'b', { playlistUrl: 'https://youtube.com/playlist?list=PLb', playlistTitle: 'Already', videos: [] });
  writePlaylist(root, 'c', { playlistUrl: 'https://youtube.com/playlist?list=PLbad', videos: [] });
  const res = await backfillPlaylistTitles(root, 'k');
  expect(JSON.parse(fs.readFileSync(f1, 'utf-8')).playlistTitle).toBe('Title PLa');
  expect(res.updated.some((p) => p.includes(`${path.sep}a${path.sep}`))).toBe(true);
  expect(res.skipped.some((p) => p.includes(`${path.sep}b${path.sep}`))).toBe(true);
  expect(res.failed.some((p) => p.includes(`${path.sep}c${path.sep}`))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest backfill-titles` → FAIL.

- [ ] **Step 3: Implement the lib function**

```ts
// lib/playlists/backfill-titles.ts
import fs from 'fs';
import path from 'path';
import { readIndex, writeIndex, assertOutputFolder } from '../index-store';
import { fetchPlaylistTitle } from '../youtube';

function extractId(url: string): string | null {
  try { return new URL(url).searchParams.get('list'); } catch { return null; }
}

/** Folders holding an index: <root>/*/raw or <root>/* (flat), excluding archived/. */
function playlistFolders(root: string): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'archived') continue;
    for (const c of [path.join(root, e.name, 'raw'), path.join(root, e.name)]) {
      if (fs.existsSync(path.join(c, 'playlist-index.json'))) { out.push(c); break; }
    }
  }
  return out;
}

export async function backfillPlaylistTitles(root: string, apiKey: string): Promise<{ updated: string[]; skipped: string[]; failed: string[] }> {
  assertOutputFolder(root); // within-home guard at the entry point
  const updated: string[] = [], skipped: string[] = [], failed: string[] = [];
  for (const folder of playlistFolders(root)) {
    let index;
    try { index = readIndex(folder); } catch { failed.push(folder); continue; }
    if (index.playlistTitle) { skipped.push(folder); continue; }
    const id = extractId(index.playlistUrl ?? '');
    if (!id) { failed.push(folder); continue; }
    try { writeIndex(folder, { ...index, playlistTitle: await fetchPlaylistTitle(id, apiKey) }); updated.push(folder); }
    catch { failed.push(folder); }
  }
  return { updated, skipped, failed };
}
```

- [ ] **Step 4: Create the CLI wrapper (with concurrency warning)**

```ts
// scripts/backfill-playlist-titles.ts
// NOTE: relative imports — ts-node (CommonJS override) does NOT resolve `@/*` at runtime.
import { backfillPlaylistTitles } from '../lib/playlists/backfill-titles';

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  const root = i !== -1 ? args[i + 1] : process.cwd();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) { console.error('YOUTUBE_API_KEY is not set'); process.exit(1); }
  console.log('⚠️  Writes playlist-index.json in place — do NOT run concurrently with ingestion/sync.');
  const res = await backfillPlaylistTitles(root, apiKey);
  console.log(`Backfill: ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.failed.length} failed`);
  for (const f of res.failed) console.log(`  FAILED: ${f}`);
}
main();
```

Add to `package.json` scripts (mirror `audit-summaries`):

```json
"backfill-playlist-titles": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/backfill-playlist-titles.ts"
```

- [ ] **Step 5: Run tests + type gate** — Run: `npx jest backfill-titles` then `npx tsc --noEmit` → PASS; clean.

- [ ] **Step 6: Commit**

```bash
git add lib/playlists/backfill-titles.ts tests/lib/playlists/backfill-titles.test.ts scripts/backfill-playlist-titles.ts package.json
git commit -m "feat(playlists): backfill-playlist-titles script + lib fn (home-guarded)"
```

---

## Task 9: Expose `playlistTitle` on `/api/videos`

**Files:**
- Modify: `app/api/videos/route.ts:114`, `tests/api/videos.test.ts`

The route currently ends: `return NextResponse.json({ videos, playlistUrl: index.playlistUrl });`. The test file already `jest.mock('../../lib/index-store')` and exposes `mockReadIndex = jest.mocked(indexStore.readIndex)`.

- [ ] **Step 1: Write the failing test (extend `tests/api/videos.test.ts`)**

```ts
it('includes playlistTitle from the index', async () => {
  mockReadIndex.mockReturnValue({ playlistUrl: 'https://youtube.com/playlist?list=PLa', playlistTitle: 'Building with Claude', videos: [] } as unknown as PlaylistIndex);
  const res = await GET(new Request('http://x/api/videos?outputFolder=' + encodeURIComponent(process.env.HOME + '/data/a/raw')));
  expect((await res.json()).playlistTitle).toBe('Building with Claude');
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest videos` → FAIL (`playlistTitle` undefined).

- [ ] **Step 3: Implement** — change line 114 to:

```ts
  return NextResponse.json({ videos, playlistUrl: index.playlistUrl, playlistTitle: index.playlistTitle });
```

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx jest videos` → PASS (existing cases + new).

- [ ] **Step 5: Commit**

```bash
git add app/api/videos/route.ts tests/api/videos.test.ts
git commit -m "feat(playlists): expose playlistTitle on /api/videos"
```

---

## Task 10: Recent combobox component

**Files:**
- Create: `components/PlaylistPicker.tsx`, `tests/components/PlaylistPicker.test.tsx`

**Interfaces:**
- Consumes: `PlaylistOption` (Task 1); `GET /api/playlists/recent` → `{ playlists }` (Task 4).
- Produces: `<PlaylistPicker root value onChange onPick onBrowseChannel disabled? />` — renders the URL input (`value`/`onChange` passthrough), a recent dropdown fetched on focus, and a "Browse a channel's playlists…" footer.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/PlaylistPicker.test.tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import PlaylistPicker from '../../components/PlaylistPicker';

const options = [{ id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } }];
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ playlists: options }) })) as unknown as typeof fetch; });

it('shows recent titles (not ids) on focus', async () => {
  render(<PlaylistPicker root="/home/x/data" value="" onChange={() => {}} onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.focus(screen.getByRole('textbox'));
  expect(await screen.findByText('Building with Claude')).toBeInTheDocument();
  expect(screen.queryByText('PLa')).not.toBeInTheDocument();
});
it('selecting an option calls onPick with the url', async () => {
  const onPick = jest.fn();
  render(<PlaylistPicker root="/home/x/data" value="" onChange={() => {}} onPick={onPick} onBrowseChannel={() => {}} />);
  fireEvent.focus(screen.getByRole('textbox'));
  fireEvent.click(await screen.findByText('Building with Claude'));
  expect(onPick).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLa');
});
it('preserves free typing', () => {
  const onChange = jest.fn();
  render(<PlaylistPicker root="/home/x/data" value="" onChange={onChange} onPick={() => {}} onBrowseChannel={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://youtube.com/playlist?list=PLtyped' } });
  expect(onChange).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLtyped');
});
it('footer row triggers onBrowseChannel', async () => {
  const onBrowseChannel = jest.fn();
  render(<PlaylistPicker root="/home/x/data" value="" onChange={() => {}} onPick={() => {}} onBrowseChannel={onBrowseChannel} />);
  fireEvent.focus(screen.getByRole('textbox'));
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(onBrowseChannel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest PlaylistPicker` → FAIL.

- [ ] **Step 3: Implement**

```tsx
// components/PlaylistPicker.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import type { PlaylistOption } from '../lib/playlists/types';

type Props = {
  root: string; value: string; onChange: (v: string) => void;
  onPick: (url: string) => void; onBrowseChannel: () => void; disabled?: boolean;
};

export default function PlaylistPicker({ root, value, onChange, onPick, onBrowseChannel, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<PlaylistOption[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  async function loadRecent() {
    if (!root) return;
    try {
      const res = await fetch(`/api/playlists/recent?root=${encodeURIComponent(root)}`);
      if (!res.ok) return;
      setOptions(((await res.json()).playlists ?? []) as PlaylistOption[]);
    } catch { /* leave options empty */ }
  }

  useEffect(() => {
    function onDocClick(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={boxRef} className="relative flex-1">
      <input
        type="text" placeholder="Paste a playlist URL — or pick ▾" value={value} disabled={disabled}
        onFocus={() => { setOpen(true); loadRecent(); }}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded border border-zinc-700 bg-zinc-900 shadow-lg">
          {options.length > 0 && <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">Recent</div>}
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => { onPick(o.url); setOpen(false); }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800">
              <span className="truncate">{o.title}</span>
              {o.meta?.videoCount != null && <span className="ml-2 shrink-0 text-xs text-zinc-500">{o.meta.videoCount} videos</span>}
            </button>
          ))}
          <div className="border-t border-zinc-800" />
          <button type="button" onClick={() => { onBrowseChannel(); setOpen(false); }}
            className="flex w-full items-center px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800">
            🔍 Browse a channel&apos;s playlists…
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx jest PlaylistPicker` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/PlaylistPicker.tsx tests/components/PlaylistPicker.test.tsx
git commit -m "feat(playlists): recent combobox component"
```

---

## Task 11: Channel panel component

**Files:**
- Create: `components/ChannelPlaylistPanel.tsx`, `tests/components/ChannelPlaylistPanel.test.tsx`

**Interfaces:**
- Consumes: `PlaylistOption` (Task 1); `GET /api/playlists/channel` (Task 7).
- Produces: `<ChannelPlaylistPanel onSelect onClose />` — modal with handle input + Go, remembered-recents chips (localStorage `playlist-picker:channel-recents`), results list, loading + error states, "showing first 50" note at 50 results. Dismissal: ✕, Escape, backdrop → `onClose()`; select → `onSelect(url)` + `onClose()`.

- [ ] **Step 1: Write the failing tests (incl. loading, 502, chip-refill, all dismissals)**

```tsx
// tests/components/ChannelPlaylistPanel.test.tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import ChannelPlaylistPanel from '../../components/ChannelPlaylistPanel';

const okBody = { channelTitle: 'Anthropic', playlists: [{ id: 'PLa', title: 'A', url: 'https://youtube.com/playlist?list=PLa', source: 'channel', meta: { videoCount: 7 } }] };
function mockFetch(status: number, body: unknown) { global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch; }
beforeEach(() => { localStorage.clear(); mockFetch(200, okBody); });

it('Go lists channel playlist titles', async () => {
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText('A')).toBeInTheDocument();
});
it('selecting a playlist calls onSelect(url) and onClose', async () => {
  const onSelect = jest.fn(); const onClose = jest.fn();
  render(<ChannelPlaylistPanel onSelect={onSelect} onClose={onClose} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  fireEvent.click(await screen.findByText('A'));
  expect(onSelect).toHaveBeenCalledWith('https://youtube.com/playlist?list=PLa');
  expect(onClose).toHaveBeenCalled();
});
it.each([
  ['close button', () => fireEvent.click(screen.getByLabelText('Close'))],
  ['escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ['backdrop', () => fireEvent.click(screen.getByTestId('panel-backdrop'))],
])('dismisses via %s', (_n, act) => {
  const onClose = jest.fn();
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={onClose} />);
  act();
  expect(onClose).toHaveBeenCalled();
});
it('shows a loading state while fetching', async () => {
  let resolve!: (v: unknown) => void;
  global.fetch = jest.fn(() => new Promise((r) => { resolve = r; })) as unknown as typeof fetch;
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@x' } });
  fireEvent.click(screen.getByText('Go'));
  expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  resolve({ ok: true, status: 200, json: async () => okBody });
});
it('shows not-found on 404', async () => {
  mockFetch(404, { error: "No channel found for '@nope'" });
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@nope' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText(/No channel found/i)).toBeInTheDocument();
});
it('shows an error on 502', async () => {
  mockFetch(502, { error: 'Could not reach YouTube' });
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@x' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText(/reach YouTube/i)).toBeInTheDocument();
});
it('remembers the handle and refills the input from a chip', async () => {
  const { rerender } = render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  await screen.findByText('A');
  expect(JSON.parse(localStorage.getItem('playlist-picker:channel-recents') || '[]')).toContain('@Anthropic');
  // remount: chip present, clicking it refills the input
  rerender(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '@Anthropic' }));
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('@Anthropic');
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest ChannelPlaylistPanel` → FAIL.

- [ ] **Step 3: Implement**

```tsx
// components/ChannelPlaylistPanel.tsx
'use client';
import { useEffect, useState } from 'react';
import type { PlaylistOption } from '../lib/playlists/types';

const RECENTS_KEY = 'playlist-picker:channel-recents';

export default function ChannelPlaylistPanel({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [handle, setHandle] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [results, setResults] = useState<PlaylistOption[]>([]);
  const [channelTitle, setChannelTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { try { setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')); } catch { /* ignore */ } }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function rememberHandle(h: string) {
    const next = [h, ...recents.filter((r) => r !== h)].slice(0, 8);
    setRecents(next); try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  async function go(h: string) {
    const q = h.trim(); if (!q) return;
    setLoading(true); setError(null); setResults([]);
    try {
      const res = await fetch(`/api/playlists/channel?handle=${encodeURIComponent(q)}`);
      const body = await res.json();
      if (res.status === 404) { setError(`No channel found for '${q}'`); return; }
      if (!res.ok) { setError('Couldn’t reach YouTube — try again'); return; }
      setChannelTitle(body.channelTitle ?? ''); setResults(body.playlists ?? []); rememberHandle(q);
    } catch { setError('Couldn’t reach YouTube — try again'); }
    finally { setLoading(false); }
  }

  return (
    <div data-testid="panel-backdrop" onClick={onClose} className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div onClick={(e) => e.stopPropagation()} className="w-[32rem] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-100">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Browse channel playlists</h2>
          <button aria-label="Close" onClick={onClose} className="text-zinc-400 hover:text-zinc-200">✕</button>
        </div>
        <div className="flex gap-2">
          <input type="text" placeholder="@channel or channel URL" value={handle}
            onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go(handle); }}
            className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm" />
          <button type="button" onClick={() => go(handle)} className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm text-white">Go</button>
        </div>
        {recents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {recents.map((r) => (
              <button key={r} type="button" onClick={() => { setHandle(r); go(r); }}
                className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700">{r}</button>
            ))}
          </div>
        )}
        <div className="mt-3 max-h-72 overflow-auto">
          {loading && <p className="text-sm text-zinc-500">Loading…</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && results.length === 0 && channelTitle && <p className="text-sm text-zinc-500">No public playlists</p>}
          {results.length > 0 && (
            <>
              <p className="mb-1 text-xs text-zinc-500">{channelTitle} · {results.length} public playlists{results.length === 50 ? ' (showing first 50)' : ''}</p>
              {results.map((o) => (
                <button key={o.id} type="button" onClick={() => { onSelect(o.url); onClose(); }}
                  className="flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-zinc-800">
                  <span className="truncate">{o.title}</span>
                  {o.meta?.videoCount != null && <span className="ml-2 shrink-0 text-xs text-zinc-500">{o.meta.videoCount} videos</span>}
                </button>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx jest ChannelPlaylistPanel` → PASS (all dismissals + loading + 404 + 502 + chip refill).

- [ ] **Step 5: Commit**

```bash
git add components/ChannelPlaylistPanel.tsx tests/components/ChannelPlaylistPanel.test.tsx
git commit -m "feat(playlists): channel playlist panel (modal + recents + loading/error states)"
```

---

## Task 12: Integrate into Header + current-playlist name caption

**Files:**
- Modify: `components/Header.tsx`, `app/page.tsx`
- Create: `tests/components/Header-picker.test.tsx`

**Interfaces:**
- Consumes: `PlaylistPicker` (Task 10), `ChannelPlaylistPanel` (Task 11), new `currentPlaylistTitle` prop.
- Produces: Header Row 2 uses `<PlaylistPicker>`; `channelPanelOpen` state renders `<ChannelPlaylistPanel>`; helper `applyPickedUrl(url)` sets URL + `urlEditedByUser.current = true`; a name caption renders when `currentPlaylistTitle` is set.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/components/Header-picker.test.tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import Header from '../../components/Header';

beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ playlists: [] }) })) as unknown as typeof fetch; });

it('renders the current playlist name caption when provided', () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/a/raw"
    currentPlaylistTitle="Building with Claude" onIngest={() => {}} />);
  expect(screen.getByText(/Building with Claude/)).toBeInTheDocument();
});
it('opens the channel panel from the picker footer', async () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/a/raw" onIngest={() => {}} />);
  fireEvent.focus(screen.getByPlaceholderText(/Paste a playlist URL/));
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(await screen.findByText(/Browse channel playlists/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest Header-picker` → FAIL.

- [ ] **Step 3: Implement in `components/Header.tsx`**
  - Add `currentPlaylistTitle?: string` to `HeaderProps` and destructure it.
  - Import `PlaylistPicker` and `ChannelPlaylistPanel`.
  - Add `const [channelPanelOpen, setChannelPanelOpen] = useState(false);`
  - Add `const applyPickedUrl = useCallback((url: string) => { setPlaylistUrl(url); urlEditedByUser.current = true; }, []);`
  - Replace the Row 2 `<input>` (Header.tsx:252-258) with:

```tsx
          <PlaylistPicker
            root={trimRoot}
            value={playlistUrl}
            onChange={handleUrlChange}
            onPick={applyPickedUrl}
            onBrowseChannel={() => setChannelPanelOpen(true)}
            disabled={disabled}
          />
```

  - Add the name caption just above Row 2 (after the derived-target `<p>`):

```tsx
        {currentPlaylistTitle && <p className="text-xs text-zinc-400 pl-1">▶ {currentPlaylistTitle}</p>}
```

  - Render the panel at the end of the `<header>` (inside the component's returned tree, after `</form>`):

```tsx
        {channelPanelOpen && (
          <ChannelPlaylistPanel
            onSelect={(url) => { applyPickedUrl(url); setChannelPanelOpen(false); }}
            onClose={() => setChannelPanelOpen(false)}
          />
        )}
```

- [ ] **Step 4: Thread `currentPlaylistTitle` in `app/page.tsx`**
  - Add `const [currentPlaylistTitle, setCurrentPlaylistTitle] = useState('');`
  - Where `setCurrentPlaylistUrl(data.playlistUrl ?? '')` runs (page.tsx:133), add `setCurrentPlaylistTitle(data.playlistTitle ?? '');`
  - Pass `currentPlaylistTitle={currentPlaylistTitle}` to `<Header>` (page.tsx:480 area).

- [ ] **Step 5: Run tests + type gate** — Run: `npx jest Header` then `npx tsc --noEmit` → PASS; clean.

- [ ] **Step 6: Run the full unit/component suite (regression)** — Run: `npm test` → all green.

- [ ] **Step 7: Commit**

```bash
git add components/Header.tsx tests/components/Header-picker.test.tsx app/page.tsx
git commit -m "feat(playlists): mount picker + channel panel in Header; show playlist name caption"
```

---

## Task 13: E2E — pick-recent (fires Fetch) and pick-channel flows

**Files:**
- Create: `tests/e2e/playlist-picker.spec.ts`

**Interfaces:**
- Consumes: the running app; the two picker API routes (+ `/api/ingest` for the Fetch assertion).

- [ ] **Step 1: Write the E2E spec**

```ts
// tests/e2e/playlist-picker.spec.ts
import { test, expect } from '@playwright/test';

test('pick a recent playlist fills the URL field and Fetch fires ingestion', async ({ page }) => {
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [
    { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } },
    { id: 'PLb', title: 'No Title Playlist', url: 'https://youtube.com/playlist?list=PLb', source: 'recent', meta: {} }, // null-title fixture (slug fell back server-side)
  ] } }));
  // resolve-folder so the Fetch button enables; capture the ingest POST body
  await page.route('**/api/resolve-folder**', (r) => r.fulfill({ json: { root: '/home/x/data', outputFolder: '/home/x/data/a/raw' } }));
  let ingestBody: any = null;
  await page.route('**/api/ingest', async (r) => { ingestBody = r.request().postDataJSON(); await r.fulfill({ json: { jobId: 'j1' } }); });

  await page.goto('/');
  const input = page.getByPlaceholder(/Paste a playlist URL/);
  await input.focus();
  await page.getByText('Building with Claude').click();
  await expect(input).toHaveValue('https://youtube.com/playlist?list=PLa');
  await page.getByRole('button', { name: /Fetch & Summarize/ }).click();
  await expect.poll(() => ingestBody?.playlistUrl).toBe('https://youtube.com/playlist?list=PLa');
});

test('browse a channel and pick a playlist fills the URL field', async ({ page }) => {
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [] } }));
  await page.route('**/api/playlists/channel**', (r) => r.fulfill({ json: { channelTitle: 'Anthropic', playlists: [
    { id: 'PLc', title: 'Research Talks', url: 'https://youtube.com/playlist?list=PLc', source: 'channel', meta: { videoCount: 31 } },
  ] } }));
  await page.goto('/');
  await page.getByPlaceholder(/Paste a playlist URL/).focus();
  await page.getByText(/Browse a channel/i).click();
  await page.getByPlaceholder(/@channel/).fill('@Anthropic');
  await page.getByText('Go').click();
  await page.getByText('Research Talks').click();
  await expect(page.getByPlaceholder(/Paste a playlist URL/)).toHaveValue('https://youtube.com/playlist?list=PLc');
});
```

> If the Fetch button stays disabled without a real resolve-folder fixpoint, assert the field value + panel behavior (the picker's job) and cover the ingest POST in a component/integration test instead — the picker's contract is "fill the field," which the existing Fetch flow already tests. Keep the null-title recent fixture regardless (spec E2E rule).

- [ ] **Step 2: Run E2E** — Run: `npx playwright test playlist-picker` → PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/playlist-picker.spec.ts
git commit -m "test(playlists): E2E pick-recent (fires Fetch) + pick-channel flows"
```

---

## Post-implementation (after Task 13, before PR)

1. Run the backfill once against real data: `YOUTUBE_API_KEY=… npm run backfill-playlist-titles -- --root ../youtube-playlist-summaries-official-plugins-data` → confirm the 3 existing playlists (agentic-ai, cs146s, 건강) gain `playlistTitle`.
2. `npm test` (full) + `npx tsc --noEmit` + `npx playwright test` all green.
3. Verify in the running app: recent dropdown shows names; channel panel resolves `@AnthropicAI`; name caption shows for a loaded playlist. Screenshots to `.screenshots/`, delete after.
4. `superpowers:finishing-a-development-branch` → PR.

---

## Self-Review (completed at authoring; Codex plan-review findings folded in)

- **Test infra (Codex B1):** all tests under `tests/{lib,api,components,scripts,e2e}/`, plain `npx jest`, jsdom pragma on `.test.tsx`, relative imports at correct depth. ✅
- **Spec coverage:** seam (T1), persistence (T2)+backfill (T8)+display (T9,T12), recent provider+route (T3,T4), channel lib+provider+route (T5,T6,T7), combobox (T10), panel w/ all dismissals + loading/404/502 + recents (T11), integration + name caption (T12), E2E w/ null-title fixture + Fetch assertion (T13). ✅
- **Contracts (Codex H1):** recent route returns `{ playlists }` everywhere (route, PlaylistPicker, E2E) and spec updated to match. ✅
- **Security (Codex H2, M2):** strict YouTube-host handle parse with rejection tests; `assertOutputFolder` at both route and provider/backfill entry points. ✅
- **Consistency (Codex H3, L1):** title omitted (never id) on fetch failure, with a test; fallback chain ends in "Untitled playlist". ✅
- **Type consistency:** `PlaylistOption`, `listRecentPlaylists`, `listChannelPlaylists`, `resolveChannelId`, `fetchChannelPlaylists`, `buildPlaylistUrl`, `backfillPlaylistTitles`, `playlistTitle` names identical across producer/consumer tasks. ✅
