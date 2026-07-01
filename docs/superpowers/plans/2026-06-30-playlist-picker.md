# Playlist Picker (A recent + B channel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "paste the exact playlist URL" field with a picker offering recent playlists (from local index files) and a channel's public playlists (via the YouTube API key), and persist + display the human playlist name instead of the `list=` id.

**Architecture:** A pluggable playlist-source seam (`lib/playlists/`) where every source returns a normalized `PlaylistOption`. Two providers now — `recent` (pure fs) and `channel` (YouTube API) — behind thin GET routes. A `playlistTitle` field is persisted to `playlist-index.json` at ingest and backfilled for existing playlists. The picker UI (recent combobox + channel modal) writes a selected playlist's URL into the existing Header URL field; the existing ingest flow is unchanged. A third source (OAuth, roadmap item C) can be added as another provider without touching the UI.

**Tech Stack:** Next.js (App Router), TypeScript, React, `googleapis`, Zod (index schema), Jest + ts-jest (unit/component), @testing-library/react, Playwright (E2E), Tailwind (zinc palette).

**Spec:** `docs/superpowers/specs/2026-06-30-playlist-picker-design.md`

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing Next.js route/handler code** (per AGENTS.md — this Next.js has breaking changes vs training data).
- **Scripts use relative imports**, never `@/*` (ts-node CommonJS override doesn't resolve path aliases; only jest's moduleNameMapper does).
- **All output-folder access goes through `assertOutputFolder`** (within-home + symlink guard) — never read a caller-supplied path without it.
- **Mock at the lib boundary** in unit/component tests (`lib/youtube.ts`, fs via temp dirs); E2E mocks at the API-route level. No real API calls in tests.
- **Canonical playlist URL** is `https://youtube.com/playlist?list=<id>` — strip `si=` and other params when building a URL from an id.
- **Label fallback chain (never show a bare hash):** `playlistTitle` → folder slug → `id`.
- **Frequent commits:** one commit per task after its tests pass.
- **Dark mode is the app default;** reuse the existing zinc palette — no new design tokens.

---

## File Structure

**Create:**
- `lib/playlists/types.ts` — `PlaylistOption`, `PlaylistSource`
- `lib/playlists/recent-provider.ts` — `listRecentPlaylists(root)`
- `lib/playlists/channel-provider.ts` — `listChannelPlaylists(handle, apiKey)`
- `lib/playlists/backfill-titles.ts` — `backfillPlaylistTitles(root, apiKey)`
- `scripts/backfill-playlist-titles.ts` — CLI wrapper
- `app/api/playlists/recent/route.ts`
- `app/api/playlists/channel/route.ts`
- `components/PlaylistPicker.tsx` — recent combobox (wraps the URL input)
- `components/ChannelPlaylistPanel.tsx` — channel modal
- Test files alongside each (see tasks).

**Modify:**
- `types/index.ts` — add `playlistTitle` to `PlaylistIndexSchema`
- `lib/youtube.ts` — add `resolveChannelId`, `fetchChannelPlaylists`, `buildPlaylistUrl`
- `lib/pipeline.ts` (~line 271) — stamp `playlistTitle` at ingest
- `app/api/videos/route.ts` — include `playlistTitle` in the response
- `app/page.tsx` — thread `currentPlaylistTitle` state → Header
- `components/Header.tsx` — mount picker + panel; `applyPickedUrl`; name caption
- `package.json` — add `backfill-playlist-titles` script

---

## Task 1: `PlaylistOption` type + `playlistTitle` schema field

**Files:**
- Create: `lib/playlists/types.ts`
- Modify: `types/index.ts` (PlaylistIndexSchema)
- Test: `lib/playlists/types.test.ts`, `types/playlist-index-title.test.ts`

**Interfaces:**
- Produces: `type PlaylistSource = 'recent' | 'channel'`; `type PlaylistOption = { id: string; title: string; url: string; source: PlaylistSource; meta?: { videoCount?: number; channelTitle?: string; thumbnailUrl?: string } }`. `PlaylistIndex` gains optional `playlistTitle?: string`.

- [ ] **Step 1: Write the failing schema test**

```ts
// types/playlist-index-title.test.ts
import { PlaylistIndexSchema } from './index';

describe('PlaylistIndexSchema playlistTitle', () => {
  const base = { playlistUrl: 'https://youtube.com/playlist?list=PLabc', outputFolder: '/tmp/x/raw', videos: [] };

  it('accepts an index with playlistTitle', () => {
    const parsed = PlaylistIndexSchema.parse({ ...base, playlistTitle: 'Building with Claude' });
    expect(parsed.playlistTitle).toBe('Building with Claude');
  });

  it('accepts an index without playlistTitle (optional, legacy)', () => {
    const parsed = PlaylistIndexSchema.parse(base);
    expect(parsed.playlistTitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest playlist-index-title -c jest.config.js`
Expected: FAIL — `playlistTitle` stripped/typed as never (unknown key) or property absent from parsed type.

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
// lib/playlists/types.test.ts
import type { PlaylistOption } from './types';

it('PlaylistOption is constructible with required + optional fields', () => {
  const o: PlaylistOption = {
    id: 'PLabc', title: 'X', url: 'https://youtube.com/playlist?list=PLabc',
    source: 'recent', meta: { videoCount: 3 },
  };
  expect(o.source).toBe('recent');
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest playlist-index-title types/../lib/playlists/types -c jest.config.js` then `npx tsc --noEmit`
Expected: PASS; tsc clean (jest uses SWC and does not typecheck — `tsc --noEmit` is the real type gate).

- [ ] **Step 6: Commit**

```bash
git add lib/playlists/types.ts lib/playlists/types.test.ts types/index.ts types/playlist-index-title.test.ts
git commit -m "feat(playlists): PlaylistOption type + optional playlistTitle on index schema"
```

---

## Task 2: Persist `playlistTitle` at ingest

**Files:**
- Modify: `lib/pipeline.ts` (~line 271, the `writeIndex(outputFolder, { ...existing, playlistUrl, outputFolder })` stamp)
- Modify: `lib/youtube.ts` (reuse existing `fetchPlaylistTitle`)
- Test: `lib/pipeline-playlist-title.test.ts`

**Interfaces:**
- Consumes: `fetchPlaylistTitle(playlistId, apiKey)` (existing, `lib/youtube.ts:101`), `extractPlaylistId`-equivalent (`new URL(url).searchParams.get('list')`).
- Produces: after `runIngestion`, the index's top-level `playlistTitle` is set to the fetched title (falls back to the id on fetch failure, matching `resolveOutputFolder`'s graceful degrade).

- [ ] **Step 1: Write the failing test**

```ts
// lib/pipeline-playlist-title.test.ts
jest.mock('./youtube', () => ({
  fetchPlaylistVideos: jest.fn(async () => []),
  fetchPlaylistTitle: jest.fn(async () => 'Building with Claude'),
}));
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runIngestion } from './pipeline';
import { readIndex } from './index-store';

it('stamps playlistTitle into the index on ingest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'));
  process.env.YOUTUBE_API_KEY = 'k';
  await runIngestion('https://youtube.com/playlist?list=PLabc', dir, () => {});
  expect(readIndex(dir).playlistTitle).toBe('Building with Claude');
});
```

> Note: `runIngestion` requires an output folder under `$HOME` (assertOutputFolder). Use a temp dir under `os.homedir()` if `os.tmpdir()` is outside home on the CI box — prefer `fs.mkdtempSync(path.join(os.homedir(), '.pl-test-'))` and clean up in `afterEach`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest pipeline-playlist-title -c jest.config.js`
Expected: FAIL — `playlistTitle` is `undefined`.

- [ ] **Step 3: Implement the stamp**

In `lib/pipeline.ts`, replace the playlistUrl stamp block (~line 268-272):

```ts
  // Stamp playlistUrl + human title into the index before processing. Title fetch
  // degrades to the id on failure (network/auth/quota) — never fails the ingest.
  const playlistId = (() => { try { return new URL(playlistUrl).searchParams.get('list'); } catch { return null; } })();
  let playlistTitle: string | undefined;
  if (playlistId) {
    try { playlistTitle = await fetchPlaylistTitle(playlistId, apiKey); } catch { playlistTitle = undefined; }
  }
  const existing = readIndex(outputFolder);
  writeIndex(outputFolder, { ...existing, playlistUrl, outputFolder, ...(playlistTitle ? { playlistTitle } : {}) });
```

Add `fetchPlaylistTitle` to the existing `./youtube` import in pipeline.ts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest pipeline-playlist-title -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Run the full pipeline suite (regression)**

Run: `npx jest pipeline -c jest.config.js`
Expected: PASS — no existing pipeline test regressed by the added stamp.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline.ts lib/pipeline-playlist-title.test.ts
git commit -m "feat(playlists): persist playlistTitle to the index at ingest"
```

---

## Task 3: Recent provider (pure fs)

**Files:**
- Create: `lib/playlists/recent-provider.ts`
- Test: `lib/playlists/recent-provider.test.ts`

**Interfaces:**
- Consumes: `PlaylistOption` (Task 1), `slugify` (`lib/slugify.ts`).
- Produces: `listRecentPlaylists(root: string): PlaylistOption[]` — scans `<root>/*/raw/playlist-index.json` **and** `<root>/*/playlist-index.json` (nested + flat, matching `output-folder.ts` `isPlaylistFolder`), sorted by folder mtime desc, `archived/` and invalid indexes skipped, label fallback applied, `url` rebuilt canonically from the id.

- [ ] **Step 1: Write the failing test**

```ts
// lib/playlists/recent-provider.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listRecentPlaylists } from './recent-provider';

function writePlaylist(root: string, dir: string, index: object) {
  const raw = path.join(root, dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'playlist-index.json'), JSON.stringify(index));
}

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

it('returns titled options for playlists with playlistTitle', () => {
  writePlaylist(root, 'agentic', { playlistUrl: 'https://youtube.com/playlist?list=PLa&si=z', playlistTitle: 'Building with Claude', videos: [{ id: 'a' }, { id: 'b' }] });
  const out = listRecentPlaylists(root);
  expect(out).toEqual([{ id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 2 } }]);
});

it('falls back to folder slug when playlistTitle is missing (never the id)', () => {
  writePlaylist(root, 'cs146s-modern-software', { playlistUrl: 'https://youtube.com/playlist?list=PLb', videos: [] });
  expect(listRecentPlaylists(root)[0].title).toBe('cs146s-modern-software');
});

it('skips archived/ and corrupt/indexless folders', () => {
  fs.mkdirSync(path.join(root, 'archived', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'archived', 'raw', 'playlist-index.json'), '{"playlistUrl":"https://youtube.com/playlist?list=PLarch","videos":[]}');
  fs.mkdirSync(path.join(root, 'empty'), { recursive: true });
  fs.mkdirSync(path.join(root, 'corrupt', 'raw'), { recursive: true });
  fs.writeFileSync(path.join(root, 'corrupt', 'raw', 'playlist-index.json'), '{ not json');
  writePlaylist(root, 'good', { playlistUrl: 'https://youtube.com/playlist?list=PLgood', playlistTitle: 'Good', videos: [] });
  const out = listRecentPlaylists(root);
  expect(out.map((o) => o.id)).toEqual(['PLgood']);
});

it('returns [] for a missing root', () => {
  expect(listRecentPlaylists(path.join(root, 'nope'))).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest recent-provider -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/playlists/recent-provider.ts
import fs from 'fs';
import path from 'path';
import type { PlaylistOption } from './types';

function extractId(url: string): string | null {
  try { return new URL(url).searchParams.get('list'); } catch { return null; }
}

/** Read one playlist folder's index (nested raw/ or flat). Returns null if none/invalid. */
function readCandidate(dir: string): { file: string; index: { playlistUrl?: string; playlistTitle?: string; videos?: unknown[] } } | null {
  for (const candidate of [path.join(dir, 'raw'), dir]) {
    const file = path.join(candidate, 'playlist-index.json');
    if (!fs.existsSync(file)) continue;
    try { return { file, index: JSON.parse(fs.readFileSync(file, 'utf-8')) }; } catch { return null; }
  }
  return null;
}

export function listRecentPlaylists(root: string): PlaylistOption[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }

  const rows: { option: PlaylistOption; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archived') continue;
    const dir = path.join(root, entry.name);
    const found = readCandidate(dir);
    if (!found) continue;
    const id = extractId(found.index.playlistUrl ?? '');
    if (!id) continue;
    const title = found.index.playlistTitle || entry.name || 'Untitled playlist'; // never the id (Codex M1)
    const videoCount = Array.isArray(found.index.videos) ? found.index.videos.length : undefined;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(found.file).mtimeMs; } catch { /* keep 0 */ }
    rows.push({
      option: { id, title, url: `https://youtube.com/playlist?list=${id}`, source: 'recent', meta: { videoCount } },
      mtimeMs,
    });
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map((r) => r.option);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest recent-provider -c jest.config.js` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/playlists/recent-provider.ts lib/playlists/recent-provider.test.ts
git commit -m "feat(playlists): recent provider — scan local indexes into PlaylistOption[]"
```

---

## Task 4: `GET /api/playlists/recent`

**Files:**
- Create: `app/api/playlists/recent/route.ts`
- Test: `app/api/playlists/recent/route.test.ts`

**Interfaces:**
- Consumes: `listRecentPlaylists` (Task 3), `assertOutputFolder` (`lib/index-store.ts`).
- Produces: `GET /api/playlists/recent?root=<enc>` → `200 { playlists: PlaylistOption[] }`; `400 { error }` on missing/invalid root.

- [ ] **Step 1: Read the Next.js route-handler docs**

Run: check `node_modules/next/dist/docs/` for the App Router route-handler API (GET signature, `Request`, `Response`/`NextResponse`). Match the existing pattern in `app/api/html/[id]/route.ts`.

- [ ] **Step 2: Write the failing test**

```ts
// app/api/playlists/recent/route.test.ts
jest.mock('../../../../lib/playlists/recent-provider', () => ({
  listRecentPlaylists: jest.fn(() => [{ id: 'PLa', title: 'X', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: {} }]),
}));
import { GET } from './route';

function req(url: string) { return new Request(url); }

it('400 when root is missing', async () => {
  const res = await GET(req('http://localhost/api/playlists/recent'));
  expect(res.status).toBe(400);
});

it('400 when root fails the home guard', async () => {
  const res = await GET(req('http://localhost/api/playlists/recent?root=' + encodeURIComponent('/etc')));
  expect(res.status).toBe(400);
});

it('200 with playlists for a valid root', async () => {
  const root = process.env.HOME + '/some-data-root';
  const res = await GET(req('http://localhost/api/playlists/recent?root=' + encodeURIComponent(root)));
  expect(res.status).toBe(200);
  expect((await res.json()).playlists[0].id).toBe('PLa');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest api/playlists/recent -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// app/api/playlists/recent/route.ts
import { assertOutputFolder } from '../../../../lib/index-store';
import { listRecentPlaylists } from '../../../../lib/playlists/recent-provider';

export async function GET(request: Request) {
  const root = new URL(request.url).searchParams.get('root');
  if (!root) return Response.json({ error: 'root is required' }, { status: 400 });
  try {
    assertOutputFolder(root); // within-home + symlink guard
  } catch {
    return Response.json({ error: 'invalid root' }, { status: 400 });
  }
  return Response.json({ playlists: listRecentPlaylists(root) });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest api/playlists/recent -c jest.config.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/playlists/recent/route.ts app/api/playlists/recent/route.test.ts
git commit -m "feat(playlists): GET /api/playlists/recent (home-guarded)"
```

---

## Task 5: Channel API calls in `lib/youtube.ts`

**Files:**
- Modify: `lib/youtube.ts`
- Test: `lib/youtube-channel.test.ts`

**Interfaces:**
- Produces:
  - `parseChannelHandle(input: string): { handle?: string; channelId?: string }` — accepts `@name`, `name`, `youtube.com/@name`, `youtube.com/channel/UC…`.
  - `resolveChannelId(input: string, apiKey: string): Promise<{ channelId: string; channelTitle: string }>` — throws `ChannelNotFoundError` when unresolved.
  - `fetchChannelPlaylists(channelId: string, apiKey: string): Promise<{ id: string; title: string; itemCount?: number; thumbnailUrl?: string }[]>` — one page, `maxResults: 50`.
  - `buildPlaylistUrl(id: string): string` → `https://youtube.com/playlist?list=<id>`.
  - `export class ChannelNotFoundError extends Error {}`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/youtube-channel.test.ts
const channelsList = jest.fn();
const playlistsList = jest.fn();
jest.mock('googleapis', () => ({
  google: { youtube: () => ({ channels: { list: channelsList }, playlists: { list: playlistsList } }) },
}));
import { parseChannelHandle, resolveChannelId, fetchChannelPlaylists, buildPlaylistUrl, ChannelNotFoundError } from './youtube';

beforeEach(() => { channelsList.mockReset(); playlistsList.mockReset(); });

describe('parseChannelHandle', () => {
  it('strips @ and bare handle', () => { expect(parseChannelHandle('@Anthropic')).toEqual({ handle: 'Anthropic' }); expect(parseChannelHandle('Anthropic')).toEqual({ handle: 'Anthropic' }); });
  it('parses a channel URL with @handle', () => { expect(parseChannelHandle('https://youtube.com/@Anthropic')).toEqual({ handle: 'Anthropic' }); });
  it('parses a /channel/UC… URL to channelId', () => { expect(parseChannelHandle('https://youtube.com/channel/UC1234567890abcdefghijkl')).toEqual({ channelId: 'UC1234567890abcdefghijkl' }); });
  it('rejects an oversized handle (>30 chars) → {}', () => { expect(parseChannelHandle('a'.repeat(31))).toEqual({}); });
  it('rejects handles with illegal chars → {}', () => { expect(parseChannelHandle('bad name!')).toEqual({}); });
  it('rejects a malformed channel id → {}', () => { expect(parseChannelHandle('channel/XY1')).toEqual({}); });
});

it('resolveChannelId returns id+title for a known handle', async () => {
  channelsList.mockResolvedValue({ data: { items: [{ id: 'UC1', snippet: { title: 'Anthropic' } }] } });
  await expect(resolveChannelId('@Anthropic', 'k')).resolves.toEqual({ channelId: 'UC1', channelTitle: 'Anthropic' });
  expect(channelsList).toHaveBeenCalledWith(expect.objectContaining({ forHandle: 'Anthropic' }));
});

it('resolveChannelId throws ChannelNotFoundError when no channel', async () => {
  channelsList.mockResolvedValue({ data: { items: [] } });
  await expect(resolveChannelId('@nope', 'k')).rejects.toBeInstanceOf(ChannelNotFoundError);
});

it('fetchChannelPlaylists maps snippet + contentDetails', async () => {
  playlistsList.mockResolvedValue({ data: { items: [
    { id: 'PLa', snippet: { title: 'A', thumbnails: { medium: { url: 'http://t/a.jpg' } } }, contentDetails: { itemCount: 7 } },
  ] } });
  await expect(fetchChannelPlaylists('UC1', 'k')).resolves.toEqual([
    { id: 'PLa', title: 'A', itemCount: 7, thumbnailUrl: 'http://t/a.jpg' },
  ]);
});

it('buildPlaylistUrl is canonical', () => { expect(buildPlaylistUrl('PLa')).toBe('https://youtube.com/playlist?list=PLa'); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest youtube-channel -c jest.config.js`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement in `lib/youtube.ts`**

```ts
export class ChannelNotFoundError extends Error {}

export function buildPlaylistUrl(id: string): string {
  return `https://youtube.com/playlist?list=${id}`;
}

// Strict allowlist parse (Codex H2). Returns {} for anything that doesn't match a
// valid handle or channelId — callers map {} to ChannelNotFound (no API call, no quota burn).
const HANDLE_RE = /^[A-Za-z0-9._-]{1,30}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{20,}$/;

export function parseChannelHandle(input: string): { handle?: string; channelId?: string } {
  const trimmed = input.trim();
  // /channel/UC… URL or bare channel id
  const chan = trimmed.match(/channel\/(UC[A-Za-z0-9_-]+)/);
  const chanId = chan ? chan[1] : (CHANNEL_ID_RE.test(trimmed) ? trimmed : null);
  if (chanId && CHANNEL_ID_RE.test(chanId)) return { channelId: chanId };
  // @handle in a URL or bare @handle
  const at = trimmed.match(/@([A-Za-z0-9._-]+)/);
  const handle = at ? at[1] : (!/[/\s@]/.test(trimmed) ? trimmed : null);
  if (handle && HANDLE_RE.test(handle)) return { handle };
  return {}; // invalid / oversized / unrecognized → not found
}

export async function resolveChannelId(input: string, apiKey: string): Promise<{ channelId: string; channelTitle: string }> {
  const parsed = parseChannelHandle(input);
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  if (parsed.channelId) {
    const res = await yt.channels.list({ part: ['snippet'], id: [parsed.channelId] });
    const item = res.data.items?.[0];
    if (!item?.id) throw new ChannelNotFoundError(`channel not found: ${input}`);
    return { channelId: item.id, channelTitle: item.snippet?.title ?? item.id };
  }
  if (parsed.handle) {
    const res = await yt.channels.list({ part: ['snippet'], forHandle: parsed.handle });
    const item = res.data.items?.[0];
    if (!item?.id) throw new ChannelNotFoundError(`channel not found: ${input}`);
    return { channelId: item.id, channelTitle: item.snippet?.title ?? item.id };
  }
  throw new ChannelNotFoundError(`unrecognized channel input: ${input}`);
}

export async function fetchChannelPlaylists(channelId: string, apiKey: string): Promise<{ id: string; title: string; itemCount?: number; thumbnailUrl?: string }[]> {
  const yt = google.youtube({ version: 'v3', auth: apiKey });
  const res = await yt.playlists.list({ part: ['snippet', 'contentDetails'], channelId, maxResults: 50 });
  return (res.data.items ?? [])
    .filter((i) => i.id)
    .map((i) => ({
      id: i.id as string,
      title: i.snippet?.title ?? (i.id as string),
      itemCount: i.contentDetails?.itemCount ?? undefined,
      thumbnailUrl: i.snippet?.thumbnails?.medium?.url ?? i.snippet?.thumbnails?.default?.url ?? undefined,
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest youtube-channel -c jest.config.js` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube.ts lib/youtube-channel.test.ts
git commit -m "feat(playlists): channel resolve + list + handle parsing in youtube lib"
```

---

## Task 6: Channel provider

**Files:**
- Create: `lib/playlists/channel-provider.ts`
- Test: `lib/playlists/channel-provider.test.ts`

**Interfaces:**
- Consumes: `resolveChannelId`, `fetchChannelPlaylists`, `buildPlaylistUrl`, `ChannelNotFoundError` (Task 5); `PlaylistOption` (Task 1).
- Produces: `listChannelPlaylists(handle: string, apiKey: string): Promise<{ channelTitle: string; playlists: PlaylistOption[] }>` — normalizes to `PlaylistOption[]` (`source: 'channel'`, `meta.channelTitle`, `meta.videoCount = itemCount`, `meta.thumbnailUrl`).

- [ ] **Step 1: Write the failing test**

```ts
// lib/playlists/channel-provider.test.ts
jest.mock('../youtube', () => ({
  resolveChannelId: jest.fn(async () => ({ channelId: 'UC1', channelTitle: 'Anthropic' })),
  fetchChannelPlaylists: jest.fn(async () => [{ id: 'PLa', title: 'A', itemCount: 7, thumbnailUrl: 'http://t/a.jpg' }]),
  buildPlaylistUrl: (id: string) => `https://youtube.com/playlist?list=${id}`,
  ChannelNotFoundError: class extends Error {},
}));
import { listChannelPlaylists } from './channel-provider';

it('normalizes channel playlists into PlaylistOption[]', async () => {
  const out = await listChannelPlaylists('@Anthropic', 'k');
  expect(out.channelTitle).toBe('Anthropic');
  expect(out.playlists).toEqual([{
    id: 'PLa', title: 'A', url: 'https://youtube.com/playlist?list=PLa', source: 'channel',
    meta: { videoCount: 7, channelTitle: 'Anthropic', thumbnailUrl: 'http://t/a.jpg' },
  }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest channel-provider -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// lib/playlists/channel-provider.ts
import { resolveChannelId, fetchChannelPlaylists, buildPlaylistUrl } from '../youtube';
import type { PlaylistOption } from './types';

export async function listChannelPlaylists(handle: string, apiKey: string): Promise<{ channelTitle: string; playlists: PlaylistOption[] }> {
  const { channelId, channelTitle } = await resolveChannelId(handle, apiKey);
  const raw = await fetchChannelPlaylists(channelId, apiKey);
  const playlists: PlaylistOption[] = raw.map((p) => ({
    id: p.id,
    title: p.title,
    url: buildPlaylistUrl(p.id),
    source: 'channel',
    meta: { videoCount: p.itemCount, channelTitle, thumbnailUrl: p.thumbnailUrl },
  }));
  return { channelTitle, playlists };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest channel-provider -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/playlists/channel-provider.ts lib/playlists/channel-provider.test.ts
git commit -m "feat(playlists): channel provider — normalize to PlaylistOption[]"
```

---

## Task 7: `GET /api/playlists/channel`

**Files:**
- Create: `app/api/playlists/channel/route.ts`
- Test: `app/api/playlists/channel/route.test.ts`

**Interfaces:**
- Consumes: `listChannelPlaylists` (Task 6), `ChannelNotFoundError` (Task 5).
- Produces: `GET /api/playlists/channel?handle=<enc>` → `200 { channelTitle, playlists }`; `400` missing handle; `404` channel not found; `502` upstream/API error. Reads `YOUTUBE_API_KEY` from env; `500` if unset.

- [ ] **Step 1: Read the Next.js route-handler docs** (as Task 4 Step 1).

- [ ] **Step 2: Write the failing tests**

```ts
// app/api/playlists/channel/route.test.ts
const listChannelPlaylists = jest.fn();
jest.mock('../../../../lib/playlists/channel-provider', () => ({ listChannelPlaylists }));
jest.mock('../../../../lib/youtube', () => ({ ChannelNotFoundError: class extends Error {} }));
import { GET } from './route';
import { ChannelNotFoundError } from '../../../../lib/youtube';

const req = (u: string) => new Request(u);
beforeEach(() => { listChannelPlaylists.mockReset(); process.env.YOUTUBE_API_KEY = 'k'; });

it('400 when handle missing', async () => {
  expect((await GET(req('http://x/api/playlists/channel'))).status).toBe(400);
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

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest api/playlists/channel -c jest.config.js`
Expected: FAIL — module not found.

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
    const result = await listChannelPlaylists(handle, apiKey);
    return Response.json(result);
  } catch (err) {
    if (err instanceof ChannelNotFoundError) return Response.json({ error: `No channel found for '${handle}'` }, { status: 404 });
    return Response.json({ error: 'Could not reach YouTube' }, { status: 502 });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest api/playlists/channel -c jest.config.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/playlists/channel/route.ts app/api/playlists/channel/route.test.ts
git commit -m "feat(playlists): GET /api/playlists/channel (404/502 mapped)"
```

---

## Task 8: Backfill script for existing playlists

**Files:**
- Create: `lib/playlists/backfill-titles.ts`, `scripts/backfill-playlist-titles.ts`
- Modify: `package.json` (scripts)
- Test: `lib/playlists/backfill-titles.test.ts`

**Interfaces:**
- Consumes: `readIndex`/`writeIndex` (`lib/index-store.ts`), `fetchPlaylistTitle` (`lib/youtube.ts`), `listRecentPlaylists` is NOT reused (need folder paths, not options).
- Produces: `backfillPlaylistTitles(root: string, apiKey: string): Promise<{ updated: string[]; skipped: string[]; failed: string[] }>` — for each playlist folder missing `playlistTitle`, fetch by id and write it; leave populated ones (skipped); record fetch failures (failed) without throwing.

- [ ] **Step 1: Write the failing test**

```ts
// lib/playlists/backfill-titles.test.ts
jest.mock('../youtube', () => ({ fetchPlaylistTitle: jest.fn(async (id: string) => id === 'PLbad' ? Promise.reject(new Error('quota')) : `Title ${id}`) }));
import fs from 'fs';
import os from 'os';
import path from 'path';
import { backfillPlaylistTitles } from './backfill-titles';

function writePlaylist(root: string, dir: string, index: object) {
  const raw = path.join(root, dir, 'raw');
  fs.mkdirSync(raw, { recursive: true });
  fs.writeFileSync(path.join(raw, 'playlist-index.json'), JSON.stringify(index));
  return path.join(raw, 'playlist-index.json');
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
  expect(res.updated).toContain(path.join(root, 'a', 'raw'));
  expect(res.skipped.some((p) => p.includes('/b/'))).toBe(true);
  expect(res.failed.some((p) => p.includes('/c/'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest backfill-titles -c jest.config.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the lib function**

```ts
// lib/playlists/backfill-titles.ts
import fs from 'fs';
import path from 'path';
import { readIndex, writeIndex } from '../index-store';
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
  const updated: string[] = [], skipped: string[] = [], failed: string[] = [];
  for (const folder of playlistFolders(root)) {
    let index;
    try { index = readIndex(folder); } catch { failed.push(folder); continue; }
    if (index.playlistTitle) { skipped.push(folder); continue; }
    const id = extractId(index.playlistUrl ?? '');
    if (!id) { failed.push(folder); continue; }
    try {
      const title = await fetchPlaylistTitle(id, apiKey);
      writeIndex(folder, { ...index, playlistTitle: title });
      updated.push(folder);
    } catch { failed.push(folder); }
  }
  return { updated, skipped, failed };
}
```

- [ ] **Step 4: Create the CLI wrapper**

```ts
// scripts/backfill-playlist-titles.ts
// NOTE: relative imports — ts-node (CommonJS override) does NOT resolve `@/*` at runtime.
import { backfillPlaylistTitles } from '../lib/playlists/backfill-titles';

async function main() {
  const args = process.argv.slice(2);
  const folderArg = args.indexOf('--root');
  const root = folderArg !== -1 ? args[folderArg + 1] : process.cwd();
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) { console.error('YOUTUBE_API_KEY is not set'); process.exit(1); }
  console.log('⚠️  Writes playlist-index.json in place — do NOT run concurrently with ingestion/sync.');
  const res = await backfillPlaylistTitles(root, apiKey);
  console.log(`Backfill: ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.failed.length} failed`);
  for (const f of res.failed) console.log(`  FAILED: ${f}`);
}
main();
```

Add to `package.json` scripts (mirror the existing `audit-summaries` entry):

```json
"backfill-playlist-titles": "TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' ts-node scripts/backfill-playlist-titles.ts"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest backfill-titles -c jest.config.js` then `npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/playlists/backfill-titles.ts lib/playlists/backfill-titles.test.ts scripts/backfill-playlist-titles.ts package.json
git commit -m "feat(playlists): backfill-playlist-titles script + lib fn"
```

---

## Task 9: Expose `playlistTitle` on `/api/videos`

**Files:**
- Modify: `app/api/videos/route.ts` (include `playlistTitle` in the JSON the page consumes)
- Test: `app/api/videos/route.test.ts` (extend existing, or add a focused test)

**Interfaces:**
- Produces: the `/api/videos` response object gains `playlistTitle?: string` (read from the index). Consumed by `app/page.tsx` in Task 12.

- [ ] **Step 1: Inspect the current route** — read `app/api/videos/route.ts` to see the exact response shape (it already returns `playlistUrl`). Add `playlistTitle` alongside it from `readIndex(...)`.

- [ ] **Step 2: Write the failing test**

```ts
// add to app/api/videos/route.test.ts
it('includes playlistTitle from the index', async () => {
  // arrange: mock readIndex to return { playlistUrl, playlistTitle: 'X', videos: [] }
  // act: call GET with a valid outputFolder
  // assert: (await res.json()).playlistTitle === 'X'
});
```

(Fill the arrange/act to match the file's existing mocking style — follow the neighbors in that test file.)

- [ ] **Step 3: Run test to verify it fails** — Run: `npx jest api/videos -c jest.config.js` → FAIL.

- [ ] **Step 4: Implement** — add `playlistTitle: index.playlistTitle` to the response payload next to the existing `playlistUrl`.

- [ ] **Step 5: Run tests to verify they pass** — Run: `npx jest api/videos -c jest.config.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/videos/route.ts app/api/videos/route.test.ts
git commit -m "feat(playlists): expose playlistTitle on /api/videos"
```

---

## Task 10: Recent combobox component

**Files:**
- Create: `components/PlaylistPicker.tsx`
- Test: `components/PlaylistPicker.test.tsx`

**Interfaces:**
- Consumes: `PlaylistOption` (Task 1); `GET /api/playlists/recent` (Task 4).
- Produces: `<PlaylistPicker root value onChange onPick onBrowseChannel />` — renders the URL text input (`value`/`onChange` passthrough so free-typing still works) with a dropdown of recent options fetched on focus; selecting an option calls `onPick(url)`; a footer row "Browse a channel's playlists…" calls `onBrowseChannel()`. Props:

```ts
type Props = {
  root: string;
  value: string;                       // current URL field value
  onChange: (v: string) => void;       // free-typing passthrough
  onPick: (url: string) => void;       // option selected (also closes dropdown)
  onBrowseChannel: () => void;
  disabled?: boolean;
};
```

- [ ] **Step 1: Write the failing tests**

```tsx
// components/PlaylistPicker.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlaylistPicker from './PlaylistPicker';

const options = [{ id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } }];
beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ playlists: options }) })) as any; });

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

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest PlaylistPicker -c jest.config.js` → FAIL (module not found).

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
            <button key={o.id} type="button"
              onClick={() => { onPick(o.url); setOpen(false); }}
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

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx jest PlaylistPicker -c jest.config.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add components/PlaylistPicker.tsx components/PlaylistPicker.test.tsx
git commit -m "feat(playlists): recent combobox component"
```

---

## Task 11: Channel panel component

**Files:**
- Create: `components/ChannelPlaylistPanel.tsx`
- Test: `components/ChannelPlaylistPanel.test.tsx`

**Interfaces:**
- Consumes: `PlaylistOption` (Task 1); `GET /api/playlists/channel` (Task 7).
- Produces: `<ChannelPlaylistPanel onSelect onClose />` — modal with a handle input + Go, remembered-recents chips (localStorage key `playlist-picker:channel-recents`), a results list, loading + error states. Dismissal: ✕, Escape, backdrop click → `onClose()`; selecting a playlist → `onSelect(url)` then `onClose()`. On a successful lookup, push the handle onto the recents chips.

- [ ] **Step 1: Write the failing tests** — cover: render input; Go fetches + lists titles; select calls `onSelect(url)`; **all four dismissal paths** (✕, Escape, backdrop, select); not-found (404) shows "No channel found"; error (502) shows "Couldn't reach YouTube"; recents chip persists to and refills from localStorage.

```tsx
// components/ChannelPlaylistPanel.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChannelPlaylistPanel from './ChannelPlaylistPanel';

const okBody = { channelTitle: 'Anthropic', playlists: [{ id: 'PLa', title: 'A', url: 'https://youtube.com/playlist?list=PLa', source: 'channel', meta: { videoCount: 7 } }] };
function mockFetch(status: number, body: unknown) { global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body })) as any; }
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
])('dismisses via %s', async (_n, act) => {
  const onClose = jest.fn();
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={onClose} />);
  act();
  expect(onClose).toHaveBeenCalled();
});

it('shows not-found on 404', async () => {
  mockFetch(404, { error: "No channel found for '@nope'" });
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@nope' } });
  fireEvent.click(screen.getByText('Go'));
  expect(await screen.findByText(/No channel found/i)).toBeInTheDocument();
});

it('remembers the handle as a chip', async () => {
  render(<ChannelPlaylistPanel onSelect={() => {}} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '@Anthropic' } });
  fireEvent.click(screen.getByText('Go'));
  await screen.findByText('A');
  expect(JSON.parse(localStorage.getItem('playlist-picker:channel-recents') || '[]')).toContain('@Anthropic');
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest ChannelPlaylistPanel -c jest.config.js` → FAIL.

- [ ] **Step 3: Implement** (modal with backdrop `data-testid="panel-backdrop"`, Escape listener via `useEffect`, ✕ `aria-label="Close"`, handle input + Go, recents chips from localStorage, results list, `loading`/`error` states mapping 404→"No channel found for '<handle>'", other→"Couldn't reach YouTube — try again"). Reuse zinc palette per spec. Push handle to recents on success.

```tsx
// components/ChannelPlaylistPanel.tsx  (skeleton — fill per tests above)
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
    <div data-testid="panel-backdrop" onClick={onClose}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
      <div onClick={(e) => e.stopPropagation()}
        className="w-[32rem] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-100">
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

- [ ] **Step 4: Run tests to verify they pass** — Run: `npx jest ChannelPlaylistPanel -c jest.config.js` → PASS (all dismissal paths + errors + recents).

- [ ] **Step 5: Commit**

```bash
git add components/ChannelPlaylistPanel.tsx components/ChannelPlaylistPanel.test.tsx
git commit -m "feat(playlists): channel playlist panel (modal + recents + errors)"
```

---

## Task 12: Integrate into Header + current-playlist name caption

**Files:**
- Modify: `components/Header.tsx`, `app/page.tsx`
- Test: `components/Header.test.tsx` (extend), `components/Header-picker.test.tsx` (new)

**Interfaces:**
- Consumes: `PlaylistPicker` (Task 10), `ChannelPlaylistPanel` (Task 11), `currentPlaylistTitle` prop (new).
- Produces: Header Row 2 uses `<PlaylistPicker>` in place of the bare `<input>`; a `channelPanelOpen` state renders `<ChannelPlaylistPanel>`; a helper `applyPickedUrl(url)` sets the URL + `urlEditedByUser.current = true`; a name caption renders above/near Row 2 when `currentPlaylistTitle` is set.

- [ ] **Step 1: Write the failing tests**

```tsx
// components/Header-picker.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import Header from './Header';

it('renders the current playlist name caption when provided', () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/a/raw"
    currentPlaylistTitle="Building with Claude" onIngest={() => {}} />);
  expect(screen.getByText(/Building with Claude/)).toBeInTheDocument();
});

it('opens the channel panel from the picker footer', async () => {
  render(<Header defaultBaseOutputFolder="/home/x/data" defaultOutputFolder="/home/x/data/a/raw" onIngest={() => {}} />);
  fireEvent.focus(screen.getByRole('textbox', { name: '' })); // the picker input
  fireEvent.click(await screen.findByText(/Browse a channel/i));
  expect(await screen.findByText(/Browse channel playlists/i)).toBeInTheDocument();
});
```

(Adjust selectors to the existing Header test conventions; mock `fetch` for `/api/playlists/recent` as in Task 10.)

- [ ] **Step 2: Run test to verify it fails** — Run: `npx jest Header-picker -c jest.config.js` → FAIL.

- [ ] **Step 3: Implement**
  - Add `currentPlaylistTitle?: string` to `HeaderProps`.
  - Replace the Row 2 `<input>` (Header.tsx:252-258) with `<PlaylistPicker root={trimRoot} value={playlistUrl} onChange={handleUrlChange} onPick={applyPickedUrl} onBrowseChannel={() => setChannelPanelOpen(true)} disabled={disabled} />`.
  - `const applyPickedUrl = useCallback((url: string) => { setPlaylistUrl(url); urlEditedByUser.current = true; }, []);`
  - Add `const [channelPanelOpen, setChannelPanelOpen] = useState(false);` and render `{channelPanelOpen && <ChannelPlaylistPanel onSelect={(url) => { applyPickedUrl(url); setChannelPanelOpen(false); }} onClose={() => setChannelPanelOpen(false)} />}`.
  - Add the name caption near Row 2: `{currentPlaylistTitle && <p className="text-xs text-zinc-400 pl-1">▶ {currentPlaylistTitle}</p>}`.

- [ ] **Step 4: Thread `currentPlaylistTitle` in `app/page.tsx`**
  - Add `const [currentPlaylistTitle, setCurrentPlaylistTitle] = useState('');`
  - Where `setCurrentPlaylistUrl(data.playlistUrl ?? '')` runs (page.tsx:133), add `setCurrentPlaylistTitle(data.playlistTitle ?? '')`.
  - Pass `currentPlaylistTitle={currentPlaylistTitle}` to `<Header>` (page.tsx:480 area).

- [ ] **Step 5: Run tests to verify they pass** — Run: `npx jest Header -c jest.config.js` → PASS (existing Header tests + new picker tests). Then `npx tsc --noEmit`.

- [ ] **Step 6: Run the full unit/component suite (regression)** — Run: `npm test` → all green.

- [ ] **Step 7: Commit**

```bash
git add components/Header.tsx components/Header-picker.test.tsx app/page.tsx
git commit -m "feat(playlists): mount picker + channel panel in Header; show playlist name caption"
```

---

## Task 13: E2E — pick-recent and pick-channel flows

**Files:**
- Create: `e2e/playlist-picker.spec.ts`
- Test fixtures: mock `/api/playlists/recent` and `/api/playlists/channel` at the route level via Playwright `page.route`.

**Interfaces:**
- Consumes: the running app; the two picker API routes.

- [ ] **Step 1: Write the E2E spec**

```ts
// e2e/playlist-picker.spec.ts
import { test, expect } from '@playwright/test';

test('pick a recent playlist fills the URL field', async ({ page }) => {
  await page.route('**/api/playlists/recent**', (r) => r.fulfill({ json: { playlists: [
    { id: 'PLa', title: 'Building with Claude', url: 'https://youtube.com/playlist?list=PLa', source: 'recent', meta: { videoCount: 114 } },
    { id: 'PLb', title: 'No Title Playlist', url: 'https://youtube.com/playlist?list=PLb', source: 'recent', meta: {} }, // null-title fixture (slug fell back server-side)
  ] } }));
  await page.goto('/');
  const input = page.getByPlaceholder(/Paste a playlist URL/);
  await input.focus();
  await page.getByText('Building with Claude').click();
  await expect(input).toHaveValue('https://youtube.com/playlist?list=PLa');
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

- [ ] **Step 2: Run E2E** — Run: `npx playwright test playlist-picker` → PASS (both flows; fixtures include a null-title recent per the spec's E2E rule).

- [ ] **Step 3: Commit**

```bash
git add e2e/playlist-picker.spec.ts
git commit -m "test(playlists): E2E pick-recent + pick-channel flows"
```

---

## Post-implementation (after Task 13, before PR)

1. Run the backfill once against real data: `YOUTUBE_API_KEY=… npm run backfill-playlist-titles -- --root ../youtube-playlist-summaries-official-plugins-data` → confirm the 3 existing playlists (agentic-ai, cs146s, 건강) gain `playlistTitle`.
2. `npm test` (full) + `npx tsc --noEmit` + `npx playwright test` all green.
3. Verify in the running app: recent dropdown shows names; channel panel resolves `@AnthropicAI`; name caption shows for a loaded playlist. Screenshots to `.screenshots/`, delete after.
4. `superpowers:finishing-a-development-branch` → PR.

---

## Self-Review (completed at authoring)

- **Spec coverage:** PlaylistOption seam (T1), title persistence (T2) + backfill (T8) + display (T9,T12), recent provider+route (T3,T4), channel lib+provider+route (T5,T6,T7), recent combobox (T10), channel panel with all 4 dismissal paths + errors + recents (T11), integration + name caption (T12), E2E with null-title fixture (T13). All spec sections mapped.
- **Placeholder scan:** Task 9 Step 2 leaves the arrange/act to match the existing test file's mocking style (the file wasn't read at authoring); flagged explicitly, not a hidden TODO. All other steps carry concrete code.
- **Type consistency:** `PlaylistOption` shape identical across T1/T3/T6/T10/T11; `listRecentPlaylists`/`listChannelPlaylists`/`resolveChannelId`/`fetchChannelPlaylists`/`buildPlaylistUrl`/`backfillPlaylistTitles` names consistent between producer and consumer tasks; `playlistTitle` field consistent T1↔T2↔T8↔T9.
- **Security:** every caller-supplied path (`root`) guarded by `assertOutputFolder`; channel handle is URL-encoded and only ever passed to the YouTube API (no fs/shell); canonical URL is rebuilt from the id (no `si=` passthrough).
