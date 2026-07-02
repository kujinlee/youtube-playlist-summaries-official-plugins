# Cloud Publishing Architecture — Design Spec

**Date:** 2026-07-01
**Status:** Draft — awaiting user review
**Scope:** Turn the single-user, local-first YouTube-playlist-summary tool into a hosted web service that unregistered guests can try and registered users can use durably. Staged: **public demo first, built on the SaaS spine so Stage 1 is not throwaway.**

Related memory: `cloud-multitenant-goal`, `data-corpus-state`, `project-context`.

---

## 1. Goal

Let a stranger open a URL and try the tool, and let a returning user keep a durable, private library of their summaries across devices — without a rewrite between those two milestones.

- **Stage 1 — Public demo.** Anonymous "taste" + free sign-in tier with a small metered allowance of the expensive operations. Ships the storage/auth/cost spine and shakes out cloud packaging.
- **Stage 2 — Multi-tenant SaaS.** Durable per-user libraries, usage tiers/paid plans, dig-deeper fully enabled behind an account, `mine=true` "my playlists" (roadmap path C).

The two stages share one architecture; Stage 1 is a constrained configuration of it, not a different system.

**Non-goal:** breaking the existing local personal tool. The author's local corpus and filesystem workflow must keep working (see §4, StorageAdapter seam). Cloud is an *added* deployment mode, not a replacement.

---

## 2. Why this is a re-architecture, not a deploy

The current app is unusually local-first. Three properties block naïve hosting (confirmed by codebase scan, 2026-07-01):

1. **Filesystem-native, no database.** Every summary, HTML, PDF, slide image, and `playlist-index.json` is a file under a local `-data` folder. The only access control is a check that the path is under `os.homedir()` (`lib/index-store.ts:31-51`) — meaningless on a shared host.
2. **Heavy local binaries.** `yt-dlp` + `ffmpeg`/`ffprobe` (slide capture, `lib/dig/slides.ts`), headless Chromium (`lib/pdf/`), macOS `osascript` folder picker (`app/api/pick-folder/route.ts`). These need a real container with disk — not serverless.
3. **No concept of a user.** Zero auth/session/ownership anywhere. Endpoints trust a bare `outputFolder`. Jobs live in an in-process `Map` (`lib/job-registry.ts`) that dies on restart.

The heaviest, most cloud-hostile feature — **dig-deeper slide capture** — is the *only* thing needing `yt-dlp`/`ffmpeg`. Summaries run off captions + Gemini alone. This separability shapes the staged plan and the worker design.

---

## 3. Target architecture

One platform for web + worker (chosen over "Vercel frontend + external worker" because both options require the same long-running worker box; a single platform is materially less to operate for a solo developer). Supabase is the entire data/auth/storage/isolation spine.

```
                         Supabase
              [ Postgres + Auth(Google) + Storage + RLS ]
                     ^            ^            ^
        data / RLS   |     auth   |            |  artifacts (md / slides / html$ / pdf$)
                     |            |            |
 Browser  <——>  [ Next.js web + API ]  ——enqueue——>  [ Worker (same image / repo) ]
   |   FSA API / zip / obsidian://                       |  yt-dlp · ffmpeg · Gemini · Playwright
   |   (local export of MD, opt. HTML)                   |  honors per-user quota + daily spend cap
   +———— "connect vault" writes .md locally              +— writes canonical MD/slides + caches html$/pdf$

   $ = derived cache (regenerable from MD), not source of truth
```

**Components**

| Component | Responsibility | Notes |
|---|---|---|
| **Next.js web + API** | UI, auth session, light API (list/browse, enqueue jobs, serve/print/share docs) | Same repo as worker; deploy as web process |
| **Worker** | Long jobs: ingestion, summary (Gemini), dig-deeper (yt-dlp/ffmpeg/Gemini), PDF (Chromium) | Same image, runs a job loop instead of `next start`. Honors quota + spend cap. |
| **Job queue** | Durable job state + hand-off web→worker | Replaces in-memory `job-registry`. Options: Postgres-backed queue (pg-boss) or Redis/BullMQ. Postgres-backed preferred (one fewer service). |
| **Supabase Postgres** | Users, playlist/video index, job records, usage counters, share tokens | Source of truth for metadata. RLS-enforced isolation. |
| **Supabase Auth** | Google OAuth sign-in | Also unlocks `mine=true` playlist path C in Stage 2. |
| **Supabase Storage** | Canonical MD + slide images; cached HTML/PDF | Private buckets; served via signed URLs or proxying routes. |
| **Supabase RLS** | Per-user data isolation at the DB layer (`owner_id` policy) | Declarative tenant isolation — see §7. |

**Host for web+worker:** a long-running container platform with persistent disk. **Decided: Fly.io** (§11 #2); Cloud Run is the drop-in alternative if consolidating on GCP later. Host choice does not affect the architecture.

**AWS Lambda:** not used. The pipeline (yt-dlp/ffmpeg/long Gemini) is the opposite of Lambda's sweet spot (15-min cap, painful ffmpeg/Chromium layers, wasteful per-ms billing on long jobs). The one defensible Lambda candidate is isolated PDF export (`@sparticuz/chromium`), but with a worker box already present there is no reason to add a third deploy target. Revisit only if PDF/frame-extraction must burst in parallel beyond one worker (Stage 3+).

---

## 4. Storage model — three tiers

**Terminology (avoids a common mixup):** "Supabase" bundles *separate* services. **Supabase Postgres** is the **relational** DB (rows) — it holds structured metadata: users, index, job records, usage counters, share tokens, and *the object-storage path + version of each file*. **Supabase Storage** is an **object store** for **blobs** (S3-compatible — the same category of system as AWS S3 / Cloudflare R2). **All files — MD, slide images, HTML, PDF — live in object storage; no blob is ever stored in the relational DB.** Postgres only stores the *path/key* string into the object store (e.g. `u_abc/77/summary.md`) plus the version used for cache invalidation. "Source of truth" vs "derived cache" below is a distinction *within the same object store*: both are blobs in Supabase Storage; the only difference is source blobs must be preserved while cache blobs can be evicted and rebuilt from the MD.

**Decision (2026-07-01):** use **Supabase Storage as the single object store for all blobs** (source-of-truth *and* cache) — not raw AWS S3 / Cloudflare R2. One vendor, one credential set, access controls integrated with Supabase Auth/RLS. Portability preserved via the `StorageAdapter` seam (§4.1) and Supabase Storage's S3-compatible API, so a later move to R2/S3 is a bucket copy + adapter swap, not a re-architecture.

The central design principle. Categorize every output by **can the server cheaply regenerate it?** — not by file type.

| Tier | Artifacts | Regenerable? | Home |
|---|---|---|---|
| **Source of truth** | summary **MD**, model JSON, **slide images**, playlist/video **index + metadata** | No — MD/slides cost Gemini + yt-dlp to produce | **Server** (Supabase Storage for blobs, Postgres for index) + optional local mirror |
| **Derived cache** | **HTML doc**, **PDF** | Yes — deterministic render from MD (+ model/assets); PDF = Chromium pass | **Cache** in Supabase Storage, keyed by doc version. Safe to evict; rebuild from MD. Cached because regeneration (esp. PDF) costs time/compute. |
| **Local export** | MD → Obsidian vault; optionally HTML/PDF → download | — | User's disk, one-way. In *addition* to the server copy, never instead of it. |

**Why HTML/PDF are a cache, not a source of truth:** they are deterministic renders of the MD (`rerender-html` runs offline, no Gemini; Gemini is only invoked to regenerate the *MD*). Storing them is a valid, encouraged optimization — they just carry a version key and can be rebuilt if lost. The only artifacts that *must* persist are the MD, the slide images (un-regenerable without re-downloading video), and the index.

### 4.1 StorageAdapter seam (preserves the local tool)

Introduce a `StorageAdapter` interface (mirrors the existing pluggable playlist-source seam). Two implementations:

- **`LocalFsAdapter`** — today's behavior: reads/writes the local `-data` folder, `obsidian://`, `os.homedir()` guard. Keeps the author's personal single-user workflow intact.
- **`SupabaseAdapter`** — Postgres index + Supabase Storage blobs + signed URLs; no `os.homedir()` assumption; `owner_id` on every record.

Selected by config/env. All `lib/index-store`, `lib/archive`, `lib/settings-store`, `lib/pdf`, `lib/dig` filesystem calls route through the adapter. This is the single largest refactor and the spine both stages depend on.

---

## 5. Print & share (docs served from object storage)

**Principle: the user never talks to storage; the app does.** Buckets are private; the browser hits the app, and the app fetches from storage (signed URL or a route that streams the object *after* an RLS/token check). This preserves tenant isolation — no raw bucket URLs.

- **Print** — a browser action on a rendered page, unchanged by where bytes live: `Open doc` → app route serves the cached HTML → existing **Print** button (`window.print()`, PR #14) → browser dialog → paper or "Save as PDF." `@media print` CSS applies as today.
- **Share** — app-mediated:

| "Share" means | Mechanism |
|---|---|
| Send a viewable link | App issues `/share/<token>` (revocable, view-only, optionally time-limited); server checks token, streams doc from storage. No raw bucket URLs. |
| Download the file | "Download PDF/HTML" → Supabase `createSignedUrl(path, ~60s)` or a route streaming with `Content-Disposition: attachment`. |
| Native/mobile share | Web Share API (`navigator.share`) shares the app link or file via OS share sheet. |

**PDF flow:** worker generates PDF once (Chromium) → uploads to Storage → "Download PDF" hands out a signed URL to the cached object → regenerated only on doc-version change.

---

## 6. Obsidian feature in the cloud

The `obsidian://` handler is client-side (runs in the user's local Obsidian), so it survives a hosted page. Three tiers, best → universal:

1. **File System Access API** (`showDirectoryPicker()`, Chromium desktop): user grants the web app write access to their vault folder once; the app writes `.md` files straight in. Closest equivalent to today's behavior ("connect your vault"). HTTPS + user gesture; not in Firefox/Safari.
2. **Download vault `.zip`** (universal fallback): user unzips into their vault.
3. **`obsidian://new?vault=…&content=…`** deep link: works for small notes (content rides in the URI; length-limited).

Ship (2) for everyone; offer (1) as a Chromium nicety. Note: even in local-export mode, the MD's *canonical* copy stays on the server (so library + regeneration work); the vault copy is the export.

**Rejected:** full local-first (canonical MD only on the user's disk, server as pure compute). Coherent and privacy-friendly, but breaks the guest/mobile try-it path (FSA API is Chromium-desktop-only), the Stage 2 cross-device library, and would move the regeneration/versioning machinery to the client — a large rewrite. Kept as a possible future "local-first mode" toggle, not the default.

---

## 7. Auth & tenant isolation

- **Supabase Auth with Google OAuth.** One identity provider; also the natural path to `mine=true` (roadmap C) in Stage 2.
- **RLS-based isolation.** Every tenant-owned row carries `owner_id`; a Postgres RLS policy makes a row visible only to its owner. Isolation is declared once at the DB layer instead of re-checked on every route — critical for an app that has *zero* isolation today (one missed manual check = a data leak).
- **Storage isolation.** Object paths namespaced by user id; access only via signed URLs / routes that first evaluate ownership.
- Anonymous guests get a server-issued anonymous session (Supabase anonymous auth or a signed session cookie) so their limited usage is still attributable and RLS-scoped.

---

## 8. Cost & abuse model

An unauthenticated page calling a **paid** Gemini API on the app's key is a money drain and abuse target. Guardrails are non-negotiable.

**Tiers (Stage 1)**

| Tier | Identity | Allowance | Notes |
|---|---|---|---|
| Anonymous guest | cookie + IP (+ optional anon session) | tiny taste: 1–2 **summaries**, **no** dig-deeper/PDF | Cheap, bounded, "see it work." |
| Free registered | Google sign-in | ~5 **dig-deeper** + ~5 **PDF** + N summaries, durable library | The real trial. Sign-in makes metering abuse-resistant (cookie-wipe can't reset a counter). |

*(Identity model decided — §11 #1: "anon taste + free Google sign-in for the 5.")*

**Enforcement**

- **Per-user counters** in Postgres, decremented per job; block when exhausted.
- **Global daily spend kill-switch** (the real backstop): when the day's spend hits `$DAILY_CAP`, ingest/dig endpoints return "demo at capacity, back tomorrow," regardless of per-user math.
- **Max free-users ceiling** (waitlist beyond N) to bound total exposure while validating.
- **Short-video allowlist** + max concurrent jobs (worker capacity / queue-depth limit).

**Cost sizing (from project data):** dig-deeper ≈ $0.046/section → a full dig doc ≈ $0.15–0.30 Gemini; 5 digs ≈ < ~$1.50/free user. PDF ≈ $0 in API terms (Chromium compute). Bounding free users + the daily cap keeps worst-case exposure predictable. Gemini 2.5 Flash list price (2026): $0.30 in / $2.50 out per 1M tokens.

### 8.1 Accounts & billing for the POC

**Claude Pro powers *development*, not the app's runtime.** A Claude Pro/Max subscription is for interactive use of Claude Code / claude.ai (i.e. building this) and **cannot be used programmatically** — subscriptions are not API access. The app itself **never calls Claude**; its AI is **Google Gemini** (`lib/gemini.ts`) plus the **YouTube Data API**. So the subscription and the app's runtime costs never intersect.

| Piece | Account / key | POC cost |
|---|---|---|
| Dev assistance (building it) | **Claude Pro** (already held) | already paid |
| App AI — summaries / dig-deeper | **Google Gemini API key** (pay-as-you-go billing enabled) | the only real cost; bounded by `$DAILY_CAP`. $0.30 in / $2.50 out per 1M tokens |
| Playlist / video metadata | **YouTube Data API key** | free (10k units/day quota) |
| Postgres + Auth + Storage | **Supabase** | free tier (≈500 MB DB / 1 GB storage) covers a POC |
| Web + worker hosting | **Fly.io** (see §11 #2) | free-ish / a few dollars |

**Gemini billing note:** for a *public* demo, enable **pay-as-you-go** on the Gemini key rather than relying on the free tier — the free tier is rate-limited (and may use data for training), which would throttle strangers mid-demo. The §8 daily kill-switch keeps the pay-as-you-go bill trivial. All keys live in the host's secret store, not `.env.local` (§9).

---

## 9. Server & runtime changes

Beyond storage/auth:

- **Durable job queue** replaces in-memory `job-registry`; job records in Postgres survive restarts.
- **Worker process** runs the pipeline; web enqueues and streams progress (SSE via a shared event source, or poll job status from Postgres — sticky sessions not required if polling).
- **Graceful shutdown** (SIGTERM) so rolling deploys don't kill mid-flight jobs; requeue on restart.
- **Health/readiness endpoints** for the platform LB.
- **Fail-fast env validation** at startup (`GEMINI_API_KEY`, `YOUTUBE_API_KEY`, Supabase keys, `DAILY_CAP`).
- **Config not from `process.cwd()`** — settings move to Postgres/env, not `settings.json` on disk (in the Supabase adapter).
- **Secrets** in the platform's secret store, not `.env.local`.

---

## 10. Staging & decomposition

Too large for one implementation plan. Decompose; each sub-project gets its own spec → plan → implementation cycle. This document is the north-star architecture; the first buildable slice is Stage 1A.

**Stage 1 — public demo**
- **1A. StorageAdapter seam + SupabaseAdapter** (the spine; §4.1). LocalFsAdapter preserves the personal tool. *Largest, do first.*
- **1B. Auth + RLS + anonymous session** (§7).
- **1C. Cost guardrails**: counters, daily kill-switch, allowlist, ceilings (§8).
- **1D. Worker + durable queue + graceful shutdown** (§9). Summary path plus the metered dig-deeper path (yt-dlp/ffmpeg in the worker image), per §11 #5.
- **1E. Serve/print/share from storage** (§5); "download MD/HTML/zip" + optional FSA "connect vault" (§6).
- **1F. Deploy**: container host, secrets, health checks, spend monitoring.

**Stage 2 — SaaS**
- Durable per-user libraries + the browse/sort UI over Postgres.
- Usage tiers / paid plans / metering dashboard.
- Dig-deeper fully enabled behind an account (re-adds yt-dlp/ffmpeg to the worker image).
- `mine=true` "my playlists" (roadmap C) via the Google identity.

**Each stage gate** follows `docs/dev-process.md` (Codex/Claude adversarial review + user approval).

---

## 11. Decisions (resolved 2026-07-01)

1. **Guest identity for the metered tier** — **anon taste + free Google sign-in for the ~5.** Anonymous visitors get summary-only (1–2); the dig/PDF allowance requires sign-in so the counter can't be reset by clearing cookies, and the auth spine is built early.
2. **Worker/web host** — **Fly.io** (long-running containers + persistent disk, simplest single-app model for the yt-dlp/ffmpeg/Chromium worker). *Cloud Run is the drop-in alternative if consolidating on GCP is preferred later — host choice does not affect the architecture.*
3. **Queue backend** — **Postgres-backed (pg-boss)**, reusing the Supabase Postgres — one fewer service than Redis/BullMQ.
4. **Spend guardrails (starting values, env-tunable)** — **`$DAILY_CAP` = $5/day**, **free-user ceiling `N` = 100**. Conservative for validation; raise via env once demand is proven.
5. **Dig-deeper in Stage 1** — **yes, metered (5) for free-registered users only.** Cost ≤ ~$1.50/user, backstopped by the daily cap. Adds yt-dlp/ffmpeg to the Stage-1 worker image.

**Object store (from §4)** — **Supabase Storage for all blobs** (source-of-truth + cache); portability preserved via the `StorageAdapter` seam and S3-compatible API.

---

## 12. Success criteria

- A stranger opens the URL, runs a summary on an allowlisted video, and reads/prints/downloads the result — without touching any local file or the author's data.
- A signed-in free user runs ~5 dig-deepers, sees them persist in a private library on a second device, and shares a view-only link.
- The author's existing local workflow (LocalFsAdapter) is unaffected.
- No single actor can drive spend past `$DAILY_CAP`; tenant data is RLS-isolated (verified: user A cannot read user B's rows or objects).
