# CLI Reference

The rasen CLI (`rasen`) provides terminal commands for project setup, validation, status inspection, and management. These commands complement the AI slash commands (like `/rasen-propose`) documented in [Commands](commands.md).

## Summary

| Category | Commands | Purpose |
|----------|----------|---------|
| **Setup** | `init`, `update` | Initialize and update rasen in your project |
| **Stores (standalone rasen repos)** | `store setup`, `store register`, `store upgrade-identity`, `store unregister`, `store remove`, `store list`, `store doctor` | Manage stores — standalone rasen repos you've registered |
| **Store membership** | `store add-project`, `store adopt`, `store eject`, `store migrate-membership` | Manage which projects belong to a store, and their planning content |
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
| `rasen store upgrade-identity <id>` | Give a store a permanent identity | `--apply --json`; previews by default |
| `rasen store unregister <id>` | Forget a local store registration | `--json` for structured cleanup output |
| `rasen store remove <id>` | Delete a registered local store folder | `--yes --json` for non-interactive deletion |
| `rasen store list` | Browse registered stores | `--json` for structured registrations |
| `rasen store doctor` | Check local store setup | `--json` for structured diagnostics |
| `rasen store add-project <path> --to <store>` | Add a project to a store's roster | `--json`; `--dry-run` previews both repositories, `--set-primary` opts into the planning binding |
| `rasen store adopt [path] --to <store>` | Move a project's planning into a store | `--dry-run --json` for an inert preview |
| `rasen store eject <project-id> --from <store>` | Restore a store-hosted project | `--into <path> --json`; the destination is resolved explicitly, never guessed |
| `rasen store migrate-membership <store>` | Convert legacy membership data into records | `--apply --json`; previews by default |
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
| `--profile <profile>` | Install a profile and lock it into `rasen/config.yaml` (`full`, `core`, a saved profile name, or `custom`) |

An explicit `--profile` value other than `custom` is persisted as the project's **locked profile** (`profile:` in `rasen/config.yaml`): later `rasen update` runs keep resolving the project's workflows from that profile instead of the user-wide one. `--profile custom` uses whatever workflows are currently selected in global config (`rasen profile`) for this run only and is never persisted. Saved profile names come from `rasen profile new`/`import`; note that saved definitions live per machine (`<global-config-dir>/profiles/`), so a teammate without the named profile sees a warning and falls back to their user-wide profile until they import it.

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

# Install the core profile and lock the project to it
rasen init --profile core

# Lock the project to a saved named profile
rasen init --profile team-web

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
.cursor/commands/       # Cursor rasen commands (if delivery is both)
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

`--store` accepts a store's display name or its permanent identity. The two are not equivalent: a display name may be shared by two registered stores, and naming a shared one fails as ambiguous (listing every candidate with its identity and root) rather than picking one — the permanent identity is how you say which you meant.

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

`unregister`, `remove`, and `doctor` accept a store's display name or its
permanent identity. A display name that matches two registered stores is
refused as ambiguous — nothing is unregistered or deleted on a guess — and the
identity is how you say which one you mean (`rasen store list` shows it).

### `rasen store remove`

Forget a local store registration and delete its local folder.

```bash
rasen store remove <id> [--yes] [--json]
```

`remove` shows the exact folder before deleting in an interactive terminal.
Agents, scripts, and JSON callers must pass `--yes` to confirm deletion.
Rasen refuses to delete a folder that does not contain matching
store metadata.

### `rasen store upgrade-identity`

Give a store created before permanent identities one, and record it everywhere
it belongs.

```bash
rasen store upgrade-identity <id> [--uid <identity>] [--dry-run] [--apply] [--json]
```

| Option | Description |
| --- | --- |
| `--uid <identity>` | Disambiguate a display name that matches more than one registered store |
| `--dry-run` | Report every file that would be written and change nothing (the default) |
| `--apply` | Write the plan |

Without `--apply` the command previews: it prints every file it would write and
changes nothing. With `--apply` it writes, in this order, so a partial failure
still leaves a coherent state:

1. the store's own `.rasen-store/store.yaml` (written, then read back and verified),
2. the machine store registry, re-keyed by permanent identity,
3. the project's `store:` declaration, when you run it from a project that
   declares this store by name.

Running it twice is a no-op: the identity is minted once and reused. It never
commits or pushes — the output names the files you need to commit yourself.

The registry moves to its identity-keyed form only once **every** registered
store has an identity. Until then it stays in its existing form and the command
names the stores that still need upgrading, rather than inventing identities for
them.

### `rasen store list`

List locally registered stores, with each store's permanent identity.

```bash
rasen store list [--json]
rasen store ls [--json]
```

### `rasen store doctor`

Check local store registration, metadata, and Git presence.

```bash
rasen store doctor [id] [--json]
```

Doctor is diagnostic-only; it reports missing roots, metadata mismatches,
permanent identities (or their absence), display names shared by more than one
store, and invalid local registry state — without modifying the store.

### `rasen store add-project`

Add an in-repo project to a store's roster.

```bash
rasen store add-project <path> --to <store> [--as <id>] [--set-primary] [--dry-run] [--json]
```

In one invocation it registers the project in the machine's project namespace,
writes the store's **membership record** for it, appends a `project:<id>` entry
to the store's `references:` list (the documentation index), and appends a
**membership locator hint** to the project's own `rasen/config.yaml`.

The two repositories are written in a defined order — the store's authority
record first, verified, then the project's hint — and the result reports what
landed in each. They do not change atomically and the command does not pretend
otherwise: anything still needing repair is reported with the command that
finishes it. If the project-side write fails, the store record stands and is
never rolled back.

`--dry-run` lists every file it would write in each repository and changes
nothing. Nothing is staged, committed, pushed, fetched, or pulled; the output
prints a path-scoped commit suggestion per repository for you to run.

**`--set-primary` is an opt-in that never overwrites.** By default the command
does not change which store the project *plans* in — membership and planning
binding are different relations. With the flag:

| Project's planning store | Result |
| --- | --- |
| none | the target store is recorded, reported separately from the membership |
| already the target store | a no-op that succeeds and rewrites nothing |
| a **different** store | **refused** — it names the store bound, the store requested, and the command that rebinds deliberately |

A refusal is scoped to the pointer only: the membership record and locator hint
the same invocation established still stand. The flag is never inferred from
another option, from the project's state, or from this being the project's only
membership. Both stores in a refusal are named by permanent identity as well as
display name, because two stores are allowed to share a name — and a refusal
that named only the name would read "plans in 'team-context', not
'team-context'".

```json
{
  "project": { "id": "elftia", "root": "/repos/elftia", "metadata_created": true, "already_registered": false },
  "target": { "id": "team-context", "root": "/stores/team-context", "reference_added": true },
  "membership": {
    "project_id": "ed2cf5bf-2525-45ed-b665-c47a5b8d5450",
    "roles": { "planning": false, "knowledge": true },
    "store_writes": ["/stores/team-context/.rasen-store/projects/ed2cf5bf-2525-45ed-b665-c47a5b8d5450.yaml"],
    "project_writes": ["/repos/elftia/rasen/config.yaml"],
    "repair_needed": [],
    "suggested_commits": [
      { "repo_root": "/stores/team-context", "command": "git -C /stores/team-context add ... && git -C /stores/team-context commit -m ...", "purpose": "Store repo: record the membership authority record." }
    ]
  },
  "planning_binding": { "requested": false, "changed": false, "refused": false, "bound_to": null, "bound_to_uid": null, "requested_store": "team-context", "requested_store_uid": "8f0c2e7a-13d5-4a1e-9c6b-2b7d4e5f6a80" },
  "dry_run": false,
  "status": []
}
```

A refusal reports the same shape with the binding block filled in:

```json
{
  "planning_binding": {
    "requested": true,
    "changed": false,
    "refused": true,
    "bound_to": "other-store",
    "requested_store": "team-context",
    "rebind_command": "rasen store upgrade-identity team-context --apply"
  }
}
```

### `rasen store adopt`

Move an in-repo project's planning content into a store and convert the repo to
a config-only pointer.

```bash
rasen store adopt [path] --to <store> [--archive <mode>] [--dry-run] [--verify-hash] [--json]
```

Adopt binds by definition: it writes the project's `store:` declaration as part
of the migration, and is not routed through `--set-primary`. It records the
project as a **planning member** in the store's membership record — and asserts
no knowledge role, because an adoption proves where a project plans and proves
nothing about what knowledge it shares. The record lists the adopted spec names,
change names, and the adoption timestamp — and **no path**.
Restoring the project later resolves its destination explicitly (see below)
rather than following a path captured on the machine that ran the adoption.

An interrupted adopt is resumable: the ownership record is written before any
source content is deleted, so a rerun detects the partial state and completes.

### `rasen store eject`

Restore a store-hosted project back to in-repo planning.

```bash
rasen store eject <project-id> --from <store> [--into <path>] [--all] [--force] [--dry-run] [--json]
```

Ownership comes from the store's membership record for that project, with the
legacy adoption manifest read as a fallback while one still exists.

**The destination is resolved by an explicit ordered rule**, and by nothing
else:

1. `--into <path>`, when given;
2. otherwise the current checkout, when its project identity is the project
   being ejected;
3. otherwise the machine registry's single live checkout for that project.

Several candidates, or none, is an error that lists what it found and names
`--into`. Eject never reads a source path recorded in legacy shared data, never
infers a local path from a remote, never guesses from a display name, and never
takes the first of several checkouts. Checkout comparison is canonical, so a
Windows path differing only by drive-letter case or separator form still
matches.

Eject removes where the project *plans*; it does not remove it from the store's
roster. The membership record keeps any knowledge role, and the ownership block
goes. A record whose only role was the planning one the eject just ended, and
which owns nothing, is removed rather than left behind expressing nothing — so
a project that was only ever adopted leaves no empty record when it is ejected.

### `rasen store migrate-membership`

Convert a store's legacy membership data into per-project membership records.

```bash
rasen store migrate-membership <store> [--dry-run] [--apply] [--json]
```

It reads `.rasen-store/adoptions.yaml`, the store's `references:` list, and the
machine's project namespace, and emits one
`.rasen-store/projects/<projectId>.yaml` per resolvable project. `sourcePath` is
dropped and the adoption `timestamp` becomes `adoption.adoptedAt`.

Previewing is the default; `--apply` writes. It is idempotent and safe to re-run.
A project whose identity cannot be determined on this machine is reported and
left untouched rather than guessed at.

**It deletes `adoptions.yaml`** — only under `--apply`, and only after every
record it produced has been written and read back successfully. That is this
change's one non-reversible step; see the migration guide for why it is removed
rather than renamed, and for the `git log` / `git show` commands that recover
the pre-migration file from the store's history. The removal is reported for you
to commit; the command never touches the git index.

```json
{
  "store": { "id": "team-context", "root": "/stores/team-context" },
  "applied": true,
  "converted": [
    {
      "project_id": "ed2cf5bf-2525-45ed-b665-c47a5b8d5450",
      "alias": "elftia",
      "source": "legacy-adoption",
      "roles": { "planning": true, "knowledge": false },
      "record_path": "/stores/team-context/.rasen-store/projects/ed2cf5bf-2525-45ed-b665-c47a5b8d5450.yaml"
    }
  ],
  "unresolved": [],
  "legacy_manifest_removed": true,
  "legacy_manifest_path": "/stores/team-context/.rasen-store/adoptions.yaml",
  "status": []
}
```

### Store membership

Membership answers "which projects belong to this store", and is a different
question from "where does this project plan".

- **Authority** is the store's own record, one file per member project:
  `<store>/.rasen-store/projects/<projectId>.yaml`. It is named and keyed by the
  project's permanent identity, so two projects sharing a display name never
  share a record and two people adding two different projects never edit the
  same file.
- **`roles.planning`** and **`roles.knowledge`** are separate facts. A project
  can share knowledge with a store without planning in it, and the two never
  collapse into one ambiguous flag.
- **Membership expresses roster and eligibility only.** It does not determine,
  imply, or stand in for the decision of where a change is implemented.
- **The project side is a locator, never authority.** `storeMemberships:` in the
  project's `rasen/config.yaml` carries a permanent identity, a display alias,
  and a credential-free remote — so a fresh clone can discover its stores. A
  hint that disagrees with the store's record is reported as drift.

```yaml
# <store>/.rasen-store/projects/<projectId>.yaml
version: 1
projectId: ed2cf5bf-2525-45ed-b665-c47a5b8d5450
id: elftia
remote: git@github.com:org/elftia.git
roles:
  planning: true
  knowledge: true
adoption:
  specs: [fundraising]
  changes: [fundraising-p0-p1]
  adoptedAt: 2026-07-25T10:00:00Z
```

```yaml
# <project>/rasen/config.yaml
storeMemberships:
  - uid: 8f0c2e7a-13d5-4a1e-9c6b-2b7d4e5f6a80
    id: team-context
    remote: git@github.com:org/team-context.git
```

`rasen doctor` and `rasen store doctor` report membership health read-only —
a planning store with no record, a record with no project-side hint, a hint
whose store is not available here, a machine path left in git-shared data, a
record whose filename and identity disagree, an unmappable legacy reference, and
a store still carrying legacy adoption data. Each names its repair command.
See [Troubleshooting](troubleshooting.md#store-membership).

### A store's identity and its name

A store has two different things:

- a **permanent identity**, minted once when the store is created, recorded in
  the store's own `.rasen-store/store.yaml`, and travelling with the store's
  repository. It never changes — not on rename, not on re-registration, not on
  re-clone. No command accepts it as input and no command replaces it.
- a **display name** (the `id`), which is what you type and read. It may be
  renamed, and two different stores may legitimately carry the same one.

Naming a store by display name therefore has explicit arity:

| Matches | Outcome |
| --- | --- |
| 0 | The store is declared but not available on this machine, with the command that would make it available |
| 1 | It resolves, with a note offering the upgrade to a durable declaration |
| 2 or more | Ambiguous: every candidate is listed with its identity and local root, and nothing is picked |

Resolving by permanent identity is exact and never consults the name index.

### Declaring a store durably

A project's `store:` declaration can record the permanent identity, the display
name for readability, and a credential-free remote so the store can be located
on a machine that has never seen it:

```yaml
# rasen/config.yaml
store:
  uid: 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7
  id: team-context
  remote: git@github.com:acme/team-context.git
```

The identity is the authority. A declared name that no longer matches the
store's own name is reported as drift and does not block resolution; a declared
remote that differs from the store's canonical remote is an informational note.
Nothing machine-specific — no filesystem path from your machine — is ever
written into this declaration.

The single-name form keeps working and resolves whenever that name matches
exactly one registered store:

```yaml
store: team-context
```

`rasen store upgrade-identity <id> --apply`, run from the project, rewrites it
into the durable form.

### When a declared store cannot be used

A project that declares a store which cannot be resolved no longer resolves
configuration as though it had no store. The command stops and prints what was
expected, why it could not be used, and a copy-pasteable repair command. The
reasons are distinguished: not registered on this machine, missing store
metadata, a checkout carrying a different identity, an unhealthy store root, an
ambiguous name, and an unreadable declaration.

`rasen doctor`, `rasen store doctor`, `rasen store list`, and `rasen config
--global` keep working in exactly those states — they are how you find out what
is wrong. They write nothing, clone nothing, and register nothing.

A remote that embeds a username-and-password or token credential is rejected on
write and shown redacted wherever it is displayed, in both human and JSON
output. The ordinary SSH form (`git@github.com:acme/team-context.git`) carries a
user name but no secret and is unaffected.

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

Normal commands then resolve to the declared store automatically; the root banner and JSON `root` block report `source: "declared"` with the store id, and printed hints still carry `--store <id>`. The declaration is a fallback, never an override: explicit `--store` always wins. Beside real planning folders the declaration does not move where work lands — planning stays local — but it does drive configuration inheritance, and the notice says whether the permanent identity or the display name resolved it. To convert a pointer repo into a local Rasen root, remove the `store:` line and run `rasen init` — init refuses to scaffold while the declaration is present.

## Doctor (relationship health)

One read-only question, one place: is the Rasen root healthy, and are the stores it references available on this machine?

```bash
rasen doctor [--store <id>] [--json]
```

The report separates root health, store metadata health (including a note when the recorded remote and the checkout's origin diverge), and reference health (the same diagnostics instructions show, with clone fixes for unresolved references). Health findings of any severity exit 0 — agents read the `status` arrays; only command failures (no root, unknown store) exit 1. Doctor never clones, syncs, or repairs. To get the assembled set itself rather than its health, use `rasen context`.

The `store` block reports the resolved identity, how the project declared the
store, and every identity diagnostic. Human and `--json` output carry the same
codes, the same messages, and the same repair commands.

A store that resolved by its permanent identity, with a legacy display name
still recorded in the declaration:

```json
{
  "store": {
    "id": "platform-context",
    "uid": "9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7",
    "metadata": { "present": true, "valid": true, "uid": "9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7" },
    "pointer": {
      "shape": "durable",
      "declared_id": "team-context",
      "declared_uid": "9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7",
      "resolved_by": "uid"
    },
    "status": [
      {
        "severity": "warning",
        "code": "store_pointer_alias_drift",
        "message": "This project declares store name 'team-context', but that store's name is now 'platform-context'. The permanent identity still matches, so it resolved.",
        "target": "store.pointer",
        "fix": "rasen store upgrade-identity platform-context --uid 9d7a6f8d-6b8e-4f6a-b5c4-2e31fd3525c7 --apply"
      }
    ]
  }
}
```

A store that is declared but unavailable — reported, never rendered as though
the project had no store:

```json
{
  "store": {
    "id": "team-context",
    "metadata": { "present": false, "valid": false },
    "pointer": { "shape": "alias", "declared_id": "team-context" },
    "unavailable": {
      "reason": "not-registered",
      "repair": ["git clone git@github.com:acme/team-context.git <path> && rasen store register <path>", "rasen doctor"]
    },
    "status": [
      {
        "severity": "error",
        "code": "store_bootstrap_required",
        "message": "Store team-context is declared by this project but is not registered on this machine.",
        "target": "store.registry",
        "fix": "git clone git@github.com:acme/team-context.git <path> && rasen store register <path>"
      }
    ]
  }
}
```

The identity diagnostic codes:

| Code | Severity | Meaning |
| --- | --- | --- |
| `store_bootstrap_required` | error | the declaration names a store not registered on this machine |
| `store_uid_mismatch` | error | the registered checkout is not the expected store |
| `store_alias_ambiguous` | error | the display name matches more than one registered store |
| `store_pointer_legacy` | info | the declaration is a bare display name |
| `store_pointer_remote_divergence` | info | the declared remote differs from the store's canonical remote |
| `store_pointer_alias_drift` | warning | the declared name no longer matches the store's own name |
| `store_metadata_legacy` | info | the store has no permanent identity yet |
| `store_remote_credentials` | error | a remote carrying credentials was supplied |
| `store_alias_numeric` | warning | a newly assigned display name is all digits |
| `store_remote_divergence` | info | the store's recorded remote differs from its checkout's origin |
| `store_registry_rekey_blocked` | info | the machine registry stays keyed by display name; the named stores have no permanent identity yet |
| `store_alias_repeated` | warning | a registration succeeded under a display name another store already uses |
| `store_alias_renamed` | info | re-registering moved a registry entry's display name; the permanent identity is unchanged |

## Working context (the assembled set)

Everything this work relates to through rasen declarations, in one working set: the Rasen root and the stores it references.

```bash
rasen context [--store <id>] [--json] [--code-workspace <path> [--force]]
```

The JSON brief is agent-consumable (each available referenced store carries its fetch recipe; unresolved members carry the same fixes instructions and doctor show). `--code-workspace` additionally writes a VS Code workspace file containing the root plus the available referenced stores (`ref:<id>` folders) — the one write this command performs, refused without `--force` if the file exists. Unavailable members are reported, never guessed at.

"Working context" is the assembled set; the `context:` field in `rasen/config.yaml` is project background injected into instructions — two different things. `rasen doctor` answers whether the set is healthy; `rasen context` answers what the set is.

## Session runtime context

A supervised session (`rasen ui` → Launch, or the sessions API) already asks the
right question — plan in this Store, implement in that project checkout — and
now it keeps the answer. The session records its planning space, the project it
works on, and the exact checkout of that project on this machine, and hands its
agent process the location of a machine-local context file describing all three.

Everything here is machine-local. The file lives under the global data dir at
`sessions/<sessionId>/context.json`, is written before the agent starts,
removed when the session ends, and never enters Git. It is the one place
absolute roots are allowed, precisely because it is never shared.

```json
{
  "version": 1,
  "sessionId": "0f2a…",
  "planning": { "type": "store", "id": "team-store", "root": "/stores/team" },
  "execution": { "kind": "project", "projectId": "app-7f3c…", "root": "/projects/app" }
}
```

A session that plans in a Store without working on any project records
`"execution": { "kind": "planning-only" }` — an explicit fact, not a missing
field.

The child process receives `RASEN_SESSION_CONTEXT` carrying that file's **path**,
never its contents: the document would otherwise land in the process table,
every `ps` listing, and any log that dumps the environment.

### How a command resolves its context

For the first command in a session, in this order and no other:

1. an explicit selector given on the command (`--store`, `--project`);
2. the session's own recorded context;
3. only when neither applies, the working directory and the pointer nearest to it.

A later step is not consulted once an earlier one has answered. A context file
that is missing, unparseable, or names a different session is **reported**, not
worked around — a silent fallback to the working directory is exactly how a
command ends up resolving the checkout's own Store instead of the one the
session plans in.

### Resuming a frozen run

`rasen pipeline resume` follows a different rule, because a frozen run already
knows which project it belongs to:

- the **frozen identity is the authority** — it says *which* project;
- the session context, or failing that the current checkout, is the **local
  locator** — it says *where* that project is on this machine;
- an explicit selector **only cross-checks**; it cannot retarget the run.

When the frozen project does not match the project the session executes in, the
command **fails**, naming both identities and the checkout. It never continues
in another clone of the same project: a resume into the wrong working tree
produces a plausible-looking diff, which is far more expensive to discover than
an error.

With no session context, the current directory is used only if its own recorded
identity matches the frozen project; failing that, a single registered checkout
of that project is used; and when several match, the command reports
`project_binding_ambiguous` and lists every candidate rather than choosing one.

Checkout comparison is canonical, so a checkout differing only by drive-letter
case or path-separator form is recognized as the same checkout on every
platform.

### What a planning-only session cannot do

A planning-only Store session runs at the Store root and has an **empty** set of
code write roots. It may write planning artifacts in its Store exactly as any
Store session does; it performs no project-scoped materialization and changes
no project's code. The restriction is stated where the session is launched and
in the action context the agent reads (see [`rasen status`](#rasen-status)).

---

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
5. Captures a quality summary (scanned files + metric-line counts) into the archive's metadata

In the full delivery flow, archive runs **after** the profile's retention step (`ship → retain → archive`). It preserves whatever retention produced — a report-mode `retro.md` is moved with the rest of the change — but archive itself performs no reporting or codification.

**Behavior break (v0.1.5):** archive no longer interprets `[RULE]` markers in quality artifacts and no longer appends them to the project's `quality-rules`. `[RULE]` lines are ordinary archived content, existing `quality-rules` are preserved exactly and keep participating in instruction injection, and the archive summary no longer reports an extracted-rule count. Evidence-gated durable guidance is now the `codify` mode of `rasen-retain`, stored as managed [learned skills](retention-and-learned-skills.md) rather than config entries.

---

### `rasen knowledge`

Inspect and mutate canonical **learned skills** — the durable, evidence-gated guidance `rasen-retain`'s `codify` mode produces. This group is the only seam that writes learned-skill state; agents submit a strict candidate rather than editing skill directories directly.

```bash
rasen knowledge apply --from <absolute-json-file> [--project <id> | --store <id>] [--run-state-dir <absolute-dir>] [--approve-store <store>] [--approve-global] [--json]
rasen knowledge list [--scope project|store|global] [--project <id> | --store <id>] [--run-state-dir <absolute-dir>] [--json]
rasen knowledge show <id> [--scope project|store|global] [--project <id> | --store <id>] [--run-state-dir <absolute-dir>] [--json]
rasen knowledge retire <id> [--scope project|store|global] [--project <id> | --store <id>] [--run-state-dir <absolute-dir>] [--yes] [--json]
rasen knowledge effective [--project <id> | --store <id>] [--run-state-dir <absolute-dir>] [--json]
rasen knowledge migrate [--dry-run] [--project <id> | --store <id>] [--run-state-dir <absolute-dir>] [--json]
rasen knowledge bundle export --project <projectId|root> --to <path> [--to-store <store>] [--json]
```

**Subcommands:**

| Subcommand | Description |
|------------|-------------|
| `apply` | Read a strict versioned candidate from an absolute JSON file, compute the deterministic plan, and commit it (create / rewrite / promote / retire / no-op). |
| `list` | List canonical learned skills in a scope, including active and retired status. |
| `show <id>` | Show one learned skill's provenance, applicability, evidence, and status. |
| `retire <id>` | Retire a managed learned skill (requires `--yes` outside a TTY). |
| `effective` | Show what this project actually receives — the resolved set, its sources by permanent identity, conflicts, unreachable Stores, and the three roots. Reads only; writes nothing. |
| `migrate` | Move per-clone knowledge into the project's canonical home and re-key ownership records onto permanent identity. Both steps preview with `--dry-run`. |
| `bundle export` | Export the named project's own canonical learned knowledge to one new portable file and optionally place the same file in a Store as transport. |

**Options:**

| Option | Description |
|--------|-------------|
| `--from <path>` | Absolute path to the candidate JSON file (`apply`). |
| `--scope project\|store\|global` | Which canonical catalog to read or mutate (default: `project`, or `store` when `--store` selects a store owner). |
| `--project <id>` | Select the typed project knowledge owner without changing the active planning root. Mutually exclusive with `--store`. |
| `--store <id>` | Select the store knowledge owner, by its permanent identity or its display name. A display name matching more than one registered store is refused with both named, rather than one being picked. Mutually exclusive with `--project`. |
| `--run-state-dir <absolute-dir>` | Load `auto-run.json` from the exact directory returned as `runStateDir` by `rasen pipeline resume`, then revalidate and use its frozen planning root and owner. A project/store selector becomes a consistency check and cannot override the frozen owner. |
| `--approve-store <store>` | Consent to publishing into the named store in a non-interactive run (`apply`). The value must name the store the publication actually targets; an approval for one store never authorizes another. |
| `--approve-global` | Consent to a global create/promotion in a non-interactive run (`apply`). Rejected for a project or store mutation so consent cannot be reused. |
| `--yes` | Skip the retirement confirmation (`retire`). |
| `--dry-run` | Preview both migrations and write nothing at all (`migrate`). |
| `--to <path>` | New bundle file to create (`bundle export`). Any existing filesystem entry at this path is an occupied destination and is never replaced. |
| `--to-store <store>` | Also place the same bundle in the registered Store's reserved `rasen/knowledge-bundles/` transport directory. This grants no ownership and changes no Store catalog or membership. |
| `--json` | Emit a single JSON document on stdout (agent contract). |

#### Project-knowledge bundle export

`rasen knowledge bundle export` is an explicit, export-only route for carrying a
project's own learned knowledge. `--project` is required and accepts either the
permanent project identity or a registered project root. `--to` is required and
names the one user-selected file the command may create:

```bash
rasen knowledge bundle export \
  --project 3f0b0a2c-… \
  --to ./web-project-knowledge.bundle.json
```

To carry that same validated bundle through a Store, add its permanent identity
or unambiguous display alias:

```bash
rasen knowledge bundle export \
  --project 3f0b0a2c-… \
  --to ./web-project-knowledge.bundle.json \
  --to-store 9f0c1e2a-…
```

The Store copy is written to
`<store>/rasen/knowledge-bundles/<projectId>/<bundleId>.bundle.json`. The
bundle identity makes every placement distinct; an existing entry is never
replaced. Transport does not write `.rasen-store/store.yaml`, project
membership records, the Store knowledge catalog, or any other Store-owned
metadata. It does not stage, commit, or push. Human and JSON output name the
transported file the user may commit.

When `--to-store` is used, `--to` must resolve outside the selected Store,
including through symlink or junction spellings. Transport staging is private
and outside the Store on the same filesystem, so the Store gains only the one
derived untracked bundle file. If Store placement fails after the independent
user file was published, both human and JSON errors report that user file as
successful and name the Store failure separately.

The strict versioned file contains exactly these bundle fields:
`version`, `bundleId`, `projectId`, `createdAt`, `baseProjectCommit`, and
`records`. Each record contains exactly `id`, `knowledgeKey`, `contentDigest`,
the strict managed `manifest`, and its canonical `content`. Retired records are
included with their retired status.

The exporter deliberately never reads or serializes Store-owned knowledge,
machine-wide knowledge, generated-file ownership records, generated tool files,
tokens, session handles, or run state. It validates the complete serialized
bundle for Windows drive-letter paths, Windows network-share paths, and POSIX
absolute paths on every platform before opening any destination-side temporary
file. A non-portable record fails by record and field.

Without `--to-store`, success creates exactly one new file at the resolved
`--to` destination. With Store transport, it additionally creates exactly one
derived file in the reserved Store path.
An occupied file, directory, or link refuses before any temporary file is
created. Schema, path, catalog-read, write, and publication failures leave the
destination tree unchanged; the project catalog, checkout, and machine
registrations are read-only throughout.

Stable JSON success output (the `transport` object is present only with
`--to-store`):

```json
{
  "ok": true,
  "state": "exported",
  "project": "3f0b0a2c-…",
  "recordCount": 4,
  "destination": "/carry/web-project-knowledge.bundle.json",
  "transport": {
    "store": {
      "id": "team",
      "uid": "9f0c1e2a-…"
    },
    "destination": "/stores/team/rasen/knowledge-bundles/3f0b0a2c-…/7c18.bundle.json",
    "filesToCommit": [
      "rasen/knowledge-bundles/3f0b0a2c-…/7c18.bundle.json"
    ]
  },
  "warnings": []
}
```

When Git cannot determine a commit, export still succeeds and writes
`"baseProjectCommit": null`; the output carries the
`base_project_commit_unavailable` warning. `baseProjectCommit` is provenance
for auditing the capture, never a gate and never a portable run checkpoint.

Occupied destination refusal:

```json
{
  "ok": false,
  "error": {
    "code": "knowledge_bundle_destination_occupied",
    "message": "The export destination is already occupied: /carry/web-project-knowledge.bundle.json",
    "destination": "/carry/web-project-knowledge.bundle.json",
    "repair": "Choose a new --to path. Bundle export never replaces an existing filesystem entry."
  }
}
```

Non-portable record refusal:

```json
{
  "ok": false,
  "error": {
    "code": "knowledge_bundle_non_portable_record",
    "message": "Project record \"deploy-routing\" field \"records[0].manifest.applicability.markers[0]\" contains an absolute machine path and is not portable.",
    "record": "deploy-routing",
    "field": "records[0].manifest.applicability.markers[0]",
    "repair": "Remove the absolute machine path from record \"deploy-routing\" and record portable, root-relative guidance before exporting again."
  }
}
```

This release does **not** register a bundle import command, a
machine-preparation bundle step, or portable run checkpoints. A Store can now
carry the exported file, but consuming it on another machine waits for the
later import child.

`effective` reports one of three states: `ready`, `degraded` (a relevant Store could not be reached, so removals were deferred), or `blocked` (Stores disagree and no project record settles it, so nothing was written). Each conflict names every participant by permanent identity, and each unreachable Store carries its own repair.

```json
{
  "ok": true,
  "status": "degraded",
  "project": { "type": "project", "id": "3f0b0a2c-…", "root": "/work/web" },
  "roots": {
    "canonicalOwnerRoot": "/home/me/.rasen/project-knowledge/3f0b0a2c-…",
    "evaluationRoot": "/work/web"
  },
  "skills": [
    {
      "id": "go-sql-transaction-locking",
      "effectiveScope": "store",
      "knowledgeKey": "go-sql-tx-locking",
      "sources": [
        { "owner": { "type": "store", "uid": "9f0c1e2a-…", "id": "team" }, "id": "go-sql-transaction-locking" },
        { "owner": { "type": "store", "uid": "c41d77b8-…", "id": "platform" }, "id": "go-sql-transaction-locking" }
      ],
      "canonicalContentDigest": "sha256:…",
      "resolutionDigest": "sha256:…"
    }
  ],
  "unavailableStores": [
    {
      "store": { "type": "store", "uid": "5b2e90aa-…", "id": "elsewhere" },
      "relevant": true,
      "relevance": ["declared", "previous-source"],
      "diagnostic": "store elsewhere is not registered on this machine",
      "repair": ["rasen bootstrap"]
    }
  ],
  "conflicts": []
}
```

A conflict, and the ownership record the same run would have written:

```json
{
  "conflicts": [
    {
      "id": "go-sql-transaction-locking",
      "kind": "effective",
      "participants": [
        { "source": { "owner": { "type": "store", "uid": "9f0c1e2a-…", "id": "team" }, "id": "go-sql-transaction-locking" },
          "knowledgeKey": "go-sql-tx-locking", "canonicalContentDigest": "sha256:…", "label": "store:team (9f0c1e2a-…)" },
        { "source": { "owner": { "type": "store", "uid": "c41d77b8-…", "id": "platform" }, "id": "go-sql-transaction-locking" },
          "knowledgeKey": "go-sql-tx-locking", "canonicalContentDigest": "sha256:…", "label": "store:platform (c41d77b8-…)" }
      ],
      "guidance": "Align the canonical store records exactly, rename one learned skill, or retire the inapplicable revision."
    }
  ]
}
```

```json
{
  "version": 2,
  "stores": {
    "9f0c1e2a-…": { "lastMembership": "member", "id": "team" }
  },
  "tools": {
    "claude": {
      "learned": {
        "go-sql-transaction-locking": {
          "effectiveScope": "store",
          "sources": [{ "owner": { "type": "store", "uid": "9f0c1e2a-…", "id": "team" }, "id": "go-sql-transaction-locking" }],
          "canonicalContentDigest": "sha256:…",
          "resolutionDigest": "sha256:…",
          "resolutionSchemaVersion": 2,
          "file": { "scope": "project", "path": ".claude/skills/go-sql-transaction-locking/SKILL.md", "sha256": "sha256:…" }
        }
      }
    }
  }
}
```

`migrate` runs two independent steps and reports each: the per-clone catalog move and the ownership re-key. Neither ever chooses between things that disagree — divergent catalogs are reported with every location named and nothing is deleted, and a display name that maps to more than one Store (or to none) **blocks** the re-key rather than guessing which Store owns a real file.

Knowledge-owner selection and planning-root selection are independent. A pointer project may report `owner=project:web` while its change planning root is `store:team`; a direct store launch never guesses one member project. Human and JSON output report both typed identities, and a store is reported by its permanent identity with its display name alongside.

Project mutations are authorized by an active `codify` profile. A **store** publication requires exact managed source records from at least two distinct projects the store's own membership records name as knowledge members, plus an approval naming that store. A **global** create or promotion requires the same independent, verified sources plus explicit approval (interactive prompt or `--approve-global`). A refused publication reports the evidence held and the evidence missing with a copy-pasteable next command, and writes nothing.

A store mutation writes into the store's repository and then tells you which files to commit — Rasen stages, commits, and pushes nothing. See [Retention and learned skills](retention-and-learned-skills.md) for the scope, promotion, membership, applicability, ownership, and budget rules.

---

## Workflow Commands

These commands support the artifact workflow. They're useful for both humans checking progress and agents determining next steps.

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
  ],
  "actionContext": {
    "mode": "repo-local",
    "sourceOfTruth": "repo",
    "version": 1,
    "planningWriteRoots": ["/repo/rasen/specs", "/repo/rasen/changes"],
    "codeWriteRoots": ["/repo"],
    "readRoots": ["/repo"],
    "allowedEditRoots": ["/repo"],
    "requiresAffectedAreaSelection": false,
    "constraints": ["Repo-local change artifacts and implementation edits are scoped to this project.", "..."]
  }
}
```

`actionContext` states separately where planning artifacts may be written,
where code may be written, and what may only be read. `version` says which
contract you are reading:

- **`version: 1`** also carries `allowedEditRoots`, the compatibility view for
  consumers that know only the older single-list form. It is present only when
  the newer capability projects into it *without granting anything the older
  form would not have granted* — the projection can narrow, never widen.
- **`version: 2`** is reported when that projection is impossible — a session
  that plans in a Store while working on a project checkout needs two roots,
  which the older form cannot express. `allowedEditRoots` is then **absent**,
  so a consumer expecting only the older form stops instead of inheriting a
  root it never asked for.

Inside a Store session that works on a project checkout:

```json
{
  "actionContext": {
    "version": 2,
    "planningWriteRoots": ["/stores/team/rasen/specs", "/stores/team/rasen/changes"],
    "codeWriteRoots": ["/projects/app"],
    "readRoots": ["/stores/team", "/projects/app"],
    "requiresAffectedAreaSelection": false,
    "constraints": ["Planning artifacts are written in the planning root; code changes are confined to the selected checkout. ...", "..."]
  }
}
```

A planning-only Store session reports `"codeWriteRoots": []` — empty as a
stated fact, not as a discouragement. Making a root visible to the agent
process (`--add-dir`) never grants permission to write it.

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
rasen profile update [name]
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
| `update [name]` | Edit a saved profile definition in place; opens the picker seeded from the stored snapshot and saves back to the same file. Never changes the current user-wide selection or any project — projects locked to the profile pick the change up on their next `rasen update` |
| `list` | List built-in and saved profiles; add `--json` for structured output |
| `delete [name]` | Delete a saved profile; add `--yes` to skip confirmation |
| `import <path>` | Import a self-contained `.rasenpkg`, YAML, or JSON profile; package `name` is authoritative unless `--as` is supplied, and `--force` replaces only the profile snapshot |
| `export <path>` | Export current settings or the profile selected by `--profile`; profiles with user workflows default to self-contained `.rasenpkg`, while YAML/JSON requires explicit `--thin` |

Named profiles are saved snapshots. Using one copies its delivery and workflows into global configuration, where `profile` remains the effective classification (`full`, `core`, or `custom`) rather than the saved profile name. The saved name is retained by its file in the machine-global profiles directory.

**Locked profiles (project scope).** A project's `rasen/config.yaml` may carry `profile: <full|core|saved-name>` — the locked profile, written by `rasen init --profile <value>` or `rasen config set profile <value> --scope project`. When present, `rasen update`, extend-mode `rasen init`, drift detection, and the management UI resolve that project's workflows from the locked profile instead of the user-wide one. Precedence within a project: the `workflows` override in `config.yaml` (highest, with a warning naming the shadowed lock) → the `profile` lock → the user-wide profile. A lock that cannot be resolved on this machine (deleted or never-imported named profile, or `custom`, which cannot be locked) prints a warning and falls back to the user-wide profile — commands never fail because of a broken lock. Remove a lock with `rasen config unset profile --scope project`.

Self-contained profile packages embed selected user workflows and their user-workflow dependency closure. Built-in workflows remain references. Import reuses an installed workflow only when its digest is identical; a different digest is an error even with `--force`. Thin YAML/JSON import requires every referenced user workflow to be installed already and writes nothing when membership validation fails.

When `new` prompts for a name, invalid, reserved, and existing names show an inline error so another name can be entered. An invalid name supplied directly as `new <name>` fails without opening the remaining prompts.

In the workflow checklist, press `Space` to toggle one workflow, `A` to select all workflows or clear all when every workflow is already selected, and `Enter` to confirm.

Profile prompts, CLI help, the interactive config editor, and shell-completion descriptions and management messages are available in English, Japanese, and Simplified Chinese. The selected language is stored using the canonical `language: "auto" | "en" | "ja" | "zh-cn"` values in the machine-global JSON config. Set it with `rasen config set language en`, `rasen config set language ja`, or `rasen config set language zh-cn`.

The workflow picker shows the stable public workflow id before the localized name, with the separator aligned across rows (for example, `propose - 変更を提案`). Tool-specific slash punctuation is intentionally omitted because assistants may expose the same workflow as `/rasen-propose`, `/rasen-propose`, or a skill.

With `language: "auto"` (the default), Unix-like systems check `LC_ALL`, `LC_MESSAGES`, and `LANG` in that order. A value that resolves to a supported locale decides the language; `C` or `POSIX` (with or without an encoding suffix) explicitly requests unlocalized output and resolves to English; a well-formed but unsupported language such as `fr_FR.UTF-8` falls back to English; a value that carries no language information (for example `UTF-8`) is skipped so the next variable can decide. On macOS, when no variable determines a language — a GUI-launched process, or a terminal that only exports `LC_CTYPE=UTF-8` — the CLI reads the operating system's configured locale (`defaults read -g AppleLocale`, silently and at most once per process) before falling back to the runtime's system locale. Windows uses the system locale reported by Node.js. The aliases `zh-CN`, `zh_CN.UTF-8`, `zh-SG`, `zh-Hans`, and bare `zh` resolve to `zh-cn`. Traditional Chinese locales `zh-TW`, `zh-HK`, `zh-MO`, and `zh-Hant` are unsupported and fall back to English, as do other unsupported automatic locales. `RASEN_LANG=en`, `RASEN_LANG=ja`, or `RASEN_LANG=zh-cn` temporarily overrides the saved setting. Reinstall or regenerate shell completions after changing the saved language so generated descriptions are refreshed.

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
| `show <id>` | Show identity, skill metadata, the declared display title, dependencies, files, digest, and known usage |
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

**Display title**: a user workflow's `workflow.yaml` may declare a `skill:` block whose `name` is the workflow's human-readable display title. Pickers such as `rasen profile` show the title verbatim in the author's original language (never translated) while the stored value stays the workflow id; `list --json` and `show` expose it as a stable `title` field (`null` when absent). The human `list` table keeps machine values only. See [Installable workflows and `.rasenpkg`](workflow-packages.md) for the block's contract.

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
| `profile` | global, project | Workflow profile. Global: the user-wide profile (`full`/`core`/`custom`, use `rasen profile` to edit). Project: the locked profile (`full`, `core`, or a saved profile name — never `custom`) |
| `workflows` | global, project | Workflow selection. Global: edit via `rasen profile`. Project: a per-space override that replaces the user-wide profile (and shadows a `profile` lock) for that space only |
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
| `RASEN_SESSION_CONTEXT` | Absolute path to the session context file the supervisor wrote (set for you inside a supervised session; see [Session runtime context](#session-runtime-context)) |
| `EDITOR` or `VISUAL` | Editor for `rasen config edit` |
| `NO_COLOR` | Disable color output when set |

---

## Related Documentation

- [Commands](commands.md) - AI slash commands (`/rasen-propose`, `/rasen-apply-change`, etc.)
- [Workflows](workflows.md) - Common patterns and when to use each command
- [Customization](customization.md) - Create custom schemas and templates
- [Getting Started](getting-started.md) - First-time setup guide
