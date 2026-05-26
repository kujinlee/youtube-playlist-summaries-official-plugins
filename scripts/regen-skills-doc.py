#!/usr/bin/env python3
"""
Regenerate docs/available-skills.md from installed plugins and local skills.

Reads
-----
  ~/.claude/plugins/installed_plugins.json  — installed plugins + versions
  ~/.claude/settings.json                   — enabledPlugins toggle map
  ~/.claude/plugins/cache/                  — SKILL.md, agents/*.md, commands/*.md
  .agents/skills/                           — project-local mattpocock skills

Writes
------
  docs/available-skills.md

Usage
-----
  python3 scripts/regen-skills-doc.py        # from project root
  scripts/regen-skills-doc.sh               # bash wrapper (same thing)

Re-run after any:
  /plugin install …   /plugin uninstall …
  /plugin update      /plugin enable/disable …
  npx skills@latest add/remove mattpocock/skills
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date
from pathlib import Path

# ── paths ──────────────────────────────────────────────────────────────────────

CLAUDE_DIR   = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude"))
PLUGIN_CACHE = CLAUDE_DIR / "plugins" / "cache"
INSTALLED    = CLAUDE_DIR / "plugins" / "installed_plugins.json"
SETTINGS     = CLAUDE_DIR / "settings.json"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOCAL_SKILLS = PROJECT_ROOT / ".agents" / "skills"
OUTPUT       = PROJECT_ROOT / "docs" / "available-skills.md"

# ── constants ──────────────────────────────────────────────────────────────────

SUPERPOWERS_ID = "superpowers@claude-plugins-official"
CODEX_ID       = "codex@openai-codex"
SKIP_IDS       = {SUPERPOWERS_ID, CODEX_ID}

# Human-readable label + one-line context for each known plugin.
# Keys must match the plugin ID in installed_plugins.json.
PLUGIN_META: dict[str, dict[str, str]] = {
    "hookify@claude-plugins-official": {
        "label": "hookify",
        "desc":  "Hook configuration management — prevent unwanted behaviors via pre/post tool hooks.",
    },
    "remember@claude-plugins-official": {
        "label": "remember",
        "desc":  "Session continuity — saves state to `.remember/now.md` for clean resumption next session.",
    },
    "commit-commands@claude-plugins-official": {
        "label": "commit-commands",
        "desc":  "Streamlined git workflow — commit, push, and open a PR in single commands.",
    },
    "pr-review-toolkit@claude-plugins-official": {
        "label": "pr-review-toolkit",
        "desc":  "Six specialized review agents for thorough PR analysis (comments, tests, errors, types, simplification).",
    },
    "ralph-loop@claude-plugins-official": {
        "label": "ralph-loop",
        "desc":  'Iterative agent loop — repeatedly feeds Claude a task until a "completion promise" string appears.',
    },
    "skill-creator@claude-plugins-official": {
        "label": "skill-creator",
        "desc":  "Create, edit, eval, and benchmark Claude Code skills.",
    },
    "frontend-design@claude-plugins-official": {
        "label": "frontend-design",
        "desc":  "Production-grade frontend UI with high design quality; avoids generic AI aesthetics.",
    },
    "claude-md-management@claude-plugins-official": {
        "label": "claude-md-management",
        "desc":  "Audit and improve CLAUDE.md files across the project.",
    },
    "claude-code-setup@claude-plugins-official": {
        "label": "claude-code-setup",
        "desc":  "Analyze a codebase and recommend Claude Code automations (hooks, skills, MCP servers).",
    },
    "supabase@claude-plugins-official": {
        "label": "supabase",
        "desc":  "Postgres performance optimization and best practices from Supabase.",
    },
    "feature-dev@claude-plugins-official": {
        "label": "feature-dev",
        "desc":  "Structured 7-phase feature development workflow: explore → clarify → architect → implement → review.",
    },
    "code-review@claude-plugins-official": {
        "label": "code-review",
        "desc":  "Automated PR review using 4 parallel agents with confidence-based scoring to filter false positives.",
    },
    "code-simplifier@claude-plugins-official": {
        "label": "code-simplifier",
        "desc":  "Simplify recently modified code for clarity, consistency, and maintainability.",
    },
    "security-guidance@claude-plugins-official": {
        "label": "security-guidance",
        "desc":  "Security-focused code review and vulnerability guidance.",
    },
    "typescript-lsp@claude-plugins-official": {
        "label": "typescript-lsp",
        "desc":  "TypeScript LSP integration for diagnostics and in-context code intelligence.",
    },
    "pyright-lsp@claude-plugins-official": {
        "label": "pyright-lsp",
        "desc":  "Pyright LSP integration for Python type checking.",
    },
    "explanatory-output-style@claude-plugins-official": {
        "label": "explanatory-output-style",
        "desc":  "Educational output mode — adds `★ Insight` blocks with implementation rationale.",
    },
    "deploy-on-aws@claude-plugins-official": {
        "label": "deploy-on-aws",
        "desc":  "Deploy to AWS and generate validated architecture diagrams (draw.io with AWS4 icons).",
    },
    "github@claude-plugins-official": {
        "label": "github",
        "desc":  "GitHub PR, issue, and repo management commands.",
    },
    "asana@claude-plugins-official": {
        "label": "asana",
        "desc":  "Asana task and project management commands.",
    },
}

# Built-in FleetView skills — not installed via plugins; hardcoded here.
# Tuple: (name, invoke, trigger, description)
FLEETVIEW_SKILLS: list[tuple[str, str, str, str]] = [
    ("verify",                   "`verify`",                  "`auto + /slash`", "Run the app and observe behavior to confirm a change works end-to-end (not just tests)."),
    ("run",                      "`run`",                     "`auto + /slash`", "Launch this project's app to see a change working live."),
    ("init",                     "`init`",                    "`auto + /slash`", "Initialize a new CLAUDE.md with codebase documentation."),
    ("code-review",              "`code-review`",             "`auto + /slash`", "Review current diff for correctness bugs. Pass `--comment` to post as inline PR comments."),
    ("security-review",          "`security-review`",         "`auto + /slash`", "Security-focused code review."),
    ("update-config",            "`update-config`",           "`auto + /slash`", "Configure Claude Code via `settings.json` — hooks, permissions, env vars, automated behaviors."),
    ("keybindings-help",         "`keybindings-help`",        "`auto + /slash`", "Customize keyboard shortcuts in `~/.claude/keybindings.json`."),
    ("fewer-permission-prompts", "`fewer-permission-prompts`","`auto + /slash`", "Scan transcripts for common read-only calls; add prioritized allowlist to reduce prompts."),
    ("loop",                     "`loop`",                    "`auto + /slash`", "Run a prompt or slash command on a recurring interval (e.g. `/loop 5m /foo`)."),
    ("schedule",                 "`schedule`",                "`auto + /slash`", "Create/manage scheduled remote agents on a cron schedule or one-time delay."),
    ("claude-api",               "`claude-api`",              "`auto + /slash`", "Build, debug, and optimize Claude API / Anthropic SDK apps with prompt caching."),
    ("statusline-setup",         "*(agent)*",                 "agent (Task tool)", "Configure the Claude Code status line setting."),
]

# Project-specific skill conflict routing (mirrors docs/plugins.md).
ROUTING_TABLE: list[tuple[str, str, str]] = [
    ("**TDD**",                 "Behaviors known upfront",                                "`superpowers:test-driven-development`"),
    ("**TDD**",                 "Behavior discovered during implementation",              "`tdd` (mattpocock)"),
    ("**Debugging**",           "Clear feedback loop (test failure, stack trace)",        "`superpowers:systematic-debugging`"),
    ("**Debugging**",           "Building the feedback loop *is* the hard problem",       "`diagnose` (mattpocock)"),
    ("**Session handoff**",     "End of session",                                         "`remember:remember`"),
    ("**Mid-task handoff**",    "Passing work to a subagent",                             "`handoff` (mattpocock)"),
    ("**Code review**",         "Claude review (first)",                                  "`superpowers:requesting-code-review`"),
    ("**Adversarial review**",  "Every phase gate",                                       "`codex:rescue --fresh`"),
    ("**Domain stress-test**",  "After brainstorming, before Codex",                      "`grill-with-docs` (mattpocock)"),
    ("**Writing skills**",      "Any skill authoring",                                    "`superpowers:writing-skills`"),
]

# ── helpers ────────────────────────────────────────────────────────────────────

def load_json(path: Path, default: dict) -> dict:
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        print(f"  warn: could not read {path}: {exc}", file=sys.stderr)
        return default


def parse_frontmatter(text: str) -> dict:
    """
    Extract fields from YAML-style frontmatter.

    Returns a dict with at minimum:
      name                     : str
      description              : str
      disable-model-invocation : bool  (default False)
      user-invocable           : bool  (default True)

    Handles three description formats:
      description: single line value
      description: "quoted value"
      description: >
        block scalar (indented lines joined with spaces)
    """
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not m:
        return {"name": "", "description": "", "disable-model-invocation": False, "user-invocable": True}
    fm = m.group(1)

    name_m = re.search(r"^name:\s*(.+)$", fm, re.MULTILINE)
    name = name_m.group(1).strip().strip('"') if name_m else ""

    # Block scalar (> or |)
    block_m = re.search(
        r"^description:\s*[>|]\s*\n((?:[ \t]+.+\n?)+)", fm, re.MULTILINE
    )
    if block_m:
        desc = " ".join(ln.strip() for ln in block_m.group(1).splitlines() if ln.strip())
    else:
        inline_m = re.search(r"^description:\s*(.+)$", fm, re.MULTILINE)
        desc = inline_m.group(1).strip().strip('"') if inline_m else ""

    # Boolean override fields that control how a skill is triggered.
    # disable-model-invocation: true  → Claude won't auto-fire; user must use /slash
    # user-invocable: false           → Claude auto-fires only; user cannot invoke
    disable_m  = re.search(r"^disable-model-invocation:\s*true\b", fm, re.MULTILINE | re.IGNORECASE)
    user_inv_m = re.search(r"^user-invocable:\s*false\b",          fm, re.MULTILINE | re.IGNORECASE)

    return {
        "name": name,
        "description": desc,
        "disable-model-invocation": bool(disable_m),
        "user-invocable": not bool(user_inv_m),
    }


def read_desc(md_path: Path) -> tuple[str, str]:
    """Return (name, description) from any plugin .md file."""
    try:
        text = md_path.read_text()
        fm = parse_frontmatter(text)
        name = fm.get("name") or md_path.stem
        desc = fm.get("description", "").strip().strip('"')
        return name, desc
    except Exception:
        return md_path.stem, ""


def invocation_type(md_path: Path, kind: str) -> str:
    """
    Return the Trigger column value for a row.

    kind: 'skill' | 'agent' | 'command'

    Possible return values and their meanings:
      `auto + /slash`   — Claude auto-fires AND user can type /skill-name
      `/slash only`     — user must type /skill-name; Claude won't auto-fire
                          (SKILL.md has disable-model-invocation: true)
      `auto only`       — Claude auto-fires only; user cannot invoke
                          (SKILL.md has user-invocable: false)
      `/command`        — explicit /command-name only; never auto-triggered
      agent (Task tool) — spawned by Claude's Task tool; not user-invocable
    """
    if kind == "agent":
        return "agent (Task tool)"
    if kind == "command":
        return "`/command`"
    # kind == "skill" — inspect frontmatter for override flags
    try:
        fm = parse_frontmatter(md_path.read_text())
        if fm.get("disable-model-invocation"):
            return "`/slash only`"
        if not fm.get("user-invocable", True):
            return "`auto only`"
    except Exception:
        pass
    return "`auto + /slash`"


def clip(desc: str, max_chars: int = 150) -> str:
    """Truncate at the first sentence boundary ≤ max_chars."""
    desc = desc.strip().strip('"')
    if len(desc) <= max_chars:
        return desc
    cut = desc.rfind(".", 0, max_chars)
    if cut > 20:
        return desc[: cut + 1]
    return desc[:max_chars].rstrip() + "…"


def latest_dir(root: Path) -> Path | None:
    """The most recently modified subdirectory (version directory) of root."""
    if not root.exists():
        return None
    dirs = [d for d in root.iterdir() if d.is_dir()]
    return max(dirs, key=lambda d: d.stat().st_mtime) if dirs else None


def plugin_version(plugin_id: str, installed: dict) -> str:
    entries = installed.get("plugins", {}).get(plugin_id, [])
    return entries[0].get("version", "?") if entries else "?"


def plugin_cache_dir(plugin_id: str) -> Path:
    """Resolve ~/.claude/plugins/cache/<marketplace>/<short-name>."""
    if "@" in plugin_id:
        short, marketplace = plugin_id.split("@", 1)
    else:
        short, marketplace = plugin_id, "claude-plugins-official"
    return PLUGIN_CACHE / marketplace / short


# ── table builders ─────────────────────────────────────────────────────────────

def _table_header() -> list[str]:
    return ["| Name | Invoke | Trigger | Description |", "|---|---|---|---|"]


def skills_rows(plugin_dir: Path, plugin_id: str) -> list[str]:
    """One row per SKILL.md found under the latest version of plugin_dir."""
    latest = latest_dir(plugin_dir)
    if not latest:
        return []
    short = plugin_id.split("@")[0]
    rows = []
    for skill_md in sorted(latest.rglob("SKILL.md")):
        # Skip reference docs and internal .system skills
        parts = skill_md.parts
        if "references" in parts or ".system" in parts:
            continue
        skill_name = skill_md.parent.name
        name, desc = read_desc(skill_md)
        invoke  = f"`{short}:{skill_name}`"
        trigger = invocation_type(skill_md, "skill")
        rows.append(f"| **{name}** | {invoke} | {trigger} | {clip(desc)} |")
    return rows


def agents_rows(plugin_dir: Path, plugin_id: str) -> list[str]:
    """One row per .md file in the agents/ directory."""
    latest = latest_dir(plugin_dir)
    if not latest:
        return []
    agents_dir = latest / "agents"
    if not agents_dir.exists():
        return []
    short = plugin_id.split("@")[0]
    rows = []
    for f in sorted(agents_dir.glob("*.md")):
        name, desc = read_desc(f)
        invoke = f"`{short}:{name}`"
        rows.append(f"| **{name}** | {invoke} | agent (Task tool) | {clip(desc)} |")
    return rows


def commands_rows(plugin_dir: Path) -> list[str]:
    """One row per .md file in the commands/ directory."""
    latest = latest_dir(plugin_dir)
    if not latest:
        return []
    cmds_dir = latest / "commands"
    if not cmds_dir.exists():
        return []
    rows = []
    for f in sorted(cmds_dir.glob("*.md")):
        name, desc = read_desc(f)
        invoke = f"`/{name}`"
        rows.append(f"| **{name}** | {invoke} | `/command` | {clip(desc)} |")
    return rows


# ── document assembly ──────────────────────────────────────────────────────────

def section(lines: list[str], *parts: str) -> None:
    lines.extend(parts)
    lines.append("")


def plugin_section(
    lines: list[str],
    plugin_id: str,
    installed: dict,
    enabled: bool,
    *,
    emoji: str = "🟣",
    extra_rows: list[str] | None = None,
    intro: str = "",
) -> None:
    """Generate a full plugin section with skills, agents, and commands."""
    meta  = PLUGIN_META.get(plugin_id, {})
    label = meta.get("label", plugin_id.split("@")[0])
    ver   = plugin_version(plugin_id, installed)
    status = "✅" if enabled else "❌"
    pdir  = plugin_cache_dir(plugin_id)

    section(lines, f"### {emoji} {label} — `{plugin_id}` v{ver} {status}")
    if intro:
        section(lines, intro)

    s_rows = skills_rows(pdir, plugin_id)
    a_rows = agents_rows(pdir, plugin_id)
    c_rows = commands_rows(pdir)
    all_rows = (extra_rows or []) + s_rows + c_rows + a_rows

    if all_rows:
        lines.extend(_table_header())
        lines.extend(all_rows)
    else:
        lines.append("*(no skills, agents, or commands found — plugin may need updating)*")
    lines.append("")


# ── main ───────────────────────────────────────────────────────────────────────

def build() -> str:
    installed = load_json(INSTALLED, {"plugins": {}})
    settings  = load_json(SETTINGS, {})
    enabled_map: dict[str, bool] = settings.get("enabledPlugins", {})

    def is_enabled(pid: str) -> bool:
        return enabled_map.get(pid, True)  # absent = enabled (legacy install)

    all_ids   = list(installed.get("plugins", {}).keys())
    other_ids = [p for p in all_ids if p not in SKIP_IDS]
    enabled_others  = [p for p in other_ids if is_enabled(p)]
    disabled_others = [p for p in other_ids if not is_enabled(p)]

    lines: list[str] = []

    # ── header ─────────────────────────────────────────────────────────────────
    lines += [
        "# Available Skills Reference",
        "",
        f"> **Generated** {date.today().isoformat()} · `scripts/regen-skills-doc.py`",
        f"> Re-run after: `/plugin install`, `/plugin update`, `/plugin enable/disable`,",
        f"> or `npx skills@latest add/remove mattpocock/skills`.",
        "",
        "All skills, agents, and commands accessible in this project, organized by source.",
        "Status reflects `enabledPlugins` in `~/.claude/settings.json`.",
        "",
        "> **Invoke:** `/skill-name` in the prompt, or they auto-trigger when conditions match.",
        "> Namespaced skills use `plugin:skill` form (e.g. `superpowers:brainstorming`).",
        "> Commands use `/command-name`. Agents are spawned by Claude Code via the Task tool.",
        "",
        "---",
        "",
        "## Legend",
        "",
        "| Symbol | Meaning |",
        "|---|---|",
        "| ✅ | Plugin enabled — skill is available |",
        "| ❌ | Plugin disabled — skill is unavailable |",
        "| 🔵 | superpowers (core workflow) |",
        "| 🟢 | mattpocock/skills (project-local `.agents/skills/`) |",
        "| 🟠 | codex (adversarial review gate) |",
        "| 🟣 | Other official plugins |",
        "| ⬜ | Built-in FleetView (no plugin required) |",
        "",
        "---",
        "",
        "## Invocation Types",
        "",
        "The **Trigger** column in each table tells you who fires the skill and how:",
        "",
        "| Trigger | Who invokes | How |",
        "|---|---|---|",
        "| `auto + /slash` | Claude **or** you | Claude fires it when context matches; you can also type `/skill-name` explicitly |",
        "| `/slash only` | You only | Must type `/skill-name` — Claude won't auto-fire (`disable-model-invocation: true` in SKILL.md) |",
        "| `auto only` | Claude only | Claude auto-fires only; cannot be user-invoked (`user-invocable: false` in SKILL.md) |",
        "| `/command` | You only | Explicit `/command-name` — commands are never auto-triggered by Claude |",
        "| `agent (Task tool)` | Claude only | Spawned as a subagent via Task tool — not directly invocable by the user |",
        "",
        "---",
        "",
    ]

    # ── superpowers ─────────────────────────────────────────────────────────────
    sp_ver    = plugin_version(SUPERPOWERS_ID, installed)
    sp_status = "✅" if is_enabled(SUPERPOWERS_ID) else "❌"
    sp_dir    = plugin_cache_dir(SUPERPOWERS_ID)

    lines += [
        f"## 🔵 superpowers — `{SUPERPOWERS_ID}` v{sp_ver} {sp_status}",
        "",
        "Core workflow skills for the gate-based dev process in `docs/dev-process.md`.",
        "",
    ]
    lines.extend(_table_header())
    lines.extend(skills_rows(sp_dir, SUPERPOWERS_ID))
    lines += ["", "---", ""]

    # ── mattpocock ──────────────────────────────────────────────────────────────
    lines += [
        "## 🟢 mattpocock/skills — project-local `.agents/skills/` ✅",
        "",
        "Discovery-mode TDD, domain stress-testing, and lightweight workflow utilities.",
        "Installed via `npx skills@latest add mattpocock/skills` — lives in `.agents/skills/`.",
        "",
    ]
    lines.extend(_table_header())

    local_count = 0
    if LOCAL_SKILLS.exists():
        for skill_md in sorted(LOCAL_SKILLS.rglob("SKILL.md")):
            name, desc = read_desc(skill_md)
            trigger = invocation_type(skill_md, "skill")
            lines.append(f"| **{name}** | `{name}` | {trigger} | {clip(desc)} |")
            local_count += 1
    if local_count == 0:
        lines.append("| *(no .agents/skills/ found)* | — | — | — |")

    lines += ["", "---", ""]

    # ── codex ───────────────────────────────────────────────────────────────────
    cx_ver    = plugin_version(CODEX_ID, installed)
    cx_status = "✅" if is_enabled(CODEX_ID) else "❌"
    cx_dir    = plugin_cache_dir(CODEX_ID)

    lines += [
        f"## 🟠 codex — `{CODEX_ID}` v{cx_ver} {cx_status}",
        "",
        "Adversarial review gate (required at every phase) plus internal Codex runtime helpers.",
        "Always use `--fresh` to start a clean session.",
        "",
    ]
    lines.extend(_table_header())
    # Prepend the two user-facing entry points (not backed by SKILL.md files)
    lines += [
        "| **setup** | `codex:setup` | `auto + /slash` | Check whether the local Codex CLI is ready; optionally toggle the stop-time review gate. |",
        "| **rescue** | `codex:rescue` | `auto + /slash` | **Primary adversarial review entry point.** Spec (Phase 1), plan (Phase 2), code (Phase 3). Always pass `--fresh`. |",
    ]
    lines.extend(skills_rows(cx_dir, CODEX_ID))
    lines += ["", "---", ""]

    # ── other enabled plugins ───────────────────────────────────────────────────
    if enabled_others:
        lines += ["## 🟣 Other Plugins — Enabled", ""]
        for pid in sorted(enabled_others):
            meta  = PLUGIN_META.get(pid, {})
            intro = meta.get("desc", "")
            plugin_section(lines, pid, installed, enabled=True, intro=intro)
        lines += ["---", ""]

    # ── built-in fleetview ──────────────────────────────────────────────────────
    lines += [
        "## ⬜ Built-in FleetView Skills",
        "",
        "Embedded in Claude Code itself — no plugin installation required.",
        "",
    ]
    lines.extend(_table_header())
    for name, invoke, trigger, desc in FLEETVIEW_SKILLS:
        lines.append(f"| **{name}** | {invoke} | {trigger} | {desc} |")
    lines += ["", "---", ""]

    # ── disabled plugins ────────────────────────────────────────────────────────
    if disabled_others:
        lines += [
            "## ❌ Disabled Plugins",
            "",
            "Installed but toggled off in `~/.claude/settings.json`.",
            "Skills are unavailable until re-enabled.",
            "",
            "| Plugin | Version | Re-enable |",
            "|---|---|---|",
        ]
        for pid in sorted(disabled_others):
            ver = plugin_version(pid, installed)
            meta = PLUGIN_META.get(pid, {})
            desc = meta.get("desc", "")
            note = f" — {desc}" if desc else ""
            lines.append(f"| `{pid}` | {ver}{note} | `/plugin enable {pid}` |")
        lines += ["", "---", ""]

    # ── routing table ───────────────────────────────────────────────────────────
    lines += [
        "## Project-Specific Skill Routing",
        "",
        "When multiple skills handle the same task, use this table (from `docs/plugins.md`):",
        "",
        "| Task | Condition | Skill |",
        "|---|---|---|",
    ]
    for task, condition, skill in ROUTING_TABLE:
        lines.append(f"| {task} | {condition} | {skill} |")
    lines.append("")

    return "\n".join(lines)


# ── entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    doc = build()
    OUTPUT.write_text(doc)

    # Stats
    installed = load_json(INSTALLED, {"plugins": {}})
    settings  = load_json(SETTINGS, {})
    enabled_map = settings.get("enabledPlugins", {})
    all_ids = list(installed.get("plugins", {}).keys())

    enabled_count  = sum(1 for p in all_ids if enabled_map.get(p, True))
    disabled_count = sum(1 for p in all_ids if not enabled_map.get(p, True))
    local_count    = sum(1 for _ in LOCAL_SKILLS.rglob("SKILL.md")) if LOCAL_SKILLS.exists() else 0

    print(f"✅  {OUTPUT}")
    print(f"   Installed plugins : {len(all_ids)}")
    print(f"   Enabled           : {enabled_count}")
    print(f"   Disabled          : {disabled_count}")
    print(f"   Local skills      : {local_count}  (.agents/skills/)")
