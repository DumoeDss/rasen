# CLI Reference

The rasen CLI (`rasen`) provides terminal commands for project setup, validation, status inspection, and management. These commands complement the AI slash commands (like `/rasen-propose`) documented in [Commands](commands.md).

## Summary

| Category | Commands | Purpose |
|----------|----------|---------|
| **Setup** | `init`, `update` | Initialize and update rasen in your project |
| **Stores (standalone rasen repos)** | `store setup`, `store register`, `store unregister`, `store remove`, `store list`, `store doctor` | Manage stores — standalone rasen repos you've registered |
| **Health** | `doctor` | Report relationship health for the resolved root |
| **Working context** | `context` | Assemble the working set (root + referenced stores) |
| **Personal worksets** | `workset create`, `workset list`, `workset open`, `workset remove` | Keep and open personal, local working views in your tool |
| **Browsing** | `list`, `view`, `show` | Explore changes and specs |
| **Validation** | `validate` | Check changes and specs for issues |
| **Lifecycle** | `archive` | Finalize completed changes |
| **Workflow** | `new change`, `status`, `instructions`, `templates`, `schemas` | Artifact-driven workflow support |
| **Workflow library** | `workflow list/show/which/init/validate/import/export/delete` | Manage user-wide installable workflows |
| **Schemas** | `schema init`, `schema fork`, `schema validate`, `schema which` | Create and manage custom workflows |
| **Config** | `profile`, `config` | Manage workflow profiles and other settings |
| **Utility** | `feedback`, `completion` | Feedback and shell integration |

---

## Human vs Agent Commands

Most CLI commands are designed for **human use** in a terminal. Some commands also support **agent/script use** via JSON output.

### Human-Only Commands

These commands are interactive and designed for terminal use:

| Command | Purpose |
|---------|---------|
| `rasen init` | Initialize project (interactive prompts) |
| `rasen view` | Interactive dashboard |
| `rasen workset open <name>` | Open a saved workset (editor window or terminal agent session) |
| `rasen config edit` | Open config in editor |
| `rasen feedback` | Submit feedback via GitHub |
| `rasen completion install` | Install shell completions |

### Agent-Compatible Commands

These commands support `--json` output for programmatic use by AI agents and scripts:

| Command | Human Use | Agent Use |
|---------|-----------|-----------|
| `rasen list` | Browse changes/specs | `--json` for structured data |
| `rasen show <item>` | Read content | `--json` for parsing |
| `rasen validate` | Check for issues | `--all --json` for bulk validation |
| `rasen status` | See artifact progress | `--json` for structured status |
| `rasen instructions` | Get next steps | `--json` for agent instructions |
| `rasen templates` | Find template paths | `--json` for path resolution |
| `rasen schemas` | List available schemas | `--json` for schema discovery |
| `rasen store setup <id>` | Create and register a local store | `--json` with explicit inputs for structured setup output |
| `rasen store register <path>` | Register an existing store | `--json` for structured registration output |
| `rasen store unregister <id>` | Forget a local store registration | `--json` for structured cleanup output |
| `rasen store remove <id>` | Delete a registered local store folder | `--yes --json` for non-interactive deletion |
| `rasen store list` | Browse registered stores | `--json` for structured registrations |
| `rasen store doctor` | Check local store setup | `--json` for structured diagnostics |
| `rasen new change <id>` | Create repo-local change scaffolding | `--json`, plus `--store <id>` to use a registered store as the Rasen root |
| `rasen workset create [name]` | Compose a personal working view | `--member <path> --json` for non-interactive composition |
| `rasen workset list` | Browse saved worksets | `--json` for structured views |
| `rasen workset remove <name>` | Delete a saved view | `--yes --json` for non-interactive removal |

---

## Global Options

These options work with all commands:

| Option | Description |
|--------|-------------|
| `--version`, `-V` | Show version number |
| `--no-color` | Disable color output |
| `--help`, `-h` | Display help for command |

---

## Setup Commands

### `rasen init`

Initialize rasen in your project. Creates the folder structure and configures AI tool integrations.

Default behavior uses global config defaults: profile `full` (every workflow), delivery `both`.

```
rasen init [path] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | No | Target directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--tools <list>` | Configure AI tools non-interactively. Use `all`, `none`, or comma-separated list |
| `--force` | Auto-cleanup legacy files without prompting |
| `--profile <profile>` | Override global profile for this init run (`full`, `core`, or `custom`) |

`--profile custom` uses whatever workflows are currently selected in global config (`rasen profile`).

**Supported tool IDs (`--tools`):** `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `codex`, `forgecode`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `lingma`, `vibe`, `opencode`, `pi`, `qoder`, `qwen`, `roocode`, `trae`, `windsurf`

> This list mirrors `AI_TOOLS` in `src/core/config.ts`. See [Supported Tools](supported-tools.md) for each tool's skill and command paths.

**Examples:**

```bash
# Interactive initialization
rasen init

# Initialize in a specific directory
rasen init ./my-project

# Non-interactive: configure for Claude and Cursor
rasen init --tools claude,cursor

# Configure for all supported tools
rasen init --tools all

# Override profile for this run
rasen init --profile core

# Skip prompts and auto-cleanup legacy files
rasen init --force
```

**What it creates:**

```
rasen/
├── specs/              # Your specifications (source of truth)
├── changes/            # Proposed changes
└── config.yaml         # Project configuration

.claude/skills/         # Claude Code skills (if claude selected)
.cursor/skills/         # Cursor skills (if cursor selected)
.cursor/commands/       # Cursor OPSX commands (if delivery is both)
... (other tool configs)
```

---

### `rasen update`

Update rasen instruction files after upgrading the CLI. Re-generates AI tool configuration files using your current global profile, selected workflows, and delivery mode.

```
rasen update [path] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | No | Target directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force update even when files are up to date |

**Example:**

```bash
# Update instruction files after npm upgrade
npm update @atelierai/rasen
rasen update
```

---

## Stores (standalone rasen repos)

> **Beta.** Stores and the features built on them (references, working context, worksets) are new; command names, flags, file formats, and JSON output may change shape between releases. For the problem-first walkthrough, see the [stores guide](stores-beta/user-guide.md).

A store is a standalone rasen repo you've registered on this machine — for example a planning repo or a contracts repo. Registering a store lets normal commands (`list`, `show`, `status`, `validate`, `new change`, `archive`, ...) act in it from anywhere by passing `--store <id>`.

### `rasen store setup`

Create and register a local store. With no arguments in a terminal,
Rasen guides the user through setup. Agents and scripts should pass explicit
inputs and use `--json`.

```bash
rasen store setup [id] [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--path <path>` | Folder where the store should live (for example `~/rasen/<id>`) |
| `--remote <url>` | Record the canonical remote in the new store's `store.yaml` |
| `--init-git` | Initialize a Git repository with an initial commit (default) |
| `--no-init-git` | Skip every Git action: no init, no initial commit |
| `--json` | Output JSON |

Non-interactive runs (`--json`, scripts, agents) must pass both the store id and `--path`. In an interactive terminal, setup prompts for the location with an editable suggestion in a visible, user-owned place (for example `~/rasen/<id>`); it never defaults to rasen's managed data directory.

Examples:

```bash
rasen store setup
rasen store setup team-context
rasen store setup team-context --path ~/rasen/team-context --no-init-git
rasen store setup team-context --path ~/rasen/team-context --no-init-git --json
```

### `rasen store register`

Register an existing local store folder.

```bash
rasen store register [path] [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--id <id>` | Store id; defaults to store metadata or folder name |
| `--yes` | Confirm creating store identity metadata for a healthy Rasen root |
| `--json` | Output JSON |

### `rasen store unregister`

Forget a local store registration without deleting files.

```bash
rasen store unregister <id> [--json]
```

Use this when a store was moved, cloned somewhere else, or should no longer be
shown by rasen on this machine.

### `rasen store remove`

Forget a local store registration and delete its local folder.

```bash
rasen store remove <id> [--yes] [--json]
```

`remove` shows the exact folder before deleting in an interactive terminal.
Agents, scripts, and JSON callers must pass `--yes` to confirm deletion.
Rasen refuses to delete a folder that does not contain matching
store metadata.

### `rasen store list`

List locally registered stores.

```bash
rasen store list [--json]
rasen store ls [--json]
```

### `rasen store doctor`

Check local store registration, metadata, and Git presence.

```bash
rasen store doctor [id] [--json]
```

Doctor is diagnostic-only; it reports missing roots, metadata mismatches, and invalid local registry state without modifying the store.

### Referencing stores from a project

A project repo can declare which stores its work draws on in `rasen/config.yaml`:

```yaml
schema: spec-driven
references:
  - team-context
```

From then on, `rasen instructions` output in that repo (both the per-artifact and `apply` surfaces, JSON and human modes) carries an index of each referenced store's specs — spec ids, a one-line summary from each spec's Purpose section, and the fetch command (`rasen show <spec-id> --type spec --store <id>`). The index is built live from the registered checkout on every run; spec content is never copied into the output.

References are read-only context. They never change where commands act: work stays in the repo's own root, and writing to a referenced store remains an explicit `--store` action. A reference that cannot be resolved (for example, a store not registered on this machine) degrades to a warning in the index with the exact fix, and instructions still generate. `rasen doctor` reports reference health in one place.

### Recording where a store is cloned from

A store can record its canonical clone source in its committed identity file, so onboarding never dead-ends at "register the store":

```bash
rasen store setup team-context --path ~/rasen/team-context \
  --remote git@github.com:acme/team-context.git
```

The remote lands in `.rasen-store/store.yaml` inside the initial commit, so every clone is born knowing it. For an existing store, edit `store.yaml` by hand and commit. `store doctor` shows the recorded remote (and the checkout's observed Git origin); setup/register sharing guidance names it; and register records the checkout's origin in the machine-local registry.

A reference declaration can carry the clone source too, so a teammate who doesn't have the store yet gets a complete, pasteable fix (`git clone <remote> <path> && rasen store register <path> --id <id>`):

```yaml
references:
  - { id: team-context, remote: "git@github.com:acme/team-context.git" }
```

Recording a remote is not sync: rasen never clones, pulls, or pushes on its own.

### Declaring a default store

A repo whose planning is fully externalized — no local `rasen/specs/` or `rasen/changes/` — can declare its store once instead of passing `--store` on every command:

```yaml
# rasen/config.yaml (the only file under rasen/)
store: team-context
```

Normal commands then resolve to the declared store automatically; the root banner and JSON `root` block report `source: "declared"` with the store id, and printed hints still carry `--store <id>`. The declaration is a fallback, never an override: explicit `--store` always wins, and a directory with real planning folders ignores the pointer (with a warning). To convert a pointer repo into a local Rasen root, remove the `store:` line and run `rasen init` — init refuses to scaffold while the declaration is present.

## Doctor (relationship health)

One read-only question, one place: is the Rasen root healthy, and are the stores it references available on this machine?

```bash
rasen doctor [--store <id>] [--json]
```

The report separates root health, store metadata health (including a note when the recorded remote and the checkout's origin diverge), and reference health (the same diagnostics instructions show, with clone fixes for unresolved references). Health findings of any severity exit 0 — agents read the `status` arrays; only command failures (no root, unknown store) exit 1. Doctor never clones, syncs, or repairs. To get the assembled set itself rather than its health, use `rasen context`.

## Working context (the assembled set)

Everything this work relates to through rasen declarations, in one working set: the Rasen root and the stores it references.

```bash
rasen context [--store <id>] [--json] [--code-workspace <path> [--force]]
```

The JSON brief is agent-consumable (each available referenced store carries its fetch recipe; unresolved members carry the same fixes instructions and doctor show). `--code-workspace` additionally writes a VS Code workspace file containing the root plus the available referenced stores (`ref:<id>` folders) — the one write this command performs, refused without `--force` if the file exists. Unavailable members are reported, never guessed at.

"Working context" is the assembled set; the `context:` field in `rasen/config.yaml` is project background injected into instructions — two different things. `rasen doctor` answers whether the set is healthy; `rasen context` answers what the set is.

## Personal worksets

> **Beta.** Worksets are part of the new beta surface; commands, flags, and file formats may change shape between releases. For the walkthrough, see the [stores guide](stores-beta/user-guide.md#worksets-reopen-the-folders-you-work-on-together).

A workset is a personal, named view of the folders you work on together — a planning root plus whatever else you choose — kept on your machine and reopened by name in your tool. It is purely local: never committed, never shared, never derived from declarations, and removing one never touches a member folder.

```bash
rasen workset create [name] [--member <path> | --member <name>=<path>]... [--tool <id>] [--json]
rasen workset list [--json]
rasen workset open <name> [--tool <id>]
rasen workset remove <name> [--yes] [--json]
```

`create` runs a short guided flow (or takes `--member` flags non-interactively; the first member is the primary — sessions start there). `open` launches the chosen tool: editors (VS Code, Cursor) open a window with every member and return; CLI agents (Claude Code, codex) take over this terminal as a session with every member attached and no prompt pre-filled, ending when you exit. A member folder missing at open time is skipped with a note; the rest opens. The saved tool preference is overridable per open with `--tool`.

Supporting a new tool is configuration, not code. Every tool is one of two launch styles — `workspace-file` (launched with the generated `.code-workspace`) or `attach-dirs` (one attach flag per member) — and the `openers` key in the global `config.json` (open it with `rasen config edit`) adds tools or adjusts built-ins per field:

```json
{
  "openers": {
    "zed": { "style": "workspace-file" },
    "claude": { "attach_flag": "--dir" }
  }
}
```

All workset state lives under the global data dir's `worksets/` folder (the saved views plus the generated `<name>.code-workspace` files, regenerated on every open); deleting that folder removes every trace.

> **Machine data location:** the global data dir (worksets, the store registry, the project registry, user schemas/pipelines) and the global config dir (`config.json`) both default to `~/.rasen` on every platform. Set `RASEN_HOME` to relocate both to one custom directory; `XDG_DATA_HOME`/`XDG_CONFIG_HOME` are still honored below `RASEN_HOME` as compatibility aliases. Data found at the old per-platform locations is adopted into `~/.rasen` automatically and losslessly on first run after upgrading.

---

## Browsing Commands

### `rasen list`

List changes or specs in your project.

```
rasen list [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--specs` | List specs instead of changes |
| `--changes` | List changes (default) |
| `--sort <order>` | Sort by `recent` (default) or `name` |
| `--json` | Output as JSON |

**Examples:**

```bash
# List all active changes
rasen list

# List all specs
rasen list --specs

# JSON output for scripts
rasen list --json
```

**Output (text):**

```
Changes:
  add-dark-mode     No tasks      just now
```

---

### `rasen view`

Display an interactive dashboard for exploring specs and changes.

```
rasen view
```

Opens a terminal-based interface for navigating your project's specifications and changes.

---

### `rasen show`

Display details of a change or spec.

```
rasen show [item-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `item-name` | No | Name of change or spec (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--type <type>` | Specify type: `change` or `spec` (auto-detected if unambiguous) |
| `--json` | Output as JSON |
| `--no-interactive` | Disable prompts |

**Change-specific options:**

| Option | Description |
|--------|-------------|
| `--deltas-only` | Show only delta specs (JSON mode) |

**Spec-specific options:**

| Option | Description |
|--------|-------------|
| `--requirements` | Show only requirements, exclude scenarios (JSON mode) |
| `--no-scenarios` | Exclude scenario content (JSON mode) |
| `-r, --requirement <id>` | Show specific requirement by 1-based index (JSON mode) |

**Examples:**

```bash
# Interactive selection
rasen show

# Show a specific change
rasen show add-dark-mode

# Show a specific spec
rasen show auth --type spec

# JSON output for parsing
rasen show add-dark-mode --json
```

---

## Validation Commands

### `rasen validate`

Validate changes and specs for structural issues.

```
rasen validate [item-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `item-name` | No | Specific item to validate (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--all` | Validate all changes and specs |
| `--changes` | Validate all changes |
| `--specs` | Validate all specs |
| `--type <type>` | Specify type when name is ambiguous: `change` or `spec` |
| `--strict` | Enable strict validation mode |
| `--json` | Output as JSON |
| `--concurrency <n>` | Max parallel validations (default: 6, or `RASEN_CONCURRENCY` env) |
| `--no-interactive` | Disable prompts |

**Examples:**

```bash
# Interactive validation
rasen validate

# Validate a specific change
rasen validate add-dark-mode

# Validate all changes
rasen validate --changes

# Validate everything with JSON output (for CI/scripts)
rasen validate --all --json

# Strict validation with increased parallelism
rasen validate --all --strict --concurrency 12
```

**Output (text):**

```
Validating add-dark-mode...
  ✓ proposal.md valid
  ✓ specs/ui/spec.md valid
  ⚠ design.md: missing "Technical Approach" section

1 warning found
```

**Output (JSON):**

```json
{
  "version": "1.0.0",
  "results": {
    "changes": [
      {
        "name": "add-dark-mode",
        "valid": true,
        "warnings": ["design.md: missing 'Technical Approach' section"]
      }
    ]
  },
  "summary": {
    "total": 1,
    "valid": 1,
    "invalid": 0
  }
}
```

---

## Lifecycle Commands

### `rasen archive`

Archive a completed change and merge delta specs into main specs.

```
rasen archive [change-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Change to archive (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompts |
| `--skip-specs` | Skip spec updates (for infrastructure/tooling/doc-only changes) |
| `--no-validate` | Skip validation (requires confirmation) |

**Examples:**

```bash
# Interactive archive
rasen archive

# Archive specific change
rasen archive add-dark-mode

# Archive without prompts (CI/scripts)
rasen archive add-dark-mode --yes

# Archive a tooling change that doesn't affect specs
rasen archive update-ci-config --skip-specs
```

**What it does:**

1. Validates the change (unless `--no-validate`)
2. Prompts for confirmation (unless `--yes`)
3. Merges delta specs into `rasen/specs/`
4. Moves change folder to `rasen/changes/archive/YYYY-MM-DD-<name>/`

---

## Workflow Commands

These commands support the artifact-driven OPSX workflow. They're useful for both humans checking progress and agents determining next steps.

### `rasen new change`

Create a change directory and optional checked-in metadata in the resolved Rasen root.

```bash
rasen new change <name> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--description <text>` | Description to add to `README.md` |
| `--goal <text>` | Optional goal metadata to store with the change |
| `--schema <name>` | Workflow schema to use |
| `--store <id>` | Store id to use as the Rasen root (a store is a standalone rasen repo you've registered) |
| `--json` | Output JSON |

Examples:

```bash
rasen new change add-billing-api
rasen new change add-billing-api --store team-context --json
```

### `rasen status`

Display artifact completion status for a change.

```
rasen status [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--change <id>` | Change name (prompts if omitted) |
| `--schema <name>` | Schema override (auto-detected from change's config) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Interactive status check
rasen status

# Status for specific change
rasen status --change add-dark-mode

# JSON for agent use
rasen status --change add-dark-mode --json
```

**Output (text):**

```
Change: add-dark-mode
Schema: spec-driven
Progress: 2/4 artifacts complete

[x] proposal
[ ] design
[x] specs
[-] tasks (blocked by: design)
```

**Output (JSON):**

```json
{
  "changeName": "add-dark-mode",
  "schemaName": "spec-driven",
  "isComplete": false,
  "applyRequires": ["tasks"],
  "artifacts": [
    {"id": "proposal", "outputPath": "proposal.md", "status": "done"},
    {"id": "design", "outputPath": "design.md", "status": "ready"},
    {"id": "specs", "outputPath": "specs/**/*.md", "status": "done"},
    {"id": "tasks", "outputPath": "tasks.md", "status": "blocked", "missingDeps": ["design"]}
  ]
}
```

---

### `rasen instructions`

Get enriched instructions for creating an artifact or applying tasks. Used by AI agents to understand what to create next.

```
rasen instructions [artifact] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `artifact` | No | Artifact ID: `proposal`, `specs`, `design`, `tasks`, or `apply` |

**Options:**

| Option | Description |
|--------|-------------|
| `--change <id>` | Change name (required in non-interactive mode) |
| `--schema <name>` | Schema override |
| `--json` | Output as JSON |

**Special case:** Use `apply` as the artifact to get task implementation instructions.

**Examples:**

```bash
# Get instructions for next artifact
rasen instructions --change add-dark-mode

# Get specific artifact instructions
rasen instructions design --change add-dark-mode

# Get apply/implementation instructions
rasen instructions apply --change add-dark-mode

# JSON for agent consumption
rasen instructions design --change add-dark-mode --json
```

**Output includes:**

- Template content for the artifact
- Project context from config
- Content from dependency artifacts
- Per-artifact rules from config

---

### `rasen templates`

Show resolved template paths for all artifacts in a schema.

```
rasen templates [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--schema <name>` | Schema to inspect (default: `spec-driven`) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Show template paths for default schema
rasen templates

# Show templates for custom schema
rasen templates --schema my-workflow

# JSON for programmatic use
rasen templates --json
```

**Output (text):**

```
Schema: spec-driven

Templates:
  proposal  → ~/.rasen/schemas/spec-driven/templates/proposal.md
  specs     → ~/.rasen/schemas/spec-driven/templates/specs.md
  design    → ~/.rasen/schemas/spec-driven/templates/design.md
  tasks     → ~/.rasen/schemas/spec-driven/templates/tasks.md
```

---

### `rasen schemas`

List available workflow schemas with their descriptions and artifact flows.

```
rasen schemas [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Example:**

```bash
rasen schemas
```

**Output:**

```
Available schemas:

  spec-driven (package)
    The default spec-driven development workflow
    Flow: proposal → specs → design → tasks

  my-custom (project)
    Custom workflow for this project
    Flow: research → proposal → tasks
```

---

## Schema Commands

Commands for creating and managing custom workflow schemas.

### `rasen schema init`

Create a new project-local schema.

```
rasen schema init <name> [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Schema name (kebab-case) |

**Options:**

| Option | Description |
|--------|-------------|
| `--description <text>` | Schema description |
| `--artifacts <list>` | Comma-separated artifact IDs (default: `proposal,specs,design,tasks`) |
| `--default` | Set as project default schema |
| `--no-default` | Don't prompt to set as default |
| `--force` | Overwrite existing schema |
| `--json` | Output as JSON |

**Examples:**

```bash
# Interactive schema creation
rasen schema init research-first

# Non-interactive with specific artifacts
rasen schema init rapid \
  --description "Rapid iteration workflow" \
  --artifacts "proposal,tasks" \
  --default
```

**What it creates:**

```
rasen/schemas/<name>/
├── schema.yaml           # Schema definition
└── templates/
    ├── proposal.md       # Template for each artifact
    ├── specs.md
    ├── design.md
    └── tasks.md
```

---

### `rasen schema fork`

Copy an existing schema to your project for customization.

```
rasen schema fork <source> [name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `source` | Yes | Schema to copy |
| `name` | No | New schema name (default: `<source>-custom`) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Overwrite existing destination |
| `--json` | Output as JSON |

**Example:**

```bash
# Fork the built-in spec-driven schema
rasen schema fork spec-driven my-workflow
```

---

### `rasen schema validate`

Validate a schema's structure and templates.

```
rasen schema validate [name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | No | Schema to validate (validates all if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `--verbose` | Show detailed validation steps |
| `--json` | Output as JSON |

**Example:**

```bash
# Validate a specific schema
rasen schema validate my-workflow

# Validate all schemas
rasen schema validate
```

---

### `rasen schema which`

Show where a schema resolves from (useful for debugging precedence).

```
rasen schema which [name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | No | Schema name |

**Options:**

| Option | Description |
|--------|-------------|
| `--all` | List all schemas with their sources |
| `--json` | Output as JSON |

**Example:**

```bash
# Check where a schema comes from
rasen schema which spec-driven
```

**Output:**

```
spec-driven resolves from: package
  Source: /usr/local/lib/node_modules/@atelierai/rasen/schemas/spec-driven
```

**Schema precedence:**

1. Project: `rasen/schemas/<name>/`
2. User: `~/.rasen/schemas/<name>/` (or `$RASEN_HOME/schemas/<name>/` when set)
3. Package: Built-in schemas

---

## Configuration Commands

### `rasen profile`

Edit the current workflow selection or manage reusable named profile snapshots. Profile changes update global configuration; run `rasen update` in each project to install the selected workflows.

```
rasen profile
rasen profile new [name]
rasen profile use [name]
rasen profile list [--json]
rasen profile delete [name] [--yes]
rasen profile import <path> [--as <name>] [--force]
rasen profile export <path> [--profile <name>] [--thin] [--force]
```

| Subcommand | Description |
|------------|-------------|
| _(none)_ | Edit the current delivery mode and workflow selection interactively |
| `new [name]` | Create, save, and use a named profile; prompts for the name when omitted |
| `use [name]` | Use a built-in or saved profile; opens a picker when omitted |
| `list` | List built-in and saved profiles; add `--json` for structured output |
| `delete [name]` | Delete a saved profile; add `--yes` to skip confirmation |
| `import <path>` | Import a self-contained `.rasenpkg`, YAML, or JSON profile; package `name` is authoritative unless `--as` is supplied, and `--force` replaces only the profile snapshot |
| `export <path>` | Export current settings or the profile selected by `--profile`; profiles with user workflows default to self-contained `.rasenpkg`, while YAML/JSON requires explicit `--thin` |

Named profiles are saved snapshots. Using one copies its delivery and workflows into global configuration, where `profile` remains the effective classification (`full`, `core`, or `custom`) rather than the saved profile name. The saved name is retained by its file in the machine-global profiles directory.

Self-contained profile packages embed selected user workflows and their user-workflow dependency closure. Built-in workflows remain references. Import reuses an installed workflow only when its digest is identical; a different digest is an error even with `--force`. Thin YAML/JSON import requires every referenced user workflow to be installed already and writes nothing when membership validation fails.

When `new` prompts for a name, invalid, reserved, and existing names show an inline error so another name can be entered. An invalid name supplied directly as `new <name>` fails without opening the remaining prompts.

In the workflow checklist, press `Space` to toggle one workflow, `A` to select all workflows or clear all when every workflow is already selected, and `Enter` to confirm.

Profile prompts, CLI help, the interactive config editor, and shell-completion descriptions and management messages are available in English, Japanese, and Simplified Chinese. The selected language is stored using the canonical `language: "auto" | "en" | "ja" | "zh-cn"` values in the machine-global JSON config. Set it with `rasen config set language en`, `rasen config set language ja`, or `rasen config set language zh-cn`.

The workflow picker shows the stable public workflow id before the localized name, with the separator aligned across rows (for example, `propose - 変更を提案`). Tool-specific slash punctuation is intentionally omitted because assistants may expose the same workflow as `/rasen-propose`, `/rasen-propose`, or a skill.

With `language: "auto"` (the default), Unix-like systems check `LC_ALL`, `LC_MESSAGES`, and `LANG`, then fall back to the runtime's system locale. Windows uses the system locale reported by Node.js. The aliases `zh-CN`, `zh_CN.UTF-8`, `zh-SG`, `zh-Hans`, and bare `zh` resolve to `zh-cn`. Traditional Chinese locales `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant` are unsupported and fall back to English, as do other unsupported automatic locales. `RASEN_LANG=en`, `RASEN_LANG=ja`, or `RASEN_LANG=zh-cn` temporarily overrides the saved setting. Reinstall or regenerate shell completions after changing the saved language so generated descriptions are refreshed.

Translation catalogs are maintained as `src/locales/en.json`, `src/locales/ja.json`, and `src/locales/zh-cn.json`. The build copies them to `dist/locales/`, which is included in the published package. All three catalogs use the same keys and placeholders.

`rasen config profile [full|core]` remains available as a compatibility entry point, but `rasen profile` is the canonical command.

### `rasen workflow`

Manage installable workflows in the machine-wide user library. These commands operate on workflow definitions, not artifact schemas or orchestration pipelines.

```text
rasen workflow list [--unused] [--all] [--json]
rasen workflow show <id> [--json]
rasen workflow which <id> [--json]
rasen workflow init <id> --output <path> [--json]
rasen workflow validate <id-or-path> [--json]
rasen workflow import <path> [--json]
rasen workflow export <id> <path> [--force] [--json]
rasen workflow delete <id> [--yes] [--json]
```

| Subcommand | Description |
|------------|-------------|
| `list` | List valid built-in/user definitions plus invalid user entries, grouped by kind; `--unused` is advisory and only considers detectable consumers; `--all` also reveals the internal group |
| `show <id>` | Show identity, skill/command metadata, dependencies, files, digest, and known usage |
| `which <id>` | Show whether an ID resolves from the built-in catalog or a user directory |
| `init <id>` | Create a minimal draft in the required empty `--output` directory without installing it |
| `validate <id-or-path>` | Statically validate an installed ID, unpacked draft, or strict `.rasenpkg` without executing scripts or writing the registry |
| `import <path>` | Validate, stage, revalidate, and atomically install an unpacked workflow or `kind: workflow` package |
| `export <id> <path>` | Export a user workflow and its required user-workflow closure as deterministic `.rasenpkg`; built-ins cannot be exported |
| `delete <id>` | Delete an unreferenced user workflow after usage preflight and confirmation; built-ins cannot be deleted |

Every JSON success payload includes `status: []`. Failures emit one JSON document whose `status` entries carry stable `severity`, `code`, and `message` fields. For example:

```json
{
  "workflow": null,
  "usage": [],
  "status": [
    {
      "severity": "error",
      "code": "workflow_not_found",
      "message": "Workflow \"missing\" was not found"
    }
  ]
}
```

`delete` scans global selection, saved profiles, reverse dependencies, user/current-project pipelines, and the current project's managed-artifact ledger. It cannot prove that no unknown project elsewhere references the workflow, so successful deletion still prints that limitation. See [Installable workflows and `.rasenpkg`](workflow-packages.md) for the manifest, package, digest, path, and resource-limit contracts.

**Kind classification**: every workflow definition carries a `kind` — `task` (an inner-loop operation invoked directly), `driver` (an outer-loop engine that consumes pipelines, e.g. `auto-command`/`goal-command`), or `internal` (a sub-unit invoked only by a driver, e.g. the `goal-plan`/`goal-iterate`/`goal-report` trio). The human `list` table groups entries into `task` and `driver` sections and hides `internal` unless `--all` is passed. `--json` always lists every workflow, ungrouped, with its `kind` — machine consumers see the full catalog regardless of `--all`. A user workflow's `workflow.yaml` defaults to `kind: task` and may optionally declare `kind: internal`; `driver` is reserved for built-in engines. `kind` is presentation metadata only — it never enters a workflow's digest, so classifying or reclassifying a workflow never triggers drift-healing.

### `rasen pipeline`

Inspect, package, install, and remove orchestration pipelines — the outer-loop DAGs that sequence workflows (see [Concepts](concepts.md) for the schema/workflow/pipeline model). Pipelines resolve from three layers, highest precedence first: project (`rasen/pipelines/<name>/pipeline.yaml`), user (installed via `import`, machine-global), and package (built-in, shipped with rasen).

```text
rasen pipeline list [--json]
rasen pipeline show <name> [--for-execution] [--json]
rasen pipeline agents <name> [--planner|--implementer|--reviewer|--fixer|--shipper <runtime>] [--json]
rasen pipeline classify <task> [--json]
rasen pipeline resume <change> [--json]
rasen pipeline init <name> --output <path> [--json]
rasen pipeline validate <name-or-path> [--json]
rasen pipeline import <path> [--force] [--json]
rasen pipeline export <name> <path> [--force] [--json]
rasen pipeline delete <name> [--yes] [--force] [--json]
```

All ten subcommands accept `--store <id>` / `--project <id>`, resolving their root exactly like `rasen validate`.

Pipeline help and Rasen-owned human output for all ten subcommands are available in English, Japanese, and Simplified Chinese. Localization changes presentation only: pipeline and stage IDs, role/runtime/source values, paths, JSON fields and raw descriptions, classifier keywords and results, and user-authored names and descriptions remain locale-neutral. Package-owned built-in descriptions are localized in human views while their JSON values remain raw.

| Subcommand | Description |
|------------|-------------|
| `list` | List available pipelines (project > user > package) with description and stage ids |
| `show <name>` | Show a pipeline's stage DAG, build order, and resolved per-stage runtime/handoff/reuse config; `--for-execution` also validates active-profile skills |
| `agents <name>` | Show, or set (writing a project-local override), per-role Claude/Codex runtimes |
| `classify <task>` | Suggest a pipeline for a task string via an advisory keyword heuristic |
| `resume <change>` | Show a change's (or portfolio's) next/remaining stages from its run-state |
| `init <name>` | Create a minimal `pipeline.yaml` draft in the required empty `--output` directory without installing it |
| `validate <name-or-path>` | Structurally validate an installed pipeline name, a draft directory, or a `kind: pipeline` `.rasenpkg` — parse, duplicate/cycle/parallel-group/decompose-stage checks; does not require referenced skills to already be installed |
| `import <path>` | Validate, stage, digest-reverify, and atomically install every pipeline in a `kind: pipeline` `.rasenpkg` into the user layer; `--force` allows overwriting an already-installed pipeline of the same name |
| `export <name> <path>` | Package an installed **user** pipeline as a deterministic `.rasenpkg`; built-in and project-local pipelines cannot be exported |
| `delete <name>` | Delete an unreferenced user pipeline after a refcount check; built-in pipelines cannot be deleted |

`.rasenpkg` files carry a `kind` discriminant — `workflow`, `profile`, or `pipeline` — sharing one package format. A `kind: pipeline` package's digest, transactional install (temp stage → atomic rename, all-or-nothing across every packaged pipeline), and file-limit rules mirror the `kind: workflow` contract in [Installable workflows and `.rasenpkg`](workflow-packages.md). Every package also carries an optional `minRasenVersion`, stamped from the packing CLI's own version: an older CLI importing a package that requires a newer one gets a clear upgrade message instead of an opaque schema error. This preflight only helps CLIs from this point forward — an already-shipped CLI predating this field still rejects an unrecognized package `kind` opaquely; there is no way to retrofit that.

`delete`'s refcount guard refuses to delete a pipeline referenced by any installed workflow's `requires.pipelines` or by another pipeline's `decompose` stage `childPipeline` (explicit or the `small-feature` default), naming every referrer; `--force` bypasses the guard (not the built-in-pipeline prohibition) and warns about the referrers left dangling.

Pipeline stage `skill:` fields in the built-in pipelines use the workflow directory-name form (`rasen-propose`, `rasen-review`); `validate` and package import also accept the retired skill-name colon form (`rasen:review`) for backward compatibility, and do not require the skill to be installed at import time — a missing skill is caught at execution time instead.

### `rasen config`

View and modify global or project rasen configuration. Every subcommand accepts `--scope <global|project>` (default `global`); `--scope project` reads and writes the current project's `rasen/config.yaml` instead of the global config file. Running `rasen config` with no subcommand opens an interactive full-view editor (in a TTY) showing every configurable key, its effective value, and which layer produced it (`default`, `global`, `project`, or `env-override`); outside a TTY it prints that same effective view non-interactively and exits.

```
rasen config <subcommand> [options]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `path` | Show config file location |
| `list` | Show all current settings |
| `get <key>` | Get a specific value |
| `set <key> <value>` | Set a value (validated against the config-key registry) |
| `unset <key>` | Remove a key |
| `reset` | Reset to defaults (global scope only) |
| `edit` | Open in `$EDITOR` (global scope only) |
| `profile [preset]` | Compatibility entry point for `rasen profile` or `rasen profile use <preset>` |

**Configurable keys** (see `rasen config` with no arguments for the full list with current values):

| Key | Scope | Description |
|-----|-------|-------------|
| `profile`, `delivery`, `workflows` | global | Workflow profile (use `rasen profile` to edit) |
| `language` | global | CLI display language: `auto`, `en`, `ja`, or `zh-cn` |
| `featureFlags.<name>` | global | Feature flag toggle |
| `proactive` | global | Whether agents proactively suggest next steps |
| `repoMode` | global | `solo` or `collaborative` |
| `telemetry.enabled` | global | Telemetry on/off (environment opt-outs always win) |
| `handoff.threshold` | global, project | Context-handoff threshold; project wins over global. Dual-form: a fraction in `(0, 1]`, or the absolute `{ remainingTokens: N }` headroom form (a positive integer token count) |
| `schema` | project | The workflow schema this project uses |
| `autopilot.gates` | project | Default autopilot gate policy (`on`/`off`) |
| `autopilot.selection` | project | Default autopilot pipeline-selection policy |
| `archive.timing`, `archive.destination` | project | Archive behavior |

**Examples:**

```bash
# Show config file path
rasen config path

# List all settings
rasen config list

# Get a specific value
rasen config get telemetry.enabled

# Set a value
rasen config set telemetry.enabled false

# Persist Japanese CLI prompts and help
rasen config set language ja

# Persist Simplified Chinese CLI prompts and help
rasen config set language zh-cn

# Set a string value explicitly
rasen config set featureFlags.myFlag "custom" --string

# Set a dual-form threshold: a fraction, or the absolute { remainingTokens: N } headroom form
rasen config set handoff.threshold 0.6
rasen config set --scope global handoff.threshold '{"remainingTokens": 60000}'

# Remove a custom setting
rasen config unset handoff.threshold

# Project-scope config (writes rasen/config.yaml, preserving comments)
rasen config set --scope project autopilot.gates off
rasen config get --scope project autopilot.gates
rasen config list --scope project

# Reset all configuration
rasen config reset --all --yes

# Edit config in your editor
rasen config edit

# Open the interactive full-view editor
rasen config

# Configure profile with action-based wizard
rasen profile

# Fast preset: switch workflows to core (keeps delivery mode)
rasen profile use core
```

`rasen profile` starts with a current-state summary, then lets you choose:
- Change delivery + workflows
- Change delivery only
- Change workflows only
- Keep current settings (exit)

If you keep current settings, no changes are written and no update prompt is shown.
If there are no config changes but the current project files are out of sync with your global profile/delivery, rasen will show a warning and suggest `rasen update`.
Pressing `Ctrl+C` also cancels the flow cleanly (no stack trace) and exits with code `130`.
In the workflow checklist, `[x]` means the workflow is selected in global config. Press `A` to select all, or press it again when everything is selected to clear all. To apply those selections to project files, run `rasen update` (or choose `Apply changes to this project now?` when prompted inside a project).

**Interactive examples:**

```bash
# Delivery-only update
rasen profile
# choose: Change delivery only
# choose delivery: Skills only

# Workflows-only update
rasen profile
# choose: Change workflows only
# toggle workflows in the checklist, then confirm
```

---

## Utility Commands

### `rasen feedback`

Submit feedback about rasen. Creates a GitHub issue.

```
rasen feedback <message> [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `message` | Yes | Feedback message |

**Options:**

| Option | Description |
|--------|-------------|
| `--body <text>` | Detailed description |

**Requirements:** GitHub CLI (`gh`) must be installed and authenticated.

**Example:**

```bash
rasen feedback "Add support for custom artifact types" \
  --body "I'd like to define my own artifact types beyond the built-in ones."
```

---

### `rasen completion`

Manage shell completions for the rasen CLI.

```
rasen completion <subcommand> [shell]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `generate [shell]` | Output completion script to stdout |
| `install [shell]` | Install completion for your shell |
| `uninstall [shell]` | Remove installed completions |

**Supported shells:** `bash`, `zsh`, `fish`, `powershell`

**Examples:**

```bash
# Install completions (auto-detects shell)
rasen completion install

# Install for specific shell
rasen completion install zsh

# Generate script for manual installation
rasen completion generate bash > ~/.bash_completion.d/rasen

# Uninstall
rasen completion uninstall
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (validation failure, missing files, etc.) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `RASEN_TELEMETRY` | Set to `0` to disable telemetry |
| `DO_NOT_TRACK` | Set to `1` to disable telemetry (standard DNT signal) |
| `RASEN_CONCURRENCY` | Default concurrency for bulk validation (default: 6) |
| `RASEN_LANG` | Temporarily override the saved CLI language (`en`, `ja`, or `zh-cn`) |
| `EDITOR` or `VISUAL` | Editor for `rasen config edit` |
| `NO_COLOR` | Disable color output when set |

---

## Related Documentation

- [Commands](commands.md) - AI slash commands (`/rasen-propose`, `/rasen-apply-change`, etc.)
- [Workflows](workflows.md) - Common patterns and when to use each command
- [Customization](customization.md) - Create custom schemas and templates
- [Getting Started](getting-started.md) - First-time setup guide
