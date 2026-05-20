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

---

## Phases

0. **Project Setup** (before Phase 1)
   - `git init` + initial commit
   - Create `docs/` folder

1. **Brainstorming** → `docs/design-spec.md`
   - Dialogue → spec → `grill-with-docs` (terminology + CONTEXT.md) → Codex adversarial review
   - Gate: grill-with-docs + adversarial review + user approval

2. **Writing Plans** → `docs/implementation-plan.md`
   - Codex adversarial review (plan)
   - Gate: adversarial review + user approval

3. **Implementation** (per task)
   - At task start: create a TaskCreate checklist (see Per-Task Checklist below) — do not write any code until the list exists
   - Write failing tests → implement → Claude code review → Codex adversarial review → address → mark done
   - Save each review to `docs/reviews/task-N-<name>-review.md` (Claude) and `docs/reviews/task-N-<name>-codex.md` (Codex)
   - TDD: tests written before implementation; must be failing first

4. **Verification**
   - Run actual app; step through `docs/design-spec.md` checklist with evidence
   - Tool: `verification-before-completion`

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

## Per-Task Checklist

At the start of every implementation task, create the following items with `TaskCreate` before writing any code. Mark each `completed` with `TaskUpdate` as you finish it — do not batch.

```
[ ] Enumerate all behaviors + edge cases from acceptance criteria
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

**Enumerate step:** for each behavior in the acceptance criteria, also ask: what if the input is missing or invalid? what if each external call fails? what if it fails mid-chain? every answer that isn't "impossible" becomes a test case before RED begins.

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
