# Stage 1A (Part 1) — MetadataStore Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `MetadataStore` capability contract (with a `Principal` parameter) in front of the playlist-index read/write functions, implement it with a behavior-preserving `LocalFsMetadataStore`, and route every consumer through it — so a `SupabaseMetadataStore` can later slot in with zero consumer changes.

**Architecture:** Define a narrow `MetadataStore` interface whose methods mirror the current `lib/index-store` data-access functions but take a `Principal` instead of a raw `outputFolder` string. A `LocalFsMetadataStore` delegates to the existing `index-store` functions using `principal.outputFolder`, so behavior is byte-identical. A resolver (`getMetadataStore()` / `getPrincipal()`) centralizes selection and the local home-dir guard. This is a pure seam: no cloud code, no behavior change, no doc-version bumps.

**Tech Stack:** TypeScript, Next.js 16.2.6 (App Router), Zod (existing schemas in `types/index.ts`), Jest + SWC.

## Global Constraints

- **Next.js 16.2.6, App Router.** This plan touches only `lib/` and route *handlers'* internals — no new Next APIs. If a task ever needs a Next API, read `node_modules/next/dist/docs/` first (per `AGENTS.md`).
- **`tsc --noEmit` is the real type gate.** Jest runs via SWC and does **not** typecheck. Every task ends by running `npx tsc --noEmit` in addition to jest.
- **Behavior-preserving refactor.** The full existing Jest suite (1500+ tests) must stay green at every commit. No test may be deleted or weakened. No `docVersion` bump. No data migration.
- **Principal from day one** (spec §4.1): every `MetadataStore` method takes a `Principal`; there is no ownerless data-access path.
- **`assertOutputFolder` / `assertVideoId` stay** as shared local validation primitives (they are inherently local-FS/format guards). Only the four data-access functions (`readIndex`, `writeIndex`, `upsertVideo`, `updateVideoFields`) move behind the contract.
- **Import alias:** use `@/…` (mapped to repo root in `jest.config.ts` and `tsconfig`).

---

## File Structure

**Create:**
- `lib/storage/principal.ts` — `Principal` type + `localPrincipal()` helper. One responsibility: identify who/where data belongs to.
- `lib/storage/metadata-store.ts` — the `MetadataStore` interface. Pure contract, no impl.
- `lib/storage/local/local-metadata-store.ts` — `LocalFsMetadataStore` delegating to `lib/index-store`.
- `lib/storage/resolve.ts` — `getPrincipal(outputFolder)` (runs local guard) + `getMetadataStore()` (returns the singleton local store).
- `tests/lib/storage/principal.test.ts`
- `tests/lib/storage/local-metadata-store.test.ts`
- `tests/lib/storage/resolve.test.ts`

**Modify (reroute data-access calls to the store):**
- Lib: `lib/pipeline.ts`, `lib/archive.ts`, `lib/dig/dig-section.ts`, `lib/html-doc/generate.ts`, `lib/html-doc/ensure.ts`, `lib/html-doc/batch.ts`, `lib/html-doc/rerender.ts`, `lib/serial-migrate-exec.ts`, `lib/playlists/backfill-titles.ts`, `lib/timestamp-repair.ts`, `lib/timestamp-audit.ts`, `lib/summary-audit.ts`.
- API routes: `app/api/html/[id]/route.ts`, `app/api/videos/route.ts`, `app/api/videos/[id]/regenerate/route.ts`, `app/api/videos/[id]/pdf/route.ts`, `app/api/videos/[id]/dig-state/route.ts`, `app/api/videos/[id]/review/route.ts`, `app/api/videos/[id]/quick-view/route.ts`, `app/api/quick-view/backfill/route.ts`.

**Do NOT touch — import only `assertOutputFolder`/`assertVideoId`, which stay:** `app/api/settings/route.ts`, `app/api/ingest/route.ts`, `app/api/playlists/recent/route.ts`, `app/api/videos/batch-docs/route.ts`, `app/api/videos/[id]/archive/route.ts` (routes to `lib/archive`, rerouted in Task 5), `app/api/videos/[id]/html-doc/route.ts`, `app/api/videos/[id]/dig/[sectionId]/route.ts`, `lib/playlists/recent-provider.ts`, `lib/dig/slides.ts`.

**Out of scope for Part 1 — `scripts/`:** `scripts/backfill-serial-prefix.ts` **does** call `readIndex` directly (Codex correction — it is a data-access consumer, not guard-only). Scripts cannot use the `@/*` alias at runtime (they run via ts-node with relative imports), so rerouting them requires a relative-import strategy for `lib/storage/*`. Defer all of `scripts/` to a dedicated follow-up task; Part 1 covers only `app/` + `lib/` runtime consumers. The Task 8 completeness check whitelists `scripts/` accordingly.

---

### Task 1: `Principal` type + `localPrincipal()` helper

**Files:**
- Create: `lib/storage/principal.ts`
- Test: `tests/lib/storage/principal.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface Principal { readonly id: string; readonly outputFolder: string }`, `const LOCAL_PRINCIPAL_ID = 'local'`, `function localPrincipal(outputFolder: string): Principal`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/storage/principal.test.ts
import { localPrincipal, LOCAL_PRINCIPAL_ID } from '@/lib/storage/principal';

describe('localPrincipal', () => {
  it('wraps an outputFolder with the local sentinel id', () => {
    const p = localPrincipal('/home/u/data');
    expect(p.id).toBe(LOCAL_PRINCIPAL_ID);
    expect(p.outputFolder).toBe('/home/u/data');
  });

  it('LOCAL_PRINCIPAL_ID is the string "local"', () => {
    expect(LOCAL_PRINCIPAL_ID).toBe('local');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/storage/principal.test.ts`
Expected: FAIL — `Cannot find module '@/lib/storage/principal'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/storage/principal.ts

/** Identifies whose data a storage operation targets, and where it lives.
 *  Local: id is the fixed sentinel, outputFolder is the on-disk data root.
 *  Cloud (later): id is the owner user id; outputFolder is unused. */
export interface Principal {
  readonly id: string;
  readonly outputFolder: string;
}

export const LOCAL_PRINCIPAL_ID = 'local';

export function localPrincipal(outputFolder: string): Principal {
  return { id: LOCAL_PRINCIPAL_ID, outputFolder };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/storage/principal.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/storage/principal.ts tests/lib/storage/principal.test.ts
git commit -m "feat(storage): add Principal type + localPrincipal helper"
```

---

### Task 2: `MetadataStore` interface

**Files:**
- Create: `lib/storage/metadata-store.ts`

**Interfaces:**
- Consumes: `Principal` (Task 1); `PlaylistIndex`, `Video` from `@/types`.
- Produces: `interface MetadataStore` with methods `readIndex(p: Principal): PlaylistIndex`, `writeIndex(p: Principal, index: PlaylistIndex): void`, `upsertVideo(p: Principal, video: Video): void`, `updateVideoFields(p: Principal, id: string, fields: Partial<Video>): void`.

- [ ] **Step 1: Write the interface (no runtime test — TS-only contract; a compile check is the gate)**

```typescript
// lib/storage/metadata-store.ts
import type { Principal } from '@/lib/storage/principal';
import type { PlaylistIndex, Video } from '@/types';

/** Read/write access to a principal's playlist index + video records.
 *  Local impl delegates to lib/index-store; cloud impl (later) is Postgres. */
export interface MetadataStore {
  readIndex(principal: Principal): PlaylistIndex;
  writeIndex(principal: Principal, index: PlaylistIndex): void;
  upsertVideo(principal: Principal, video: Video): void;
  updateVideoFields(principal: Principal, id: string, fields: Partial<Video>): void;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). Confirm `PlaylistIndex` and `Video` are exported from `@/types` (they are — `types/index.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/storage/metadata-store.ts
git commit -m "feat(storage): define MetadataStore contract"
```

---

### Task 3: `LocalFsMetadataStore` (delegates to index-store)

**Files:**
- Create: `lib/storage/local/local-metadata-store.ts`
- Test: `tests/lib/storage/local-metadata-store.test.ts`

**Interfaces:**
- Consumes: `MetadataStore` (Task 2), `Principal` (Task 1), and `readIndex`/`writeIndex`/`upsertVideo`/`updateVideoFields` from `@/lib/index-store`.
- Produces: `class LocalFsMetadataStore implements MetadataStore`, `const localMetadataStore: LocalFsMetadataStore` (singleton).

- [ ] **Step 1: Write the failing characterization test** (proves the store round-trips identically to index-store, using a real temp dir under home — matching `tests/lib/index-store.test.ts`)

```typescript
// tests/lib/storage/local-metadata-store.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { localMetadataStore } from '@/lib/storage/local/local-metadata-store';
import { localPrincipal } from '@/lib/storage/principal';
import { readIndex } from '@/lib/index-store';
import type { PlaylistIndex, Video } from '@/types';

const TEST_DIR = path.join(os.homedir(), `.test-local-mds-${crypto.randomUUID()}`);
beforeAll(() => fs.mkdirSync(TEST_DIR, { recursive: true }));
afterAll(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

const p = localPrincipal(TEST_DIR);

function sampleVideo(id: string): Video {
  return {
    id, title: 'T', youtubeUrl: 'https://youtu.be/x', language: 'en',
    durationSeconds: 1, archived: false,
    ratings: { usefulness: 3, depth: 3, originality: 3, recency: 3, completeness: 3 },
    overallScore: 3, summaryMd: null, processedAt: '2026-07-02T00:00:00.000Z',
  } as Video;
}

it('writeIndex then readIndex round-trips through the store', () => {
  const index: PlaylistIndex = {
    playlistUrl: 'https://www.youtube.com/playlist?list=PL1',
    outputFolder: TEST_DIR, videos: [sampleVideo('vid00000001')],
  };
  localMetadataStore.writeIndex(p, index);
  expect(localMetadataStore.readIndex(p).videos).toHaveLength(1);
});

it('upsertVideo is observable via direct index-store readIndex (byte-identical persistence)', () => {
  localMetadataStore.upsertVideo(p, sampleVideo('vid00000002'));
  const viaDirect = readIndex(TEST_DIR); // same file the store wrote
  expect(viaDirect.videos.map((v) => v.id)).toContain('vid00000002');
});

it('updateVideoFields mutates the named video', () => {
  localMetadataStore.updateVideoFields(p, 'vid00000002', { title: 'Renamed' });
  const v = localMetadataStore.readIndex(p).videos.find((x) => x.id === 'vid00000002');
  expect(v?.title).toBe('Renamed');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/storage/local-metadata-store.test.ts`
Expected: FAIL — `Cannot find module '@/lib/storage/local/local-metadata-store'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/storage/local/local-metadata-store.ts
import type { MetadataStore } from '@/lib/storage/metadata-store';
import type { Principal } from '@/lib/storage/principal';
import type { PlaylistIndex, Video } from '@/types';
import * as indexStore from '@/lib/index-store';

/** Behavior-preserving local implementation: delegates to lib/index-store
 *  using principal.outputFolder. No behavior change vs. calling index-store directly. */
export class LocalFsMetadataStore implements MetadataStore {
  readIndex(principal: Principal): PlaylistIndex {
    return indexStore.readIndex(principal.outputFolder);
  }
  writeIndex(principal: Principal, index: PlaylistIndex): void {
    indexStore.writeIndex(principal.outputFolder, index);
  }
  upsertVideo(principal: Principal, video: Video): void {
    indexStore.upsertVideo(principal.outputFolder, video);
  }
  updateVideoFields(principal: Principal, id: string, fields: Partial<Video>): void {
    indexStore.updateVideoFields(principal.outputFolder, id, fields);
  }
}

export const localMetadataStore = new LocalFsMetadataStore();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/storage/local-metadata-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/storage/local/local-metadata-store.ts tests/lib/storage/local-metadata-store.test.ts
git commit -m "feat(storage): LocalFsMetadataStore delegating to index-store"
```

---

### Task 4: Resolver — `getPrincipal()` + `getMetadataStore()`

**Files:**
- Create: `lib/storage/resolve.ts`
- Test: `tests/lib/storage/resolve.test.ts`

**Interfaces:**
- Consumes: `assertOutputFolder` from `@/lib/index-store`; `localPrincipal`/`Principal` (Task 1); `localMetadataStore`/`MetadataStore` (Task 3).
- Produces: `function getPrincipal(outputFolder: string): Principal` (runs the local home-dir guard, then wraps), `function getMetadataStore(): MetadataStore` (returns the local singleton).

**Note:** centralizing the guard in `getPrincipal` preserves today's behavior — consumers currently call `assertOutputFolder(of)` then `readIndex(of)`; after rerouting they call `getPrincipal(of)` (which guards) then `store.readIndex(principal)`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/storage/resolve.test.ts
import * as os from 'os';
import * as path from 'path';
import { getPrincipal, getMetadataStore } from '@/lib/storage/resolve';
import { LocalFsMetadataStore } from '@/lib/storage/local/local-metadata-store';

it('getPrincipal accepts a folder under home and preserves the RAW outputFolder string', () => {
  const dir = path.join(os.homedir(), '.test-resolve-ok');
  const p = getPrincipal(dir);
  expect(p.id).toBe('local');
  // MUST be the raw string, NOT path.resolve(dir): index-store uses the raw
  // outputFolder for the file path; resolving here would change persisted
  // values and break mocked-arg assertions. (Codex Blocking)
  expect(p.outputFolder).toBe(dir);
});

it('getPrincipal rejects a folder outside home (guard preserved)', () => {
  expect(() => getPrincipal('/etc')).toThrow();
});

it('getMetadataStore returns the local store implementation', () => {
  expect(getMetadataStore()).toBeInstanceOf(LocalFsMetadataStore);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lib/storage/resolve.test.ts`
Expected: FAIL — `Cannot find module '@/lib/storage/resolve'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/storage/resolve.ts
import type { MetadataStore } from '@/lib/storage/metadata-store';
import { localPrincipal, type Principal } from '@/lib/storage/principal';
import { localMetadataStore } from '@/lib/storage/local/local-metadata-store';
import { assertOutputFolder } from '@/lib/index-store';

/** Resolve a request's outputFolder into a Principal, running the local
 *  home-dir containment guard (behavior identical to today's assertOutputFolder).
 *  CRITICAL (Codex Blocking): preserve the RAW outputFolder string — do NOT
 *  path.resolve it. index-store uses the raw string for the index file path;
 *  assertOutputFolder resolves only internally for its guard check. Resolving
 *  here would change the persisted index.outputFolder value and the arguments
 *  observed by existing mocked-function assertions. */
export function getPrincipal(outputFolder: string): Principal {
  assertOutputFolder(outputFolder); // guards; resolves internally, returns void
  return localPrincipal(outputFolder); // raw string preserved
}

/** The active MetadataStore. Local-only for now; env-selected once the
 *  Supabase implementation lands (Stage 1C). */
export function getMetadataStore(): MetadataStore {
  return localMetadataStore;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/lib/storage/resolve.test.ts`
Expected: PASS (3 tests). (`assertOutputFolder` resolves the path and checks it is under `os.homedir()`; `/etc` throws.)

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/storage/resolve.ts tests/lib/storage/resolve.test.ts
git commit -m "feat(storage): getPrincipal + getMetadataStore resolver"
```

---

### Task 5: Reroute core lib consumers (`pipeline`, `archive`, `dig-section`)

**Files:**
- Modify: `lib/pipeline.ts`, `lib/archive.ts`, `lib/dig/dig-section.ts`
- Test: existing suites (`tests/lib/pipeline*.test.ts`, `tests/lib/archive.test.ts`, `tests/lib/dig/*`) — must stay green.

**Interfaces:**
- Consumes: `getPrincipal`, `getMetadataStore` (Task 4).
- Produces: nothing new (internal rerouting only).

**Canonical transformation** (apply to each `readIndex`/`writeIndex`/`upsertVideo`/`updateVideoFields` call; leave `assertOutputFolder`/`assertVideoId` imports and calls untouched):

```typescript
// BEFORE
import { assertOutputFolder, assertVideoId, upsertVideo, readIndex, writeIndex } from '@/lib/index-store';
// ...
assertOutputFolder(outputFolder);
const index = readIndex(outputFolder);
upsertVideo(outputFolder, video);
writeIndex(outputFolder, index);

// AFTER
import { assertOutputFolder, assertVideoId } from '@/lib/index-store';
import { getPrincipal, getMetadataStore } from '@/lib/storage/resolve';
// ...
const principal = getPrincipal(outputFolder); // replaces the assertOutputFolder guard call
const store = getMetadataStore();
const index = store.readIndex(principal);
store.upsertVideo(principal, video);
store.writeIndex(principal, index);
```

**Single rule (Codex): use `getPrincipal(outputFolder)` at the point where a raw `outputFolder` first enters a rerouted function; resolve the principal *once* and pass the `Principal` down to any internal helpers** (do not re-resolve per helper). Rationale: `getPrincipal` preserves the raw string (so persistence + mocked-arg assertions are byte-identical) and applies the home-dir guard. Where the old code already called `assertOutputFolder(outputFolder)`, this replaces that call. Where the old code did *not* guard (a few read-only paths), `getPrincipal` adds an idempotent home-dir guard that never triggers in practice (the app only ever operates on home-scoped folders) and is forward-consistent with the cloud store — do **not** use bare `localPrincipal` in consumers, to avoid the false "no redundant guard" reasoning flagged in review. (`localPrincipal` is used only inside `LocalFsMetadataStore`/tests.)

- [ ] **Step 1: Reroute `lib/pipeline.ts`**

Replace its `upsertVideo`/`readIndex`/`writeIndex` calls per the canonical transform. `pipeline.ts` receives `outputFolder` and already calls `assertOutputFolder` — replace that call with `const principal = getPrincipal(outputFolder)` and thread `principal` + `getMetadataStore()` through the ingestion loop. Keep `assertVideoId` calls as-is.

- [ ] **Step 2: Reroute `lib/archive.ts`**

`archiveVideo`/`unarchiveVideo` receive `outputFolder`. Replace their `readIndex`/`updateVideoFields` (via `updateIndexIfKnown`) calls with the store. `updateIndexIfKnown` becomes: `getMetadataStore().updateVideoFields(getPrincipal(outputFolder), videoId, fields)` — but resolve the principal once at the top of each exported function and pass it down to the helpers to avoid repeated guard calls. Keep all path-containment logic and `assertOutputFolder`/`assertVideoId` intact.

- [ ] **Step 3: Reroute `lib/dig/dig-section.ts`**

Replace its `readIndex`/`updateVideoFields` calls with the store (`getPrincipal(outputFolder)` at entry, then `store.readIndex(principal)` / `store.updateVideoFields(principal, id, fields)`).

- [ ] **Step 4: Run the affected suites**

Run: `npx jest tests/lib/pipeline tests/lib/archive tests/lib/dig`
Expected: PASS — same counts as before the change (behavior unchanged).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/pipeline.ts lib/archive.ts lib/dig/dig-section.ts
git commit -m "refactor(storage): route pipeline/archive/dig-section through MetadataStore"
```

---

### Task 6: Reroute remaining lib consumers (`html-doc/*`, `serial-migrate`, `backfill-titles`, audits)

**Files:**
- Modify: `lib/html-doc/generate.ts`, `lib/html-doc/ensure.ts`, `lib/html-doc/batch.ts`, `lib/html-doc/rerender.ts`, `lib/serial-migrate-exec.ts`, `lib/playlists/backfill-titles.ts`, `lib/timestamp-repair.ts`, `lib/timestamp-audit.ts`, `lib/summary-audit.ts`
- Test: existing suites for each — must stay green.

**Interfaces:**
- Consumes: `getPrincipal`/`getMetadataStore` (Task 4); `localPrincipal` where a folder is already validated.
- Produces: nothing new.

Apply the **canonical transformation from Task 5** to each file's `readIndex`/`writeIndex`/`updateVideoFields` calls. Per-file specifics (imported symbols to reroute, from the consumer map):

- [ ] **Step 1: html-doc modules** — `generate.ts` (`readIndex`, `updateVideoFields`), `ensure.ts` (`readIndex`, `updateVideoFields`), `batch.ts` (`readIndex`), `rerender.ts` (`readIndex`). Each already calls `assertOutputFolder`/`assertVideoId`; replace the guard call with `getPrincipal` and thread the principal + store.

- [ ] **Step 2: migration/backfill** — `serial-migrate-exec.ts` (`readIndex`, `writeIndex`, `updateVideoFields`): `getPrincipal(outputFolder)` at entry, thread the principal. **`backfill-titles.ts` is per-child-folder, NOT per-root (Codex High):** it receives `root` and iterates discovered playlist folders, doing `readIndex(folder)`/`writeIndex(folder, …)` per child. Keep the entry guard on `root` if present, but build a **separate principal per discovered `folder`** immediately before each access: `const p = getPrincipal(folder); const idx = store.readIndex(p); …; store.writeIndex(p, idx);` inside the iteration. Do **not** hoist one `root` principal across children.

- [ ] **Step 3: read-only audits** — `timestamp-repair.ts`, `timestamp-audit.ts`, `summary-audit.ts` (each `readIndex` only). Per the single rule, use `getPrincipal(folder)` + `getMetadataStore().readIndex(principal)` (the added home-dir guard is idempotent and never triggers in practice, and is forward-consistent — see the Single-rule note in Task 5; do **not** use bare `localPrincipal`).

- [ ] **Step 4: Run the affected suites**

Run: `npx jest tests/lib/html-doc tests/lib/serial tests/lib/timestamp tests/lib/summary-audit tests/lib/playlists`
Expected: PASS — unchanged counts.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add lib/html-doc/generate.ts lib/html-doc/ensure.ts lib/html-doc/batch.ts lib/html-doc/rerender.ts lib/serial-migrate-exec.ts lib/playlists/backfill-titles.ts lib/timestamp-repair.ts lib/timestamp-audit.ts lib/summary-audit.ts
git commit -m "refactor(storage): route remaining lib consumers through MetadataStore"
```

---

### Task 7: Reroute API-route consumers

**Files:**
- Modify: `app/api/html/[id]/route.ts`, `app/api/videos/route.ts`, `app/api/videos/[id]/regenerate/route.ts`, `app/api/videos/[id]/pdf/route.ts`, `app/api/videos/[id]/dig-state/route.ts`, `app/api/videos/[id]/review/route.ts`, `app/api/videos/[id]/quick-view/route.ts`, `app/api/quick-view/backfill/route.ts`
- Test: existing route suites under `tests/api/` — must stay green.

**Interfaces:**
- Consumes: `getPrincipal`/`getMetadataStore` (Task 4).
- Produces: nothing new.

Apply the **canonical transformation** to each route's `readIndex`/`updateVideoFields` calls. Each route currently does `assertOutputFolder(outputFolder)` (+ `assertVideoId(id)`) then `readIndex(outputFolder)`; convert the `assertOutputFolder` call into `const principal = getPrincipal(outputFolder)`, keep `assertVideoId(id)`, and use `getMetadataStore()` for data access.

- [ ] **Step 0: Characterization test on ONE route mock before rerouting all (Codex).** Pick `tests/api/review.test.ts` (asserts `updateVideoFields` call args). Run it *before* touching `review/route.ts` to capture the green baseline: `npx jest tests/api/review.test.ts` → PASS. After rerouting review/route (Step 2), run it again and confirm the **same** assertions pass unchanged — proving the mock still intercepts through the delegating store and the args are byte-identical (they are, because `Principal.outputFolder` is the raw string). If it fails on the mocked-arg assertion, the Blocking fix regressed — stop and re-verify `getPrincipal` does not resolve. Only after this passes, proceed to reroute the remaining routes.

- [ ] **Step 1: Reroute the read-only routes** — `html/[id]`, `videos/route`, `videos/[id]/pdf`, `videos/[id]/dig-state`, `videos/[id]/quick-view` (each `readIndex` only, plus their existing `assertVideoId`).

- [ ] **Step 2: Reroute the read+write routes** — `videos/[id]/regenerate` (`readIndex` + `updateVideoFields`), `videos/[id]/review` (`updateVideoFields`), `quick-view/backfill` (`readIndex` + `updateVideoFields`).

- [ ] **Step 3: Run the API suites**

Run: `npx jest tests/api`
Expected: PASS — unchanged counts. (Tests that `jest.mock('../../lib/index-store')` still work because the local store delegates to those same mocked functions; if any test mocked `readIndex` directly and asserts the route called it, it still passes since the store forwards to it. If a test breaks because it mocked at the wrong layer, update the mock to target `@/lib/storage/resolve`'s `getMetadataStore` — see note below.)

**Mock-layer note:** existing route tests mock `@/lib/index-store`. Because `LocalFsMetadataStore` calls those exact functions, the mocks still intercept. Do **not** rewrite mocks unless a test fails; if one does, prefer mocking `getMetadataStore` to return a stub `MetadataStore` — this is the more future-proof seam.

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add app/api/html app/api/videos app/api/quick-view
git commit -m "refactor(storage): route API handlers through MetadataStore"
```

---

### Task 8: Full-suite verification + seam-completeness check

**Files:** none (verification only).

- [ ] **Step 1: Confirm no remaining direct data-access calls outside the seam**

The old narrow grep (only `from '@/lib/index-store'` lines) missed **relative** imports (`lib/pipeline.ts`, `lib/archive.ts`, …) and the **namespace** import in the delegating impl (Codex High). Search by *symbol usage* across `app lib` (scripts are out of scope for Part 1):

Run: `rg -n "\b(readIndex|writeIndex|upsertVideo|updateVideoFields)\b" app lib`
Expected: matches **only** in `lib/storage/local/local-metadata-store.ts` (the delegating impl — the sole place calling the raw functions) and `lib/index-store.ts` itself (definitions). **Any** hit in another `app/` or `lib/` file is an un-rerouted consumer — reroute it before proceeding. (`scripts/` is intentionally excluded — deferred; `assertOutputFolder`/`assertVideoId` usages are expected and not matched by this pattern.)

- [ ] **Step 2: Full type gate**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors).

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — total count ≥ the pre-refactor baseline (the 9 new storage tests are additive; all prior tests unchanged).

- [ ] **Step 4: Final commit (if grep in Step 1 surfaced a stray reroute, fix it first, then)**

```bash
git add -A
git commit -m "test(storage): verify MetadataStore seam is behavior-preserving (full suite green)"
```

---

## Self-Review

**Spec coverage (spec §4.1 MetadataStore + Principal):**
- "Distinct capability contracts" → `MetadataStore` defined (Task 2); other four contracts are explicitly separate sibling plans (noted in the plan intro), matching the spec's "five narrow contracts."
- "Principal from day one" → every `MetadataStore` method takes `Principal` (Task 2); no ownerless path (Tasks 3–7 thread it). ✓
- "Transactional metadata, not file-mimicking" → **out of scope for Part 1** by design: this part only extracts the seam with behavior *unchanged*. The transactional/optimistic-version requirement applies to the *SupabaseMetadataStore* (Stage 1C), which implements the same interface. Noted here so it isn't lost. ✓ (documented deferral, not a gap)
- "LocalFsAdapter keeps the personal tool green" → `LocalFsMetadataStore` delegates to unchanged `index-store`; full suite green gate (Task 8). ✓
- "Local-only ops explicit" → `assertOutputFolder` (home-dir guard) stays local, centralized in `getPrincipal`. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code; reroute tasks give the canonical transform verbatim + per-file symbol lists. ✓

**Type consistency:** `Principal { id, outputFolder }`, `MetadataStore.readIndex/writeIndex/upsertVideo/updateVideoFields`, `getPrincipal`/`getMetadataStore`, `localPrincipal`, `localMetadataStore` used identically across Tasks 1–7. `PlaylistIndex`/`Video` sourced from `@/types` (verified exported). ✓

**Deferred to sibling Stage 1A plans (not gaps):** BlobStore (MD/slides/html/pdf blobs), ExportTarget (`obsidian://`/zip/FSA), SettingsStore (`settings.json`), TempWorkspace (`.cache`). Each gets its own spec-aligned plan. `scripts/` reroute is a deferred follow-up task (relative-import strategy needed).

## Codex Plan Review — addressed (v2)

Review: `docs/reviews/stage-1a-metadata-store-seam-plan-codex.md` (1 Blocking, 2 High, 3 Medium, 1 verified-OK).
- **Blocking** (Principal must preserve raw `outputFolder`, no `path.resolve`) — fixed in Task 1/4 impl + test + `getPrincipal` comment.
- **High** (`backfill-titles` per-child-folder principal) — fixed in Task 6 Step 2.
- **High** (completeness grep missed relative/namespace imports) — replaced with `rg` symbol check in Task 8 Step 1.
- **Medium** (`scripts/backfill-serial-prefix.ts` mis-listed; scripts scoped out) — fixed in file lists + Task 8 whitelist.
- **Medium** (audit "no redundant guard" reasoning) — single-rule `getPrincipal` everywhere (Task 5 note, Task 6 Step 3).
- **Medium** (route mocked-arg assertions) — resolved by the Blocking fix; added a pre-reroute characterization test (Task 7 Step 0).
- **Verified-OK** (namespace-import mock interception) — confirmed; characterization test added as belt-and-suspenders.
