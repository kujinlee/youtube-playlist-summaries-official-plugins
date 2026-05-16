# Development Process

## Overview

This project follows a formal, gate-based development workflow. No phase begins until the previous phase has been reviewed and approved. The process is designed to catch mistakes at the earliest possible stage — requirements before design, design before code, code before testing claims.

---

## Sub-Projects

The application is divided into two sequential sub-projects. Sub-project 2 does not begin until Sub-project 1 is fully verified and merged.

| Sub-project | Scope |
|---|---|
| 1 — Backend | Types, lib layer, API routes, ingestion pipeline, deep-dive pipeline |
| 2 — Frontend | React components, SSE consumption, Obsidian URI, PDF viewer |

---

## Phases

### Phase 1 — Brainstorming
**Goal:** Understand intent and produce an approved design spec before any code is written.

- Collaborative dialogue: one question at a time, no assumptions
- Propose 2–3 approaches with trade-offs before recommending one
- Present design section by section, get approval after each
- Output: `docs/design-spec.md`
- **Adversarial doc review** — before asking the user to approve, dispatch Codex (or equivalent adversarial LLM) to review the spec for: architectural gaps, underspecified behaviour, security risks, internal contradictions, and missing edge cases. Address findings, then present the revised spec to the user.
- **Gate:** Adversarial review complete AND user approves design spec

### Phase 2 — Writing Plans
**Goal:** Break the approved design into a sequenced, task-by-task implementation plan.

- Each task is independently executable with clear inputs and outputs
- TDD tasks are explicit: test file written before implementation file
- Output: `docs/implementation-plan.md`
- **Adversarial doc review** — before asking the user to approve, dispatch Codex (or equivalent adversarial LLM) to review the plan for: missing tasks, wrong task order, underspecified acceptance criteria, and risks that will surface during implementation. Address findings, then present to the user.
- **Gate:** Adversarial review complete AND user approves implementation plan

### Phase 3 — Implementation (per task)
**Goal:** Implement each task with TDD, review, and adversarial review before moving to the next.

```
For each task:
  1. Write failing tests  (jest / @testing-library/react / Playwright)
  2. Write implementation code to pass tests
  3. Claude code review   (requesting-code-review skill)
  4. Codex adversarial review  (openai/codex-plugin-cc)
  5. Address feedback
  6. Task marked complete — proceed to next
```

- External API calls (Gemini, YouTube) are mocked at the lib boundary in unit tests
- E2E tests (Playwright) run against a dev server with API routes mocked

### Phase 4 — Verification
**Goal:** Confirm the sub-project works end-to-end before claiming done.

- Run the actual app, not just tests
- Step through every item in `docs/design-spec.md` verification checklist
- Collect evidence (screenshots, terminal output, file system checks)
- Tool: `verification-before-completion` skill
- **Gate:** All checklist items pass with evidence

### Phase 5 — Final Review + Finish
**Goal:** Final quality pass and clean integration.

- Full code review across all changed files
- Commit, push, PR
- Tool: `finishing-a-development-branch` skill

---

## Review Gates Summary

| Gate | Trigger | Blocks |
|---|---|---|
| Design adversarial review | After spec written (Phase 1) | Human approval cannot proceed |
| Design approval | After adversarial review (Phase 1) | Phase 2 cannot start |
| Plan adversarial review | After plan written (Phase 2) | Human approval cannot proceed |
| Plan approval | After adversarial review (Phase 2) | Phase 3 cannot start |
| Per-task review | After each task implementation | Next task cannot start |
| Adversarial review | After Claude review, per task | Next task cannot start |
| Verification | End of sub-project | Cannot claim done |
| Final review | Before merge | Cannot merge |

---

## Test Strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | jest + ts-jest | `lib/` functions, API route logic, type guards |
| Component | @testing-library/react | React components in isolation |
| E2E | Playwright | Full user flows in browser |

**TDD policy:** Tests are written before implementation for every `lib/` function and API route. Components follow the same discipline. Tests must be failing before the implementation is written.

**Mocking policy:** Gemini and YouTube API calls are mocked at the `lib/gemini.ts` and `lib/youtube.ts` boundary. No real API calls in unit or component tests. E2E tests mock at the API route level.

---

## Tools

| Tool | Purpose |
|---|---|
| `superpowers:brainstorming` | Phase 1 design dialogue |
| `codex:rescue` | Phase 1 & 2 adversarial doc review; Phase 3 adversarial code review |
| `superpowers:writing-plans` | Phase 2 task breakdown |
| `superpowers:test-driven-development` | Phase 3 TDD discipline |
| `superpowers:requesting-code-review` | Phase 3 Claude code review |
| `superpowers:verification-before-completion` | Phase 4 evidence collection |
| `superpowers:finishing-a-development-branch` | Phase 5 commit + PR |

---

## Adversarial Review

Adversarial LLM review applies at every phase — not just code. Human reviewers approve faster and less critically than AI agents with an explicit adversarial mandate. Requiring AI review before human approval catches architectural gaps, security issues, and missing edge cases that a human would likely accept in a casual read.

### Phase 1 & 2 — Doc Review

Dispatch Codex (`codex:rescue` skill) with an explicit adversarial mandate to review the spec or plan. Focus areas:
- **Spec:** architectural gaps, underspecified behaviour, security risks, internal contradictions, missing edge cases
- **Plan:** missing tasks, wrong task order, underspecified acceptance criteria, implementation risks

Address all High/P1 findings before presenting to the user for approval. Present Medium/P2 findings to the user for a decision.

**Precedent:** The OpenAI agent review of `docs/design-spec.md` and `docs/implementation-plan.md` (between Tasks 2 and 3) caught five significant gaps: SSE job identity, path traversal risk, deep-dive transcript fallback underspecification, output folder ambiguity, and Obsidian vault URI semantics. These were architectural decisions that would have affected Tasks 3–10 if left vague.

### Phase 3 — Code Review (per task)

Each task is reviewed by two independent models:

1. **Claude** (`requesting-code-review` skill) — checks correctness, security, spec adherence, TypeScript types
2. **Codex** (`codex:rescue` skill) — adversarial challenge of weaknesses, edge cases, and design decisions

The developer adjudicates conflicting feedback. Both reviews must complete before a task is marked done.
