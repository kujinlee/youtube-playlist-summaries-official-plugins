# Available Skills Reference

> **Generated** 2026-05-25 · `scripts/regen-skills-doc.py`
> Re-run after: `/plugin install`, `/plugin update`, `/plugin enable/disable`,
> or `npx skills@latest add/remove mattpocock/skills`.

All skills, agents, and commands accessible in this project, organized by source.
Status reflects `enabledPlugins` in `~/.claude/settings.json`.

> **Invoke:** `/skill-name` in the prompt, or they auto-trigger when conditions match.
> Namespaced skills use `plugin:skill` form (e.g. `superpowers:brainstorming`).
> Commands use `/command-name`. Agents are spawned by Claude Code via the Task tool.

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Plugin enabled — skill is available |
| ❌ | Plugin disabled — skill is unavailable |
| 🔵 | superpowers (core workflow) |
| 🟢 | mattpocock/skills (project-local `.agents/skills/`) |
| 🟠 | codex (adversarial review gate) |
| 🟣 | Other official plugins |
| ⬜ | Built-in FleetView (no plugin required) |

---

## 🔵 superpowers — `superpowers@claude-plugins-official` v5.1.0 ✅

Core workflow skills for the gate-based dev process in `docs/dev-process.md`.

| Name | Invoke | Description |
|---|---|---|
| **brainstorming** | `superpowers:brainstorming` | You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. |
| **dispatching-parallel-agents** | `superpowers:dispatching-parallel-agents` | Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies |
| **executing-plans** | `superpowers:executing-plans` | Use when you have a written implementation plan to execute in a separate session with review checkpoints |
| **finishing-a-development-branch** | `superpowers:finishing-a-development-branch` | Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by prese… |
| **receiving-code-review** | `superpowers:receiving-code-review` | Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable - requires… |
| **requesting-code-review** | `superpowers:requesting-code-review` | Use when completing tasks, implementing major features, or before merging to verify work meets requirements |
| **subagent-driven-development** | `superpowers:subagent-driven-development` | Use when executing implementation plans with independent tasks in the current session |
| **systematic-debugging** | `superpowers:systematic-debugging` | Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes |
| **test-driven-development** | `superpowers:test-driven-development` | Use when implementing any feature or bugfix, before writing implementation code |
| **using-git-worktrees** | `superpowers:using-git-worktrees` | Use when starting feature work that needs isolation from current workspace or before executing implementation plans - ensures an isolated workspace ex… |
| **using-superpowers** | `superpowers:using-superpowers` | Use when starting any conversation - establishes how to find and use skills, requiring Skill tool invocation before ANY response including clarifying… |
| **verification-before-completion** | `superpowers:verification-before-completion` | Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming… |
| **writing-plans** | `superpowers:writing-plans` | Use when you have a spec or requirements for a multi-step task, before touching code |
| **writing-skills** | `superpowers:writing-skills` | Use when creating new skills, editing existing skills, or verifying skills work before deployment |

---

## 🟢 mattpocock/skills — project-local `.agents/skills/` ✅

Discovery-mode TDD, domain stress-testing, and lightweight workflow utilities.
Installed via `npx skills@latest add mattpocock/skills` — lives in `.agents/skills/`.

| Name | Invoke | Description |
|---|---|---|
| **caveman** | `caveman` | Ultra-compressed communication mode. Cuts token usage ~75% by dropping filler, articles, and pleasantries while keeping full technical accuracy. |
| **diagnose** | `diagnose` | Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test. |
| **grill-me** | `grill-me` | Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. |
| **grill-with-docs** | `grill-with-docs` | Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT. |
| **handoff** | `handoff` | Compact the current conversation into a handoff document for another agent to pick up. |
| **improve-codebase-architecture** | `improve-codebase-architecture` | Find deepening opportunities in a codebase, informed by the domain language in CONTEXT.md and the decisions in docs/adr/. |
| **prototype** | `prototype` | Build a throwaway prototype to flesh out a design before committing to it. |
| **setup-matt-pocock-skills** | `setup-matt-pocock-skills` | Sets up an `## Agent skills` block in AGENTS.md/CLAUDE. |
| **tdd** | `tdd` | Test-driven development with red-green-refactor loop. |
| **to-issues** | `to-issues` | Break a plan, spec, or PRD into independently-grabbable issues on the project issue tracker using tracer-bullet vertical slices. |
| **to-prd** | `to-prd` | Turn the current conversation context into a PRD and publish it to the project issue tracker. |
| **triage** | `triage` | Triage issues through a state machine driven by triage roles. |
| **write-a-skill** | `write-a-skill` | Create new agent skills with proper structure, progressive disclosure, and bundled resources. |
| **zoom-out** | `zoom-out` | Tell the agent to zoom out and give broader context or a higher-level perspective. |

---

## 🟠 codex — `codex@openai-codex` v1.0.4 ✅

Adversarial review gate (required at every phase) plus internal Codex runtime helpers.
Always use `--fresh` to start a clean session.

| Name | Invoke | Description |
|---|---|---|
| **setup** | `codex:setup` | Check whether the local Codex CLI is ready; optionally toggle the stop-time review gate. |
| **rescue** | `codex:rescue` | **Primary adversarial review entry point.** Spec (Phase 1), plan (Phase 2), code (Phase 3). Always pass `--fresh`. |
| **codex-cli-runtime** | `codex:codex-cli-runtime` | Internal helper contract for calling the codex-companion runtime from Claude Code |
| **codex-result-handling** | `codex:codex-result-handling` | Internal guidance for presenting Codex helper output back to the user |
| **gpt-5-4-prompting** | `codex:gpt-5-4-prompting` | Internal guidance for composing Codex and GPT-5.4 prompts for coding, review, diagnosis, and research tasks inside the Codex Claude Code plugin |

---

## 🟣 Other Plugins — Enabled

### 🟣 claude-code-setup — `claude-code-setup@claude-plugins-official` v1.0.0 ✅

Analyze a codebase and recommend Claude Code automations (hooks, skills, MCP servers).

| Name | Invoke | Description |
|---|---|---|
| **claude-automation-recommender** | `claude-code-setup:claude-automation-recommender` | Analyze a codebase and recommend Claude Code automations (hooks, subagents, skills, plugins, MCP servers). |

### 🟣 claude-md-management — `claude-md-management@claude-plugins-official` v1.0.0 ✅

Audit and improve CLAUDE.md files across the project.

| Name | Invoke | Description |
|---|---|---|
| **claude-md-improver** | `claude-md-management:claude-md-improver` | Audit and improve CLAUDE.md files in repositories. Use when user asks to check, audit, update, improve, or fix CLAUDE.md files. Scans for all CLAUDE. |
| **revise-claude-md** | `/revise-claude-md` | Update CLAUDE.md with learnings from this session |

### 🟣 code-review — `code-review@claude-plugins-official` vd45efab8c85b ✅

Automated PR review using 4 parallel agents with confidence-based scoring to filter false positives.

| Name | Invoke | Description |
|---|---|---|
| **code-review** | `/code-review` | Code review a pull request |

### 🟣 code-simplifier — `code-simplifier@claude-plugins-official` v1.0.0 ✅

Simplify recently modified code for clarity, consistency, and maintainability.

| Name | Invoke | Description |
|---|---|---|
| **code-simplifier** | `code-simplifier:code-simplifier` *(agent)* | Simplifies and refines code for clarity, consistency, and maintainability while preserving all functionality. |

### 🟣 commit-commands — `commit-commands@claude-plugins-official` vd45efab8c85b ✅

Streamlined git workflow — commit, push, and open a PR in single commands.

| Name | Invoke | Description |
|---|---|---|
| **clean_gone** | `/clean_gone` | Cleans up all git branches marked as [gone] (branches that have been deleted on the remote but still exist locally), including removing associated wor… |
| **commit-push-pr** | `/commit-push-pr` | Commit, push, and open a PR |
| **commit** | `/commit` | Create a git commit |

### 🟣 explanatory-output-style — `explanatory-output-style@claude-plugins-official` v1.0.0 ✅

Educational output mode — adds `★ Insight` blocks with implementation rationale.

*(no skills, agents, or commands found — plugin may need updating)*

### 🟣 feature-dev — `feature-dev@claude-plugins-official` vd45efab8c85b ✅

Structured 7-phase feature development workflow: explore → clarify → architect → implement → review.

| Name | Invoke | Description |
|---|---|---|
| **feature-dev** | `/feature-dev` | Guided feature development with codebase understanding and architecture focus |
| **code-architect** | `feature-dev:code-architect` *(agent)* | Designs feature architectures by analyzing existing codebase patterns and conventions, then providing comprehensive implementation blueprints with spe… |
| **code-explorer** | `feature-dev:code-explorer` *(agent)* | Deeply analyzes existing codebase features by tracing execution paths, mapping architecture layers, understanding patterns and abstractions, and docum… |
| **code-reviewer** | `feature-dev:code-reviewer` *(agent)* | Reviews code for bugs, logic errors, security vulnerabilities, code quality issues, and adherence to project conventions, using confidence-based filte… |

### 🟣 frontend-design — `frontend-design@claude-plugins-official` vd45efab8c85b ✅

Production-grade frontend UI with high design quality; avoids generic AI aesthetics.

| Name | Invoke | Description |
|---|---|---|
| **frontend-design** | `frontend-design:frontend-design` | Create distinctive, production-grade frontend interfaces with high design quality. |

### 🟣 hookify — `hookify@claude-plugins-official` vd45efab8c85b ✅

Hook configuration management — prevent unwanted behaviors via pre/post tool hooks.

| Name | Invoke | Description |
|---|---|---|
| **writing-hookify-rules** | `hookify:writing-rules` | This skill should be used when the user asks to "create a hookify rule", "write a hook rule", "configure hookify", "add a hookify rule", or needs guid… |
| **configure** | `/configure` | Enable or disable hookify rules interactively |
| **help** | `/help` | Get help with the hookify plugin |
| **hookify** | `/hookify` | Create hooks to prevent unwanted behaviors from conversation analysis or explicit instructions |
| **list** | `/list` | List all configured hookify rules |
| **conversation-analyzer** | `hookify:conversation-analyzer` *(agent)* | Use this agent when analyzing conversation transcripts to find behaviors worth preventing with hooks. |

### 🟣 playwright — `playwright@claude-plugins-official` vd45efab8c85b ✅

*(no skills, agents, or commands found — plugin may need updating)*

### 🟣 pr-review-toolkit — `pr-review-toolkit@claude-plugins-official` vd45efab8c85b ✅

Six specialized review agents for thorough PR analysis (comments, tests, errors, types, simplification).

| Name | Invoke | Description |
|---|---|---|
| **review-pr** | `/review-pr` | Comprehensive PR review using specialized agents |
| **code-reviewer** | `pr-review-toolkit:code-reviewer` *(agent)* | Use this agent when you need to review code for adherence to project guidelines, style guides, and best practices. |
| **code-simplifier** | `pr-review-toolkit:code-simplifier` *(agent)* | Use this agent when code has been written or modified and needs to be simplified for clarity, consistency, and maintainability while preserving all fu… |
| **comment-analyzer** | `pr-review-toolkit:comment-analyzer` *(agent)* | Use this agent when you need to analyze code comments for accuracy, completeness, and long-term maintainability. |
| **pr-test-analyzer** | `pr-review-toolkit:pr-test-analyzer` *(agent)* | Use this agent when you need to review a pull request for test coverage quality and completeness. |
| **silent-failure-hunter** | `pr-review-toolkit:silent-failure-hunter` *(agent)* | Use this agent when reviewing code changes in a pull request to identify silent failures, inadequate error handling, and inappropriate fallback behavi… |
| **type-design-analyzer** | `pr-review-toolkit:type-design-analyzer` *(agent)* | Use this agent when you need expert analysis of type design in your codebase. |

### 🟣 pyright-lsp — `pyright-lsp@claude-plugins-official` v1.0.0 ✅

Pyright LSP integration for Python type checking.

*(no skills, agents, or commands found — plugin may need updating)*

### 🟣 ralph-loop — `ralph-loop@claude-plugins-official` v1.0.0 ✅

Iterative agent loop — repeatedly feeds Claude a task until a "completion promise" string appears.

| Name | Invoke | Description |
|---|---|---|
| **cancel-ralph** | `/cancel-ralph` | Cancel active Ralph Loop |
| **help** | `/help` | Explain Ralph Loop plugin and available commands |
| **ralph-loop** | `/ralph-loop` | Start Ralph Loop in current session |

### 🟣 remember — `remember@claude-plugins-official` v0.7.2 ✅

Session continuity — saves state to `.remember/now.md` for clean resumption next session.

| Name | Invoke | Description |
|---|---|---|
| **remember** | `remember:remember` | Save session state for clean continuation next session. |

### 🟣 security-guidance — `security-guidance@claude-plugins-official` vd45efab8c85b ✅

Security-focused code review and vulnerability guidance.

*(no skills, agents, or commands found — plugin may need updating)*

### 🟣 skill-creator — `skill-creator@claude-plugins-official` vd45efab8c85b ✅

Create, edit, eval, and benchmark Claude Code skills.

| Name | Invoke | Description |
|---|---|---|
| **skill-creator** | `skill-creator:skill-creator` | Create new skills, modify and improve existing skills, and measure skill performance. |

### 🟣 supabase — `supabase@claude-plugins-official` v0.1.6 ✅

Postgres performance optimization and best practices from Supabase.

| Name | Invoke | Description |
|---|---|---|
| **supabase** | `supabase:supabase` | Use when doing ANY task involving Supabase. |
| **supabase-postgres-best-practices** | `supabase:supabase-postgres-best-practices` | Postgres performance optimization and best practices from Supabase. |

### 🟣 typescript-lsp — `typescript-lsp@claude-plugins-official` v1.0.0 ✅

TypeScript LSP integration for diagnostics and in-context code intelligence.

*(no skills, agents, or commands found — plugin may need updating)*

---

## ⬜ Built-in FleetView Skills

Embedded in Claude Code itself — no plugin installation required.

| Name | Invoke | Description |
|---|---|---|
| **verify** | `verify` | Run the app and observe behavior to confirm a change works end-to-end (not just tests). |
| **run** | `run` | Launch this project's app to see a change working live. |
| **init** | `init` | Initialize a new CLAUDE.md with codebase documentation. |
| **code-review** | `code-review` | Review current diff for correctness bugs. Pass `--comment` to post as inline PR comments. |
| **security-review** | `security-review` | Security-focused code review. |
| **update-config** | `update-config` | Configure Claude Code via `settings.json` — hooks, permissions, env vars, automated behaviors. |
| **keybindings-help** | `keybindings-help` | Customize keyboard shortcuts in `~/.claude/keybindings.json`. |
| **fewer-permission-prompts** | `fewer-permission-prompts` | Scan transcripts for common read-only calls; add prioritized allowlist to reduce prompts. |
| **loop** | `loop` | Run a prompt or slash command on a recurring interval (e.g. `/loop 5m /foo`). |
| **schedule** | `schedule` | Create/manage scheduled remote agents on a cron schedule or one-time delay. |
| **claude-api** | `claude-api` | Build, debug, and optimize Claude API / Anthropic SDK apps with prompt caching. |
| **statusline-setup** | *(agent)* | Configure the Claude Code status line setting. |

---

## ❌ Disabled Plugins

Installed but toggled off in `~/.claude/settings.json`.
Skills are unavailable until re-enabled.

| Plugin | Version | Re-enable |
|---|---|---|
| `asana@claude-plugins-official` | d45efab8c85b — Asana task and project management commands. | `/plugin enable asana@claude-plugins-official` |
| `deploy-on-aws@claude-plugins-official` | 1.2.0 — Deploy to AWS and generate validated architecture diagrams (draw.io with AWS4 icons). | `/plugin enable deploy-on-aws@claude-plugins-official` |
| `github@claude-plugins-official` | d45efab8c85b — GitHub PR, issue, and repo management commands. | `/plugin enable github@claude-plugins-official` |

---

## Project-Specific Skill Routing

When multiple skills handle the same task, use this table (from `docs/plugins.md`):

| Task | Condition | Skill |
|---|---|---|
| **TDD** | Behaviors known upfront | `superpowers:test-driven-development` |
| **TDD** | Behavior discovered during implementation | `tdd` (mattpocock) |
| **Debugging** | Clear feedback loop (test failure, stack trace) | `superpowers:systematic-debugging` |
| **Debugging** | Building the feedback loop *is* the hard problem | `diagnose` (mattpocock) |
| **Session handoff** | End of session | `remember:remember` |
| **Mid-task handoff** | Passing work to a subagent | `handoff` (mattpocock) |
| **Code review** | Claude review (first) | `superpowers:requesting-code-review` |
| **Adversarial review** | Every phase gate | `codex:rescue --fresh` |
| **Domain stress-test** | After brainstorming, before Codex | `grill-with-docs` (mattpocock) |
| **Writing skills** | Any skill authoring | `superpowers:writing-skills` |
