# Development Process

Gate-based workflow — no phase begins until the previous is reviewed and approved.
This file is the canonical source for the workflow. It lives in the project repo so the process is reproducible by anyone who clones it.

---

## Session Resume

At session start, verify progress from ground-truth sources before acting:
1. `git log --oneline` — which tasks are committed
2. `ls tests/lib/ docs/reviews/` — what work exists on disk
3. Cross-reference `docs/implementation-plan.md` — find first uncommitted task

Never rely on context summary alone — it is a compressed snapshot and can be stale after `/compact`.

---

## Reference Docs (Read On Demand)

These files are not @-included — read them when the trigger condition is met.

| Doc | Read when |
|---|---|
| `docs/implementation-plan.md` | Session resume (find next uncommitted task); start of each task |
| `docs/design-spec.md` | Phase 4 verification checklist; any spec ambiguity during implementation |
| `docs/available-skills.md` | Unsure which skill to use or how to invoke it; after installing or updating plugins. Say **"sync docs"** or run `/sync-docs` (`sync-docs` skill) to regenerate. |

---

## Phases

0. **Project Setup** (before Phase 1)
   - `git init` + initial commit
   - Create `docs/` folder

1. **Brainstorming** → `docs/design-spec.md`
   - Dialogue → spec → `grill-with-docs` (terminology + CONTEXT.md) → Codex adversarial review
   - Gate: grill-with-docs + adversarial review + user approval
   - **For projects with a frontend:** brainstorming includes wireframe + design tokens. `docs/design-spec.md` must contain a `## UI Design` section (ASCII wireframe, token table, badge/component specs) before any Tailwind or styling code is written. The gate is unchanged — user approves the full spec, which now includes the UI section.
   - **For projects that write files:** `docs/design-spec.md` must contain a `## Output File Format` section with: filename convention (with example), required frontmatter/header fields, and an annotated sample file body. No pipeline or file-writing task begins until this section is approved.
   - **For projects with a list/table UI:** `docs/design-spec.md` must enumerate every sort, filter, and grouping operation the user needs — column, direction semantics, and what undefined/missing values do. Discovering missing operations after implementation counts as a spec gap.
   - **For any UI component that triggers an async operation (fetch, ingest, AI generation):** The spec must answer before any component task begins: (1) Blocking or non-blocking? (overlay vs. status bar vs. inline indicator) — default to non-blocking unless the user cannot do anything useful during the operation. (2) What does the user need to see/do while the operation runs? (3) What triggers dismissal? A full-screen blocking overlay requires explicit justification in the spec; "simpler to build" is not justification. Use the brainstorming Visual Companion to show a non-blocking alternative before deciding.
   - **For tasks that include UI components generating URLs or containing modals/overlays:** `docs/design-spec.md` must contain a `## URL Contracts` table (`Component | Link text | Full URL with all params`) — one row per distinct link — and a `## Overlay Dismissal` table (`Component | Mechanism | Expected result`) — one row per dismissal path. Gate: user approves both tables before any component task begins.

2. **Writing Plans** → `docs/implementation-plan.md`
   - Codex adversarial review (plan)
   - Gate: adversarial review + user approval
   - **Required:** immediately after saving the plan, create a Post-Plan Gate checklist (see below) — do not dispatch any implementation subagent until all items are marked complete

3. **Implementation** (per task)
   - **Execution method default (set 2026-06-09):** use **`superpowers:subagent-driven-development`** — a fresh subagent per task with two-stage review between tasks. Proceed with this method automatically; do **not** ask the user to choose between subagent-driven and inline execution each time. (The Phase 2 plan-approval gate still applies — this default governs only *how* an already-approved plan is executed.)
   - At task start: create a TaskCreate checklist (see Per-Task Checklist below) — do not write any code until the list exists
   - Write failing tests → implement → Claude code review → Codex adversarial review → address → mark done
   - Save each review to `docs/reviews/task-N-<name>-review.md` (Claude) and `docs/reviews/task-N-<name>-codex.md` (Codex)
   - TDD: tests written before implementation; must be failing first

4. **Verification**
   - Before clicking anything: enumerate ALL UX test cases as a `TaskCreate` list — one task per scenario (happy path, each error state, each dismissal path, each disabled state). No ad-hoc clicking before the list exists.
   - Work through the list in order; mark each `completed` with `TaskUpdate` immediately after verifying it. Do not batch.
   - Run actual app; step through `docs/design-spec.md` checklist with evidence
   - Tool: `verification-before-completion`
   - **Screenshots:** always save to `.screenshots/<name>.png` — never to the project root. The `.screenshots/` folder is gitignored; delete its contents after verification is complete.

5. **Final Review + Finish**
   - Full code review → commit → push → PR
   - Tool: `finishing-a-development-branch`

---

## Tools

| Tool | Phase |
|---|---|
| `superpowers:brainstorming` | 1 — design dialogue |
| `mattpocock:grill-with-docs` | 1 — terminology stress-test → CONTEXT.md |
| `codex:rescue` | 1, 2 — doc adversarial review; 3 — code adversarial review |
| `superpowers:writing-plans` | 2 — task breakdown |
| `superpowers:test-driven-development` | 3 — TDD (behaviors specified upfront) |
| `superpowers:requesting-code-review` | 3 — Claude code review |
| `TaskCreate` / `TaskUpdate` | 3 — per-task checklist (create at task start, mark each step done) |
| `superpowers:verification-before-completion` | 4 — evidence collection |
| `superpowers:finishing-a-development-branch` | 5 — commit + PR |

---

## Post-Plan Gate Checklist

Immediately after saving the plan document, create these items with `TaskCreate`. Do not dispatch any implementation subagent until all items are marked `completed` with `TaskUpdate`.

```
[ ] Run Codex adversarial review of the plan (codex:rescue --fresh; include plan file as context)
[ ] Save review to docs/reviews/plan-<feature>-codex.md
[ ] Address all Blocking and High findings; present Medium findings for user decision
[ ] Get explicit human approval ("looks good, proceed" or equivalent)
[ ] Clear sentinel: rm .claude/plan-gate-pending  (if sentinel exists from the write hook)
```

**Rule:** the "Get human approval" step is not done until the human has responded affirmatively in the conversation. Do not mark it complete speculatively.

**Why both hook and task list?** The hook (PreToolUse on Agent) provides a machine-enforceable backstop — it blocks subagent dispatch if the sentinel file exists. The task list provides the human-readable contract that guides what needs to happen before the sentinel is cleared. Neither is sufficient alone: the hook cannot enforce that reviews happened; the task list cannot prevent premature dispatch if ignored.

---

## Per-Task Checklist

At the start of every implementation task, create the following items with `TaskCreate` before writing any code. Mark each `completed` with `TaskUpdate` as you finish it — do not batch.

```
[ ] Enumerate all behaviors + edge cases in plan file (table: behavior, trigger, expected)
[ ] (If complex — see "Behaviors adversarial review" below) Codex adversarial review of behaviors table — wrong, missing, or underspecified?
[ ] Write failing tests (RED)
[ ] Run tests — confirm failure for the right reason
[ ] Implement (GREEN)
[ ] Run tests — confirm all pass
[ ] Run full suite — confirm no regressions
[ ] Claude code review (superpowers:requesting-code-review)
[ ] Write docs/reviews/task-N-<name>-review.md
[ ] Codex adversarial review (codex:rescue)
[ ] Write docs/reviews/task-N-<name>-codex.md
[ ] Address all High/P1 and Important findings
[ ] Re-run tests — confirm still green
[ ] Commit
```

**Rule:** a step is not done until it is marked done. If a step is skipped or deferred, it stays open — do not mark it complete.

**Enumerate step:** Write the behaviors table in the task's plan file **before writing any test code**. For each behavior also ask: what if the input is missing or invalid? what if each external call fails? what if it fails mid-chain? Every answer that isn't "impossible" becomes a row in the table and a test case.

**Plan file format — required section:** Each task plan must include an **Enumerated Behaviors** table before any implementation design. Columns: `# | Behavior | Trigger | Expected`. Must include edge cases. This table is the contract tests are written against and that code reviewers check for coverage gaps. Surviving context compression is a key reason to write it in the plan file rather than in conversation.

**Mandatory behavior categories** — check these before writing any rows:
- **URL-generating components:** One row per link, Expected = exact href with every query param named (e.g. `/api/pdf/[id]?outputFolder=…&type=summary`). A row that names the route but omits params is incomplete.
- **Modal/overlay/status-bar components:** One row per dismissal mechanism (backdrop click, Escape, close button, auto-close on done). Zero dismissal rows = incomplete.
- **Optional-prop rendering:** One row for the null/absent state and one for the non-null/present state of each nullable prop. Happy-path-only = incomplete.

If a task touches URL-generating components, overlays, or optional props and the behaviors table has zero rows in the relevant category, the Enumerate step is not done.

**Behaviors adversarial review (conditional):** After enumerating behaviors and before writing tests, run Codex adversarial review of the behaviors table when the task has any of: >8 behaviors, SSE/async state machine, multiple error paths, or concurrent interactions. Skip for simple rendering, pure data transforms, or single-function tasks.

---

## TDD Policy

### Is TDD a good fit?

**Yes:** core business logic, parsing/transformation, external API boundaries,
data integrity (file I/O, atomic writes), error handling with branching paths,
security validation, complex orchestration.

**No:** config/scaffold, TypeScript types (compiler validates), thin wrappers
(one smoke test after instead), simple UI layouts and rendering,
UI wiring/integration (E2E covers this), exploratory spikes or prototypes.

If No: implement first → spot-test any non-trivial logic after → review.

### Which TDD skill?

See `docs/plugins.md` — TDD conflict resolution.

### Test layers

Unit (jest + ts-jest) → Component (@testing-library/react) → E2E (Playwright)

Mock external API calls at the lib boundary. No real API calls in unit/component tests.

### Fast feedback loop

Run the narrowest test that covers the changed code first — full suite only before commit.

| Changed file | Run first |
|---|---|
| `components/Foo.tsx` | `npx jest Foo` |
| `lib/bar.ts` | `npx jest bar` |
| Visual / interaction bug | `npx playwright test --grep "keyword" --headed` |
| Cross-component wiring, SSE, routing | `npx playwright test` |

**Watch mode** eliminates manual re-runs during active work:
```bash
npm test -- --watch   # hit p to filter by file, t to filter by test name
```

**Rule:** targeted test green → full `npm test` once → commit. Never skip the full suite before committing, but never wait for it during iteration.

### E2E quality rules

Violating any rule below means the E2E step is not done.

- **Link assertions — assert ALL params, not just one.** Wrong: `expect(url.searchParams.get('type')).toBe('summary')`. Right: one `expect` per param listed in the URL Contracts table (`type`, `outputFolder`, etc.).
- **Status bar / overlay dismissal — test ALL dismissal paths.** For each mechanism (✕ button, Escape, auto-close on done), write one test block that exercises that specific path.
- **Conditional rendering — fixtures must cover null and non-null.** For any nullable prop (e.g. `summaryPdf`, `deepDiveMd`), the E2E fixture set must include at least one video where the prop is `null` and one where it is set.

---

## Adversarial Review

Dispatch Codex (`codex:rescue`) with an explicit adversarial mandate at every phase.
- **Spec:** architectural gaps, underspecified behaviour, security risks, contradictions, edge cases
- **Plan:** missing tasks, wrong order, underspecified acceptance criteria, implementation risks
- **Code:** per-task (Claude + Codex independently). Both must complete before marking a task done.

Address all High/P1 findings before showing the user. Present Medium/P2 for a decision.

---

## Project-Specific: Sub-Projects

Two sequential sub-projects. Sub-project 2 does not begin until Sub-project 1 is fully verified and merged.

| Sub-project | Scope |
|---|---|
| 1 — Backend | Types, lib layer, API routes, ingestion pipeline, deep-dive pipeline |
| 2 — Frontend | React components, SSE consumption, Obsidian URI, PDF viewer |

---

## Project-Specific: Mocking Boundaries

| Boundary | What is mocked |
|---|---|
| `lib/gemini.ts` | All Gemini API calls |
| `lib/youtube.ts` | YouTube Data API + transcript fetching |
| API route level | E2E tests mock here, not at the lib boundary |

---

## Project-Specific: Adversarial Review Precedent

The Codex review of `docs/design-spec.md` and `docs/implementation-plan.md` (between Tasks 2 and 3) caught five significant gaps: SSE job identity, path traversal risk, deep-dive transcript fallback underspecification, output folder ambiguity, and Obsidian vault URI semantics. These were architectural decisions that would have affected Tasks 3–10 if left vague.
