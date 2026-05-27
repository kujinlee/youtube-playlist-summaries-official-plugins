---
name: sync-docs
description: Use when plugins, skills, or commands have changed and the project docs need updating — after /plugin install, /plugin update, /plugin enable/disable, adding files to .claude/commands/, or running npx skills add/remove. Also triggers on "update docs", "sync docs", "update skills reference", "regenerate available-skills".
---

# Sync Docs

Regenerate `docs/available-skills.md` and surface any gaps that need manual attention.

## Steps

**1. Run the generator**

```bash
python3 scripts/regen-skills-doc.py
```

**2. Check for undescribed plugins**

Open `scripts/regen-skills-doc.py` and compare the `PLUGIN_META` dict against the
installed plugin IDs in `~/.claude/plugins/installed_plugins.json`. Report any plugin
IDs that have no entry in `PLUGIN_META` — these render without a label or description
in the doc. Ask the user for a one-line description before adding them.

**3. Show what changed**

```bash
git diff docs/available-skills.md scripts/regen-skills-doc.py
```

If the diff is empty, tell the user the docs are already up to date.

**4. Offer to commit**

If there are changes, ask whether to commit. Suggested message:

```
docs: regenerate available-skills.md

Run python3 scripts/regen-skills-doc.py to update after plugin changes.
```

Stage only `docs/available-skills.md` and `scripts/regen-skills-doc.py` unless the
user explicitly says other files changed.

## What stays manual

These docs only need updating when the project *workflow* changes — not on every
plugin install:

| Doc | Update when |
|---|---|
| `docs/plugins.md` | A plugin is added to or removed from the *required* list |
| `docs/dev-process.md` | The gate-based workflow itself changes |
| `README.md` | The project structure or setup steps change significantly |
| `PLUGIN_META` in `scripts/regen-skills-doc.py` | A newly installed plugin has no human-readable label/description |

## Quick reference

| What changed | Action |
|---|---|
| `/plugin install` / `/plugin update` | Run generator; check PLUGIN_META for new entry |
| `/plugin enable` or `/plugin disable` | Run generator only (no PLUGIN_META change needed) |
| New `.claude/commands/*.md` file | Run generator only (auto-detected) |
| `npx skills@latest add/remove` | Run generator only (auto-detected from `.agents/skills/`) |
| New plugin needs a description | Edit `PLUGIN_META` in script, then run generator |
