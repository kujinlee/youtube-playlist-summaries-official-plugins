# Plugin Governance

Canonical source for plugin requirements, skill conflict resolution, fallbacks, and cleanup.
Lives in the project repo so the full workflow is reproducible by anyone who clones it.

> **Quick reference:** [`docs/available-skills.md`](available-skills.md) lists every skill, agent,
> and command currently installed — with invoke strings, trigger type, and descriptions.
> Regenerate it after any plugin change: `python3 scripts/regen-skills-doc.py`
> — or just say **"sync docs"** / run `/sync-docs` to let the `sync-docs` skill handle it.

---

## Required Plugins

Install these before starting work on this project.

| Plugin | Install command | Purpose |
|---|---|---|
| `superpowers` | `/plugin install superpowers@claude-plugins-official` | Core workflow skills (brainstorming, TDD, debugging, code review, plans) |
| `mattpocock/skills` | `npx skills@latest add mattpocock/skills` | TDD (discovery mode), diagnose, grill-with-docs, handoff |
| `codex` | Install Codex CLI + `/plugin install codex@openai-codex` | Adversarial review gate at every phase |
| `remember` | `/plugin install remember@claude-plugins-official` | Session continuity across compaction and context resets |

### Optional (used in later phases)

| Plugin | Install command | Purpose |
|---|---|---|
| `playwright` | `/plugin install playwright@claude-plugins-official` | E2E tests (Sub-project 2, Task 7) |
| `pr-review-toolkit` | `/plugin install pr-review-toolkit@claude-plugins-official` | Pre-PR review gate |
| `hookify` | `/plugin install hookify@claude-plugins-official` | Hook configuration management |

---

## Skill Conflict Resolution

When multiple installed skills can handle the same task, use this table.

### TDD

| When | Use | Requires |
|---|---|---|
| Behaviors fully specified upfront (lib functions, components with clear acceptance criteria) | `superpowers:test-driven-development` | superpowers |
| Behavior discovered during implementation (pipelines, API routes, page wiring) | `mattpocock:tdd` | mattpocock/skills |

**Fallback** (mattpocock not installed): use `superpowers:test-driven-development` for all TDD.

### Debugging

| When | Use | Requires |
|---|---|---|
| Clear feedback loop exists: test failure, stack trace, consistent repro, build error | `superpowers:systematic-debugging` | superpowers |
| Building a feedback loop is the hard problem: flaky, prod-only, perf regression, no local repro | `mattpocock:diagnose` | mattpocock/skills |

**Fallback** (mattpocock not installed): use `superpowers:systematic-debugging` for all debugging; add manual repro steps before analysis.

### Writing Skills

| When | Use | Requires |
|---|---|---|
| Creating or editing any Claude Code skill for this project or ecosystem | `superpowers:writing-skills` | superpowers |
| Contributing a skill back to mattpocock's own repo | `mattpocock:write-a-skill` | mattpocock/skills |

**Fallback** (superpowers not installed): use `mattpocock:write-a-skill` as a structural guide only; adapt output to local plugin infrastructure.

### Session Handoff

| When | Use | Requires |
|---|---|---|
| End of session — continuity for next session | `remember:remember` → writes `.remember/now.md` | remember |
| Mid-task agent handoff — passing work to a subagent | `mattpocock:handoff` → temp file with artifact references | mattpocock/skills |

**Fallback** (remember not installed): write a brief handoff note to `.handoff.md` in project root; delete after resuming.

### Code Review (dual review per task)

Both must complete before marking a task done.

| Review | Use | Requires |
|---|---|---|
| Claude code review | `superpowers:requesting-code-review` | superpowers |
| Adversarial review | `codex:rescue` | codex |

**Codex model — resolve the current frontier dynamically, never hard-code a version.**
OpenAI rotates frontier model names (gpt-5.3 → gpt-5.4 → gpt-5.5 → …) and removes old ones
from the ChatGPT-account (OAuth) auth path. The codex CLI leaves `--model` unset by default and
falls back to a slug baked into the binary, which can be a removed model → HTTP 400. So the
adversarial review must select whatever OpenAI currently ships as frontier:

```bash
# Prints the current frontier slug from the live ~/.codex/models_cache.json (lowest priority).
python3 scripts/codex-frontier-model.py            # e.g. gpt-5.5 today
python3 scripts/codex-frontier-model.py --write-config   # also syncs ~/.codex/config.toml
```

Run `--write-config` to keep `~/.codex/config.toml`'s `model` in sync (it writes a managed,
auto-derived block — do not hand-edit the slug). When dispatching the Codex review you may also
pass it explicitly: `codex … -m "$(python3 scripts/codex-frontier-model.py)"`. Either way the
model is derived from OpenAI's live model list, so it tracks new frontier releases automatically.

**Fallback — Codex unavailable for ANY reason → never block; auto-fall back to a Claude adversarial review.**
"Unavailable" covers: not installed, **usage/rate limit hit**, auth failure, HTTP 400/5xx, a hung or
timed-out run (e.g. a `task` that starts a turn but emits no findings), or any other error. The rule
(set 2026-06-20): **do not wait, pause the phase, or burn time retrying** — immediately run a rigorous
**Claude** adversarial review in Codex's place (a fresh subagent with full file access and an explicit
adversarial mandate), save it to the normal `docs/reviews/...-review.md` path, and **note the Codex gap
in the review doc** so the Codex-specific pass can be re-attempted before merge if/when access returns.
One quick check (frontier model sync via `scripts/codex-frontier-model.py --write-config`, a single
re-run) is fine; beyond that, fall back. The Claude adversarial review satisfies the gate for proceeding.

**Bounded wait — never passively wait on a background review.** When a Codex review is dispatched in
the background, do NOT report "waiting on Codex" across turns or trust the completion ping (it can be
bogus). Within ~2–3 minutes, **read the actual Codex task output file** (`.../tasks/<bgId>.output`).
Treat as a hang → fall back immediately if: the file shows only `Thread ready` / `Turn started` with
no findings, it hasn't grown, the run reports a usage limit / auth / HTTP error, or no output exists.
The default posture is *make progress*, not *wait* — a Claude adversarial review is always available.

### Domain Terminology Stress-Test (Phase 1)

| When | Use | Requires |
|---|---|---|
| After brainstorming spec, before Codex review | `mattpocock:grill-with-docs` | mattpocock/skills |

**Fallback** (mattpocock not installed): use `superpowers:brainstorming` for a second pass with explicit instruction to challenge terminology and surface contradictions.

---

## Cleanup (Optional — Confirm with User Before Proceeding)

The following plugins were installed for this project's workflow and may not be needed on other projects. Ask the user before uninstalling — they may want to keep them globally.

| Plugin | Reason installed | General-purpose? |
|---|---|---|
| `mattpocock/skills` | TDD discovery mode, diagnose, grill-with-docs, handoff | Partially — useful for other projects too |
| `codex` | Adversarial review gate | Yes — useful for any project |

Plugins that are clearly general-purpose and should be kept regardless:
`superpowers`, `remember`, `playwright`, `pr-review-toolkit`, `hookify`

### Uninstall commands (if user confirms)

```bash
# mattpocock/skills (installed via npx, not /plugin)
npx skills@latest remove mattpocock/skills

# codex — uninstall via Claude Code plugin manager
```
