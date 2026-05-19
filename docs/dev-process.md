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
| `superpowers:verification-before-completion` | 4 — evidence collection |
| `superpowers:finishing-a-development-branch` | 5 — commit + PR |

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

- `superpowers:test-driven-development` — behaviors fully specified upfront
  (lib functions, components with defined acceptance criteria).
  Write all failing tests first.

- `mattpocock:tdd` — behavior discovered during implementation
  (orchestration, pipelines, API routes, page wiring).
  One tracer bullet at a time.

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
