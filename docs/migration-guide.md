# Migrating to the Artifact Workflow

This guide helps you transition from the legacy workflow to the artifact workflow. The migration is designed to be smooth—your existing work is preserved, and the new system offers more flexibility.

## What's Changing?

The artifact workflow replaces the old phase-locked workflow with a fluid, action-based approach. Here's the key shift:

| Aspect | Legacy | Artifact workflow |
|--------|--------|------|
| **Commands** | `/openspec:proposal`, `/openspec:apply`, `/openspec:archive` | Everyday core: `/rasen-propose`, `/rasen-apply-change`, `/rasen-sync-specs`, `/rasen-archive-change` (installed by default alongside the full expanded set) |
| **Workflow** | Create all artifacts at once | Create incrementally or all at once—your choice |
| **Going back** | Awkward phase gates | Natural—update any artifact anytime |
| **Customization** | Fixed structure | Schema-driven, fully hackable |
| **Configuration** | `CLAUDE.md` with markers + `project.md` | Clean config in `rasen/config.yaml` |

**The philosophy change:** Work isn't linear. The artifact workflow stops pretending it is.

---

## Before You Begin

### Your Existing Work Is Safe

The migration process is designed with preservation in mind:

- **Active changes in `rasen/changes/`** — Completely preserved. You can continue them with rasen commands.
- **Archived changes** — Untouched. Your history remains intact.
- **Main specs in `rasen/specs/`** — Untouched. These are your source of truth.
- **Your content in CLAUDE.md, AGENTS.md, etc.** — Preserved. Only the rasen marker blocks are removed; everything you wrote stays.

### What Gets Removed

Only rasen-managed files that are being replaced:

| What | Why |
|------|-----|
| Legacy slash command directories/files | Replaced by the new skills system |
| `rasen/AGENTS.md` | Obsolete workflow trigger |
| Rasen markers in `CLAUDE.md`, `AGENTS.md`, etc. | No longer needed |

**Legacy command locations by tool** (examples—your tool may vary):

- Claude Code: `.claude/commands/openspec/`
- Cursor: `.cursor/commands/openspec-*.md`
- Windsurf: `.windsurf/workflows/openspec-*.md`
- Cline: `.clinerules/workflows/openspec-*.md`
- Roo: `.roo/commands/openspec-*.md`
- GitHub Copilot: `.github/prompts/openspec-*.prompt.md` (IDE extensions only; not supported in Copilot CLI)
- And others (Augment, Continue, Amazon Q, etc.)

The migration detects whichever tools you have configured and cleans up their legacy files.

The removal list may seem long, but these are all files that rasen originally created. Your own content is never deleted.

### What Needs Your Attention

One file requires manual migration:

**`openspec/project.md`** — This file isn't deleted automatically because it may contain project context you've written. You'll need to:

1. Review its contents
2. Move useful context to `rasen/config.yaml` (see guidance below)
3. Delete the file when ready

**Why we made this change:**

The old `project.md` was passive—agents might read it, might not, might forget what they read. We found reliability was inconsistent.

The new `config.yaml` context is **actively injected into every rasen planning request**. This means your project conventions, tech stack, and rules are always present when the AI is creating artifacts. Higher reliability.

**The tradeoff:**

Because context is injected into every request, you'll want to be concise. Focus on what really matters:
- Tech stack and key conventions
- Non-obvious constraints the AI needs to know
- Rules that frequently got ignored before

Don't worry about getting it perfect. We're still learning what works best here, and we'll be improving how context injection works as we experiment.

---

## Running the Migration

Both `rasen init` and `rasen update` detect legacy files and guide you through the same cleanup process. Use whichever fits your situation:

- New installs default to the `full` profile (every workflow); switch to `core` (`propose`, `explore`, `apply`, `sync`, `archive`) if you want the slimmed-down set.
- Migrated installs preserve your previously installed workflows by writing a `custom` profile when needed.

### Using `rasen init`

Run this if you want to add new tools or reconfigure which tools are set up:

```bash
rasen init
```

The init command detects legacy files and guides you through cleanup:

```
Upgrading to the new rasen

Rasen now uses agent skills, the emerging standard across coding
agents. This simplifies your setup while keeping everything working
as before.

Files to remove
No user content to preserve:
  • .claude/commands/openspec/
  • rasen/AGENTS.md

Files to update
Rasen markers will be removed, your content preserved:
  • CLAUDE.md
  • AGENTS.md

Needs your attention
  • openspec/project.md
    We won't delete this file. It may contain useful project context.

    The new rasen/config.yaml has a "context:" section for planning
    context. This is included in every rasen request and works more
    reliably than the old project.md approach.

    Review project.md, move any useful content to config.yaml's context
    section, then delete the file when ready.

? Upgrade and clean up legacy files? (Y/n)
```

**What happens when you say yes:**

1. Legacy slash command directories are removed
2. Rasen markers are stripped from `CLAUDE.md`, `AGENTS.md`, etc. (your content stays)
3. `rasen/AGENTS.md` is deleted
4. New skills are installed in `.claude/skills/`
5. `rasen/config.yaml` is created with a default schema

### Using `rasen update`

Run this if you just want to migrate and refresh your existing tools to the latest version:

```bash
rasen update
```

The update command also detects and cleans up legacy artifacts, then refreshes generated skills/commands to match your current profile and delivery settings.

### Non-Interactive / CI Environments

For scripted migrations:

```bash
rasen init --force --tools claude
```

The `--force` flag skips prompts and auto-accepts cleanup.

---

## Migrating project.md to config.yaml

The old `openspec/project.md` was a freeform markdown file for project context. The new `rasen/config.yaml` is structured and—critically—**injected into every planning request** so your conventions are always present when the AI works.

### Before (project.md)

```markdown
# Project Context

This is a TypeScript monorepo using React and Node.js.
We use Jest for testing and follow strict ESLint rules.
Our API is RESTful and documented in docs/api.md.

## Conventions

- All public APIs must maintain backwards compatibility
- New features should include tests
- Use Given/When/Then format for specifications
```

### After (config.yaml)

```yaml
schema: spec-driven

context: |
  Tech stack: TypeScript, React, Node.js
  Testing: Jest with React Testing Library
  API: RESTful, documented in docs/api.md
  We maintain backwards compatibility for all public APIs

rules:
  proposal:
    - Include rollback plan for risky changes
  specs:
    - Use Given/When/Then format for scenarios
    - Reference existing patterns before inventing new ones
  design:
    - Include sequence diagrams for complex flows
```

### Key Differences

| project.md | config.yaml |
|------------|-------------|
| Freeform markdown | Structured YAML |
| One blob of text | Separate context and per-artifact rules |
| Unclear when it's used | Context appears in ALL artifacts; rules appear in matching artifacts only |
| No schema selection | Explicit `schema:` field sets default workflow |

### What to Keep, What to Drop

When migrating, be selective. Ask yourself: "Does the AI need this for *every* planning request?"

**Good candidates for `context:`**
- Tech stack (languages, frameworks, databases)
- Key architectural patterns (monorepo, microservices, etc.)
- Non-obvious constraints ("we can't use library X because...")
- Critical conventions that often get ignored

**Move to `rules:` instead**
- Artifact-specific formatting ("use Given/When/Then in specs")
- Review criteria ("proposals must include rollback plans")
- These only appear for the matching artifact, keeping other requests lighter

**Leave out entirely**
- General best practices the AI already knows
- Verbose explanations that could be summarized
- Historical context that doesn't affect current work

### Migration Steps

1. **Create config.yaml** (if not already created by init):
   ```yaml
   schema: spec-driven
   ```

2. **Add your context** (be concise—this goes into every request):
   ```yaml
   context: |
     Your project background goes here.
     Focus on what the AI genuinely needs to know.
   ```

3. **Add per-artifact rules** (optional):
   ```yaml
   rules:
     proposal:
       - Your proposal-specific guidance
     specs:
       - Your spec-writing rules
   ```

4. **Delete project.md** once you've moved everything useful.

**Don't overthink it.** Start with the essentials and iterate. If you notice the AI missing something important, add it. If context feels bloated, trim it. This is a living document.

### Need Help? Use This Prompt

If you're unsure how to distill your project.md, ask your AI assistant:

```
I'm migrating from rasen's old project.md to the new config.yaml format.

Here's my current project.md:
[paste your project.md content]

Please help me create a config.yaml with:
1. A concise `context:` section (this gets injected into every planning request, so keep it tight—focus on tech stack, key constraints, and conventions that often get ignored)
2. `rules:` for specific artifacts if any content is artifact-specific (e.g., "use Given/When/Then" belongs in specs rules, not global context)

Leave out anything generic that AI models already know. Be ruthless about brevity.
```

The AI will help you identify what's essential vs. what can be trimmed.

---

## The New Commands

Command availability is profile-dependent:

**Everyday commands (`core` profile subset):**

| Command | Purpose |
|---------|---------|
| `/rasen-propose` | Create a change and generate planning artifacts in one step |
| `/rasen-explore` | Think through ideas with no structure |
| `/rasen-apply-change` | Implement tasks from tasks.md |
| `/rasen-archive-change` | Finalize and archive the change |

**Expanded workflow (custom selection):**

| Command | Purpose |
|---------|---------|
| `/rasen-new-change` | Start a new change scaffold |
| `/rasen-continue-change` | Create the next artifact (one at a time) |
| `/rasen-verify-change` | Validate implementation matches specs |
| `/rasen-sync-specs` | Merge delta specs into main specs |
| `/rasen-bulk-archive-change` | Archive multiple changes at once |
| `/rasen-onboard` | Guided end-to-end onboarding workflow |

The default `full` profile already includes these; switch to `core` if you want just the everyday set, or adjust with `rasen config profile`, then run `rasen update`.

### Command Mapping from Legacy

| Legacy | Artifact Workflow Equivalent |
|--------|-----------------|
| `/openspec:proposal` | `/rasen-propose` (default) or `/rasen-new-change` then `/rasen-continue-change` (expanded) |
| `/openspec:apply` | `/rasen-apply-change` |
| `/openspec:archive` | `/rasen-archive-change` |

### New Capabilities

These capabilities are part of the expanded workflow command set.

**Granular artifact creation:**
```
/rasen-continue-change
```
Creates one artifact at a time based on dependencies. Use this when you want to review each step.

**Exploration mode:**
```
/rasen-explore
```
Think through ideas with a partner before committing to a change.

---

## Understanding the New Architecture

### From Phase-Locked to Fluid

The legacy workflow forced linear progression:

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   PLANNING   │ ───► │ IMPLEMENTING │ ───► │   ARCHIVING  │
│    PHASE     │      │    PHASE     │      │    PHASE     │
└──────────────┘      └──────────────┘      └──────────────┘

If you're in implementation and realize the design is wrong?
Too bad. Phase gates don't let you go back easily.
```

The artifact workflow uses actions, not phases:

```
         ┌───────────────────────────────────────────────┐
         │           ACTIONS (not phases)                │
         │                                               │
         │     new ◄──► continue ◄──► apply ◄──► archive │
         │      │          │           │             │   │
         │      └──────────┴───────────┴─────────────┘   │
         │                    any order                  │
         └───────────────────────────────────────────────┘
```

### Dependency Graph

Artifacts form a directed graph. Dependencies are enablers, not gates:

```
                        proposal
                       (root node)
                            │
              ┌─────────────┴─────────────┐
              │                           │
              ▼                           ▼
           specs                       design
        (requires:                  (requires:
         proposal)                   proposal)
              │                           │
              └─────────────┬─────────────┘
                            │
                            ▼
                         tasks
                     (requires:
                     specs, design)
```

When you run `/rasen-continue-change`, it checks what's ready and offers the next artifact. You can also create multiple ready artifacts in any order.

### Skills vs Commands

The legacy system used tool-specific command files:

```
.claude/commands/openspec/
├── proposal.md
├── apply.md
└── archive.md
```

The artifact workflow uses the emerging **skills** standard:

```
.claude/skills/
├── rasen-explore/SKILL.md
├── rasen-new-change/SKILL.md
├── rasen-continue-change/SKILL.md
├── rasen-apply-change/SKILL.md
└── ...
```

Skills are recognized across multiple AI coding tools and provide richer metadata.

---

## Continuing Existing Changes

Your in-progress changes work seamlessly with rasen commands.

**Have an active change from the legacy workflow?**

```
/rasen-apply-change add-my-feature
```

Rasen reads the existing artifacts and continues from where you left off.

**Want to add more artifacts to an existing change?**

```
/rasen-continue-change add-my-feature
```

Shows what's ready to create based on what already exists.

**Need to see status?**

```bash
rasen status --change add-my-feature
```

---

## The New Config System

### config.yaml Structure

```yaml
# Required: Default schema for new changes
schema: spec-driven

# Optional: Project context (max 50KB)
# Injected into ALL artifact instructions
context: |
  Your project background, tech stack,
  conventions, and constraints.

# Optional: Per-artifact rules
# Only injected into matching artifacts
rules:
  proposal:
    - Include rollback plan
  specs:
    - Use Given/When/Then format
  design:
    - Document fallback strategies
  tasks:
    - Break into 2-hour maximum chunks
```

### Schema Resolution

When determining which schema to use, rasen checks in order:

1. **CLI flag**: `--schema <name>` (highest priority)
2. **Change metadata**: `.openspec.yaml` in the change directory
3. **Project config**: `rasen/config.yaml`
4. **Default**: `spec-driven`

### Available Schemas

| Schema | Artifacts | Best For |
|--------|-----------|----------|
| `spec-driven` | proposal → specs → design → tasks | Most projects |

List all available schemas:

```bash
rasen schemas
```

### Custom Schemas

Create your own workflow:

```bash
rasen schema init my-workflow
```

Or fork an existing one:

```bash
rasen schema fork spec-driven my-workflow
```

See [Customization](customization.md) for details.

---

## Troubleshooting

### "Legacy files detected in non-interactive mode"

You're running in a CI or non-interactive environment. Use:

```bash
rasen init --force
```

### Commands not appearing after migration

Restart your IDE. Skills are detected at startup.

### "Unknown artifact ID in rules"

Check that your `rules:` keys match your schema's artifact IDs:

- **spec-driven**: `proposal`, `specs`, `design`, `tasks`

Run this to see valid artifact IDs:

```bash
rasen schemas --json
```

### Config not being applied

1. Ensure the file is at `rasen/config.yaml` (not `.yml`)
2. Validate YAML syntax
3. Config changes take effect immediately—no restart needed

### project.md not migrated

The system intentionally preserves `project.md` because it may contain your custom content. Review it manually, move useful parts to `config.yaml`, then delete it.

### Want to see what would be cleaned up?

Run init and decline the cleanup prompt—you'll see the full detection summary without any changes being made.

---

## Quick Reference

### Files After Migration

```
project/
├── rasen/
│   ├── specs/                    # Unchanged
│   ├── changes/                  # Unchanged
│   │   └── archive/              # Unchanged
│   └── config.yaml               # NEW: Project configuration
├── .claude/
│   └── skills/                   # NEW: rasen skills
│       ├── rasen-propose/        # full profile (default); core profile keeps this subset
│       ├── rasen-explore/
│       ├── rasen-apply-change/
│       ├── rasen-sync-specs/
│       └── ...                   # full profile adds new/continue/etc. too
├── CLAUDE.md                     # rasen markers removed, your content preserved
└── AGENTS.md                     # rasen markers removed, your content preserved
```

### What's Gone

- `.claude/commands/openspec/` — replaced by `.claude/skills/`
- `rasen/AGENTS.md` — obsolete
- `openspec/project.md` — migrate to `config.yaml`, then delete
- Rasen marker blocks in `CLAUDE.md`, `AGENTS.md`, etc.

### Command Cheatsheet

```text
/rasen-propose      Start quickly (default core profile)
/rasen-apply-change        Implement tasks
/rasen-archive-change      Finish and archive

# Expanded workflow (if enabled):
/rasen-new-change          Scaffold a change
/rasen-continue-change     Create next artifact
```

---

## Store identity (behavior change)

A store now has a **permanent identity** in addition to its display name, and a
project can declare which store it plans in durably.

### What changes on disk

Nothing changes until you run a command that changes it. Every existing file
stays readable exactly as written.

| File | Before | After an explicit upgrade | What writes it |
| --- | --- | --- | --- |
| `<store>/.rasen-store/store.yaml` | `version: 1`, `id`, optional `remote` | `version: 2`, `uid`, `id`, optional `remote` | `rasen store setup` (new stores); `rasen store upgrade-identity --apply` |
| `~/.rasen/stores/registry.yaml` | keyed by display name | keyed by permanent identity, with the name inside each entry | any explicit registry mutation, once **every** store entry has an identity |
| `<project>/rasen/config.yaml` | `store: <name>` | `store: { uid, id, remote }` | `rasen store upgrade-identity --apply`, run from the project |

Reading never upgrades anything: `rasen doctor`, `store doctor`, `store list`,
`list`, `show`, and `status` leave a legacy store's metadata and the registry
byte-identical.

### The one intentional break: a declared store that cannot be used now stops the command

Previously, a project declaring a store that was not registered on this machine
resolved configuration as though it had declared no store at all — you silently
got global and default values that looked legitimate. That is now a reported,
repairable failure.

A project that declares **no** store is unaffected and resolves exactly as
before.

Each reason and its fix:

| Reason | Fix |
| --- | --- |
| Not registered on this machine | `rasen store register /path/to/store` (doctor prints the clone command when the declaration records a remote) |
| Store metadata missing or unreadable | Repair `.rasen-store/store.yaml`, or re-run `rasen store register` |
| The checkout carries a different identity | Register the checkout that is the store you meant, or correct the declaration |
| The store's Rasen root is unhealthy | `rasen store doctor <id>` |
| The name matches more than one store | `rasen store upgrade-identity <id> --uid <identity> --apply` |
| The declaration cannot be read | Fix or remove the `store:` line named by `rasen doctor` |

Or remove the `store:` line to make the project genuinely store-less.

`rasen doctor`, `rasen store doctor`, `rasen store list`, and `rasen config
--global` keep working in every one of those states — they are how you find out
what is wrong.

### Upgrading a store

```bash
rasen store upgrade-identity team-context            # preview: writes nothing
rasen store upgrade-identity team-context --apply    # write
```

Run it from the project that declares the store and it upgrades that project's
declaration too. It never commits or pushes; the output names the files to
commit.

### Rolling back

Reverting to an earlier version leaves any `version: 2` files on disk that the
earlier version cannot parse. That is bounded: version 2 is written only where
you explicitly ran `rasen store setup` or `rasen store upgrade-identity`, and
the upgrade says so before it writes. No read path can produce a file an earlier
version chokes on.

---

## Store membership (behavior change)

A store now records each member project in its own file, keyed by the project's
permanent identity:

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

That record is the **authority** for membership. The project's own config gains
an optional `storeMemberships:` list, which is a **locator only** — it lets a
fresh clone discover the stores it belongs to, and never confers membership:

```yaml
# <project>/rasen/config.yaml
storeMemberships:
  - uid: 8f0c2e7a-13d5-4a1e-9c6b-2b7d4e5f6a80
    id: team-context
    remote: git@github.com:org/team-context.git
```

One file per project means two people adding two different projects to the same
store write two different files, so the addition that used to conflict in a
shared map now merges without resolution.

Membership expresses **roster and eligibility only**. It never decides where a
change is implemented.

### Intentional break 1: `sourcePath` is no longer written or read

`.rasen-store/adoptions.yaml` recorded `sourcePath` — the absolute path of
whichever machine ran the adoption, committed into a repository everyone shares.
On any other machine that path is wrong.

- It is **no longer written**. `store adopt` records ownership in the project's
  membership record instead, which carries no path.
- It is **no longer read for behavior** by any command.
- Existing files stay readable, and their recorded path is reported as
  `shared_metadata_contains_local_path` until you migrate.

**Repair:** convert the store's legacy data into records.

```bash
rasen store migrate-membership <store>            # preview: writes nothing
rasen store migrate-membership <store> --apply    # write
```

### Intentional break 2: `store eject` asks for `--into` where it used to guess

Eject previously defaulted its destination to the recorded `sourcePath`, which
is the break above wearing a different hat: off the originating machine it
restored the project into a directory that had nothing to do with it.

Eject now resolves its destination by an explicit ordered rule:

1. `--into <path>`, when you pass it;
2. otherwise the current checkout, when its project identity is the project
   being ejected;
3. otherwise the machine registry's single live checkout for that project.

Several candidates, or none, is an error that lists what it found and names
`--into`. Eject never infers a path from a remote, guesses from a display name,
or takes the first of several checkouts.

**Repair:** in the ordinary single-checkout case, nothing changes — run eject
from inside the repo, or with the project registered, and rules 2 and 3 cover
it with no flag. Otherwise name the destination:

```bash
rasen store eject <project-id> --from <store> --into /path/to/repo
```

### `store migrate-membership` DELETES `adoptions.yaml`

This is the only non-reversible step in this change, so read this before running
it with `--apply`.

When the migration succeeds it **removes** `<store>/.rasen-store/adoptions.yaml`
from the working tree. It does not rename it, move it aside, or keep a `.bak`
copy. That is deliberate: any archived copy would keep the machine-absolute
`sourcePath` inside the store's git repository, and removing that path from
shared data is the entire point of the change.

Nothing is lost.

- **Every fact the file held is carried into the per-project records.** The
  adopted spec names, the adopted change names, and the adoption timestamp all
  move into each project's `adoption:` block (`timestamp` becomes
  `adoption.adoptedAt`). Only `sourcePath` is dropped, and only because no
  command reads it any more.
- **The deletion happens only after every record is written AND read back.** If
  any record fails to write or fails to re-read, the legacy file is left exactly
  as it was.
- **A project the migration cannot resolve keeps its legacy data.** If any entry
  cannot be mapped to a project identity on this machine, the file is kept —
  it is the only remaining record that those members exist.
- **It only happens under `--apply`.** The default run is a preview that lists
  every record it would create and the file it would remove, and writes nothing.
- **The removal is reported for you to commit.** Rasen never stages, commits,
  pushes, fetches, or pulls; it prints a path-scoped `git add … && git commit`
  you run yourself.

**The pre-migration file remains recoverable from the store's git history.**
Because it was a tracked file in the store's repository, deleting it from the
working tree does not remove it from history. From the store's root:

```bash
# Find the commits that touched the file, newest first
git log --oneline -- .rasen-store/adoptions.yaml

# Print its content as of any of those commits
git show <commit>:.rasen-store/adoptions.yaml

# Or restore it to the working tree from the commit before the removal
git checkout <commit>^ -- .rasen-store/adoptions.yaml
```

If you have not yet committed the removal, the simplest recovery is
`git restore .rasen-store/adoptions.yaml`.

### `store add-project` writes two repositories, in a defined order

`rasen store add-project <path> --to <store>` now writes:

- the store's membership record and its `references:` entry, in the **store's**
  repository;
- the membership locator hint, in the **project's** `rasen/config.yaml`.

The store's authority record is written and verified first, then the project's
hint. The two repositories cannot change atomically and the command does not
pretend otherwise: it reports what was written to each, and anything still
needing repair with the command that finishes it. If the project-side write
fails, the store record **stands** — it is legitimate on its own and is never
rolled back to tidy up a locator.

Preview it first with `--dry-run`, which lists every file in each repository and
changes nothing.

### `--set-primary` is opt-in, and refuses rather than overwrites

Adding a project to a store does **not** change where that project plans. To
also bind it, pass `--set-primary`. It defaults to off and is never inferred
from another flag or from the project's state.

- No planning store yet → the target store is recorded, and the output names the
  planning binding separately from the membership, so you see two distinct
  things happened.
- Already planning in the target store → a no-op that succeeds and rewrites
  nothing.
- Already planning in a **different** store → the command **refuses** to change
  it, naming the store currently bound, the store requested, and the command
  that rebinds deliberately. The membership record and locator hint written by
  the same invocation still stand.

### Rolling back

Reverting to an earlier version leaves `projects/*.yaml` records that the
earlier version ignores, and a `storeMemberships:` key its resilient config
parser drops with a warning. Neither breaks the older version. The one
non-reversible step is the migration's removal of `adoptions.yaml`, recovered
from git history as described above.

---

## Learned knowledge: six deliberate breaks

This release changes six things about learned knowledge on purpose. Each one is
detected, previewable, and blocks rather than guesses; none of them happens
during an ordinary command. Run `rasen knowledge effective` first to see what
your project currently receives, and `rasen knowledge migrate --dry-run` to see
what would change.

### 1. An unreachable Store is no longer read as an empty one

**What changed.** Previously a Store that could not be reached — not registered
here, metadata missing, the checkout gone — looked exactly like a Store with
nothing in it, so reconciliation deleted the generated files it had provided.
Now a *relevant* Store's outage is reported and every removal it implies is
deferred.

A Store is relevant when your project declares it in `storeMemberships`, when a
previous ownership record names it as a source, when a frozen planning or
membership fact names it, when it is your current planning Store, or when it is
locally found to record your project.

**Your repair.** Nothing, if you want the deferral — the files stay and the run
reports the degraded state. To clear it, make the Store reachable again
(`rasen store list` shows what is registered) or remove the declaration from
`rasen/config.yaml`. Files left behind by a Store you have genuinely finished
with are removed on the next run once it is no longer relevant.

### 2. A project's knowledge moves to one home per project

**What changed.** Project knowledge used to live under whichever clone the
command ran in, so one project with two clones ended up with two catalogs on one
machine and resolution answered differently depending on where you were
standing. The canonical location is now keyed on the project's identity:

```text
<global data dir>/project-knowledge/<projectId>/learned-skills/<id>/
```

**Your repair.**

```bash
rasen knowledge migrate --dry-run   # lists every catalog found, per clone
rasen knowledge migrate
```

One catalog is moved. Several byte-identical ones are deduplicated and one is
moved. Several that **differ** for the same identifier are reported as a
conflict with every location named — nothing is chosen, moved, overwritten, or
deleted, and the knowledge the clones agree on still migrates. No old catalog is
removed until its replacement has been written to the canonical location and
read back successfully, and the migration is safe to run again after an
interruption.

### 3. Ownership records are re-keyed on permanent identity

**What changed.** Ownership records for generated files used to name a Store by
its display name. Since this release makes the display name renameable, that
record can no longer say which Store owns a file: rename a Store and the
ownership silently moves; run two Stores that share a name and it was ambiguous
the moment it was written.

**Your repair.** The same command:

```bash
rasen knowledge migrate --dry-run
rasen knowledge migrate
```

The upgrade applies when each recorded display name maps to exactly one Store
carrying a permanent identity. When a name maps to **several** Stores, or to
**none**, the migration **stops** and names the ambiguity — it never guesses,
and it never drops a recorded source. Repair the ambiguity
(`rasen store list`, `rasen store upgrade-identity <store>`) and run it again.

### 4. Content identity no longer includes the display name

**What changed.** The identity computed for a resolved piece of knowledge is now
derived from the schema version, the identifier, the knowledge key, the
effective scope, the sorted **permanent** identities of its sources, their
content digests, and the rendered managed body. No display name reaches it, so
renaming a Store changes no identity and no ownership entry.

**Your repair.** None. The first run after upgrading rewrites the generated
files whose identity scheme changed and reports that as a **migration** — it is
not telling you the knowledge was edited, and nothing you wrote has changed.
Subsequent runs report a no-op.

### 5. A Store can carry a project-knowledge bundle without owning it

**What changed.** Project knowledge remains machine-local by default, while
Store knowledge still travels by cloning the Store. Bundle export can now add
the same explicit file to a Store as transport:

```bash
rasen knowledge bundle export \
  --project <projectId-or-root> \
  --to <new-bundle-file> \
  --to-store <store-uid-or-unambiguous-alias>
```

The Store copy lands at
`rasen/knowledge-bundles/<projectId>/<bundleId>.bundle.json`. Rasen prints that
file for you to commit but does not stage, commit, or push it. The Store's
catalog, project records, membership, and metadata remain unchanged; carrying
the bundle grants no ownership.

Choose a `--to` path outside that Store, including when aliases, symlinks, or
junctions are involved. Store staging stays outside the Store on the same
filesystem. If the Store placement fails after the user bundle was written,
Rasen reports the surviving user bundle path separately from the Store error.

Keep the transported file intact until the receiving project imports it. Merely
cloning the Store carries the file; it does not import or publish its contents.

### 6. Import a project's bundle on another machine

**What changed.** A second machine can now validate, preview, and import the
same project's explicit bundle without copying `~/.rasen`:

```bash
# Machine A
rasen knowledge bundle export \
  --project <projectId-or-root> \
  --to ./project-knowledge.bundle.json

# Machine B, after registering a checkout of that same project identity
rasen knowledge bundle import ./project-knowledge.bundle.json \
  --project <projectId-or-root> \
  --dry-run
rasen knowledge bundle import ./project-knowledge.bundle.json \
  --project <projectId-or-root>
```

The preview reports every record that is new, already present, or conflicting
and changes nothing. A conflict on one identifier prevents every record in the
bundle from being written. Resolve the named local record deliberately, rerun
the preview until it reports no conflicts, and then retry the same import. A
second clean import is a byte-identical no-op.

For Store transport, commit the file printed by export on machine A, clone or
update that Store on machine B, and pass the cloned
`rasen/knowledge-bundles/<projectId>/<bundleId>.bundle.json` path to the same
import command. The route changes nothing about ownership: imported manifests
name the project, contain no Store publication source, and create no Store
catalog, membership, metadata, staging, commit, or push authority.

`baseProjectCommit` is shown as provenance only. It does not gate import and
does not make the bundle a portable run checkpoint. Interactive
reconciliation and portable in-flight run state are not part of this step.

### 7. Machine preparation can offer a committed bundle declaration

**What changed.** The three kinds of knowledge remain deliberately distinct:
Store knowledge travels in the Store Git repository, project knowledge stays
in that project's machine-local canonical home, and a portable bundle is a
deliberate transport file. Machine preparation now connects the last two only
when a durable declaration names the file.

Commit a repository-relative locator in one of these owners:

```yaml
# <project>/rasen/config.yaml — resolves from the project root
knowledgeBundle: carry/project-knowledge.bundle.json
```

```yaml
# <store>/.rasen-store/projects/<projectId>.yaml — resolves from the Store root
knowledgeBundle: rasen/knowledge-bundles/<projectId>/<bundleId>.bundle.json
```

Keep the target inside its declaring repository. Absolute Windows, network,
or POSIX paths, parent traversal, and symlink escape are rejected. Preparation
shows each safe declaration as its own `bundleImports` action, separate from
obtaining or registering a project, hydrating an empty knowledge directory,
and Store knowledge. With no declaration, it offers and imports nothing.

**Consent rule.** `rasen bootstrap --apply --yes` covers an action whose
sources include the project's committed configuration. It does not cover a
bundle named only by one or more Store records; that action remains listed and
requires an explicit import choice. If both sources resolve to the same file,
one action retains both sources and uses project trust. Different files remain
independent actions.

**Repair.** Restore a missing file at the reported resolved path, repair access
to an unreadable file, edit the named durable declaration when it is unsafe, or
obtain the permanent project checkout when a Store record names an unavailable
project. Then run preparation again. To handle a Store-declared file outside
the preparation prompt, preview it and import it explicitly:

```bash
rasen knowledge bundle import <store-relative-resolved-file> \
  --project <projectId-or-root> \
  --dry-run
rasen knowledge bundle import <store-relative-resolved-file> \
  --project <projectId-or-root>
```

A malformed, wrong-project, conflicting, missing, unreadable, unsafe, or
unconfirmed bundle degrades the preparation result without stopping unrelated
setup. The direct F3 import rules still decide validation and conflicts, and a
Store declaration still grants no Store ownership, source, evidence,
membership, publication, Git staging, commit, or push authority. Doctor
readiness, automatic synchronization, interactive conflict reconciliation,
and portable run checkpoints remain absent.

### Rolling back learned knowledge

Reverting to an earlier version leaves version 2 ownership records an older
reader does not understand, and a canonical knowledge home it does not look in.
Both are bounded: every version 2 write is reachable only through a migration
you ran, which reports what it is about to do first, and the old per-clone
catalogs are removed only after the new location verified.

---

## Getting Help

- **Discord**: [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)
- **GitHub Issues**: [github.com/DumoeDss/rasen/issues](https://github.com/DumoeDss/rasen/issues)
- **Documentation**: [docs/artifact-workflow.md](artifact-workflow.md) for the full artifact-workflow reference
