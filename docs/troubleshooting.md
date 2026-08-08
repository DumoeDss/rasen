# Troubleshooting

Concrete fixes for concrete problems. Each entry names a symptom, explains the likely cause in a sentence, and gives you the fix. If you don't see your issue here, the [FAQ](faq.md) may help, and the [Discord](https://discord.gg/YctCnvvshC) definitely will.

## Installation and setup

### `rasen: command not found`

The CLI isn't installed, or your shell can't find it. Install it globally and check:

```bash
npm install -g @atelierai/rasen@latest
rasen --version
```

If it installed but still isn't found, your global npm bin directory probably isn't on your `PATH`. Run `npm bin -g` to see where global binaries live, and make sure that path is in your shell profile.

### "Requires Node.js 20.19.0 or higher"

Rasen runs on Node 20.19.0+. Check your version and upgrade if needed:

```bash
node --version
```

If you use bun to install rasen, note that rasen still *runs* on Node, so you need Node 20.19.0+ available on your `PATH` regardless. See [Installation](installation.md).

### `rasen init` didn't configure my AI tool

Init asks which tools to set up. If you skipped your tool or want to add another, just run it again, or use the non-interactive form:

```bash
rasen init --tools claude,codex
```

The full list of tool IDs is in [Supported Tools](supported-tools.md). Use `--tools all` for everything, `--tools none` to skip tool setup.

### Oh My Pi stopped loading my repo's `AGENTS.md` after `rasen init`

You ran `rasen init --tools omp` in a subdirectory (a monorepo package, most
often), which created `<that directory>/.omp/`. Oh My Pi reads its project
instructions (`.omp/AGENTS.md`) and its always-apply project rules
(`.omp/RULES.md`) from the **nearest non-empty `.omp/` directory** it finds
walking up from where you started it, and it stops there — so the new directory
takes over from the one nearer the repository root. Init prints a warning naming
the files that stop loading; this entry is for when you hit it without reading
that output.

Installed skills are not affected: Oh My Pi scans every ancestor's `.omp/skills`,
so the `rasen-*` skills stay discoverable either way.

Pick whichever fits:

- **Install at the repository root instead.** Run `rasen init --tools omp` there;
  remove the nested `.omp/skills` directory if you no longer want it.
- **Copy the context files down.** Copy `AGENTS.md` / `RULES.md` from the
  enclosing `.omp/` into the nested one. They are yours to maintain — Rasen never
  writes context files for any tool.
- **Start Oh My Pi from the repository root.** Discovery is relative to the
  working directory you launch in.

## Commands don't show up

If `/rasen-propose` (or your tool's equivalent) doesn't appear or doesn't do anything, work down this list. They're ordered fastest-to-check first.

1. **You may be in the wrong place.** Slash commands go in your AI assistant's chat, not your terminal. If you typed `/rasen-propose` into your shell, that's the issue. See [How Commands Work](how-commands-work.md).

2. **Regenerate the files.** From your project root:

   ```bash
   rasen update
   ```

   This rewrites the skill and command files for every tool you've configured.

3. **Restart your assistant.** Most tools scan for skills and commands at startup. A fresh window often does it.

4. **Confirm the files exist.** For Claude Code, check that `.claude/skills/` contains `rasen-*` folders. Other tools use their own directories, all listed in [Supported Tools](supported-tools.md).

5. **Check you initialized this project.** Skills are written per project. If you cloned a repo or switched folders, run `rasen init` (or `rasen update`) there.

6. **Confirm your tool supports command files.** A few tools (Kimi CLI, Trae, ForgeCode, Mistral Vibe) don't get generated `rasen-*` command files; they use skill-based invocations instead. The forms differ per tool: see [Supported Tools](supported-tools.md) and [How Commands Work](how-commands-work.md#slash-command-syntax-by-tool).

## Working with changes

### "Change not found"

The command couldn't tell which change you meant. Name it explicitly, or check what exists:

```bash
rasen list                    # see active changes
/rasen-apply-change add-dark-mode        # name the change in chat
```

Also confirm you're in the right project directory.

### "No artifacts ready"

Every artifact is either already created or blocked waiting on a dependency. See what's blocking:

```bash
rasen status --change <name>
```

Then create the missing dependency first. Remember the order: proposal enables specs and design; specs and design together enable tasks.

### `rasen validate` reports warnings or errors

Validation checks your specs and changes for structural problems. Read the message: it names the file and the issue.

```bash
rasen validate <name>           # validate one item
rasen validate --all            # validate everything
rasen validate --all --strict   # stricter checks, good for CI
```

Common causes are a missing required section (like a spec with no scenarios) or a malformed delta header. Fix the file and re-run. The [CLI reference](cli.md#rasen-validate) documents the output format.

### The AI created incomplete or wrong artifacts

The AI didn't have enough context. A few levers help:

- Add project context in `rasen/config.yaml` so your stack and conventions are injected into every request. See [Customization](customization.md#project-configuration).
- Add per-artifact `rules:` for guidance that only applies to, say, specs.
- Give a more detailed description when you propose.
- Use the expanded `/rasen-continue-change` to create one artifact at a time and review each, instead of generating them all at once.

### Archive won't finish, or warns about incomplete tasks

Archive won't *block* on incomplete tasks, but it warns you, because archiving usually means the work is done. If tasks remain on purpose (you're filing a partial change), proceed. Otherwise finish the tasks first. Archive will also offer to sync your delta specs into the main specs if you haven't synced yet; say yes unless you have a reason not to.

## Configuration

### My `config.yaml` isn't being applied

Three usual suspects:

1. **Wrong filename.** It must be `rasen/config.yaml`, not `.yml`.
2. **Invalid YAML.** Run it through any YAML validator; the CLI also reports syntax errors with line numbers.
3. **You expected a restart.** You don't need one. Config changes take effect immediately.

### "Unknown artifact ID in rules: X"

A key under `rules:` doesn't match any artifact in your schema. For the default `spec-driven` schema the valid IDs are `proposal`, `specs`, `design`, `tasks`. To see the IDs for any schema:

```bash
rasen schemas --json
```

### "Context too large"

The `context:` field is capped at 50KB, on purpose, because it's injected into every request. Summarize it, or link out to longer docs instead of pasting them. Lean context also produces better, faster results.

### "Schema not found"

The schema name you referenced doesn't exist. List what's available and check spelling:

```bash
rasen schemas                    # list available schemas
rasen schema which <name>        # see where a schema resolves from
rasen schema init <name>         # create a custom one
```

See [Customization](customization.md#custom-schemas).

## Stores

Run `rasen doctor` first. It keeps working in every state below — that is what
it is for — and it prints the reason and the repair command for each one. It
writes nothing, clones nothing, and registers nothing.

### "declared but not available on this machine"

The project declares a store that is not registered here. Register the checkout:

```bash
rasen store register /path/to/store
```

If the declaration records a remote, doctor prints the clone command too.

### "identity metadata is missing or unreadable"

The registered checkout has no readable `.rasen-store/store.yaml`. Re-register
the checkout, or repair the file:

```bash
rasen store register /path/to/store
```

### "the registered checkout is a different store"

The folder registered for this store carries a different permanent identity —
usually a folder re-cloned from somewhere else. Nothing was written. Register
the checkout that actually is the store you meant, or correct the project's
declaration:

```bash
rasen store doctor
```

### "its Rasen root is missing or incomplete"

The store's checkout exists but its `rasen/` planning folders are missing.
Inspect it, then restore the folders (or pull the store's initial commit):

```bash
rasen store doctor <id>
```

### "that name matches more than one registered store"

Two registered stores share the display name you used. A name is a display
alias, not an identity — nothing is picked for you. Declare the identity
instead:

```bash
rasen store upgrade-identity <id> --uid <identity> --apply
```

`rasen store doctor` lists every candidate with its identity and local root.

### "the declaration cannot be read"

The `store:` value in `rasen/config.yaml` is neither a store name nor a
declaration carrying a `uid`. Fix or remove that line. `rasen doctor` names the
file.

### "this store has no permanent identity yet"

An informational note, not a failure: the store predates permanent identities
and keeps working exactly as before. Reading it never adds one. When you want
one:

```bash
rasen store upgrade-identity <id> --apply
```

### "the remote embeds a credential"

A store remote may not carry a username-and-password or token. Record the
credential-free URL and keep the credential in your Git credential helper. The
ordinary SSH form (`git@github.com:acme/team.git`) is fine.

## Store membership

Membership is a **roster**: which projects belong to a store, and whether each
one plans in it, shares knowledge with it, or both. It is not the same thing as
where a project plans, and it never decides where a change is implemented.

The authority is the store's own record, one file per project:
`<store>/.rasen-store/projects/<projectId>.yaml`. The project's own
`storeMemberships:` list is a **locator** — it helps a fresh clone find the
stores it belongs to, and it never confers membership on its own.

`rasen doctor` and `rasen store doctor` report every finding below, under
**Store membership → Findings** in human output and at `membership.diagnostics`
in `--json`. Both surfaces render from the same structure, so they always carry
the same codes and the same repair commands. Both are read-only: they contact no
network, repair nothing, and write nothing — and they report these findings
whether or not the project declares a planning store, which is what makes the
half-written state after an interrupted `add-project` visible.

### "records no membership for project …" (`store_project_record_missing`)

The store this project **plans in** has no membership record for it. An error,
because the planning binding is already in force and the roster disagrees with
it. Add the record:

```bash
rasen store add-project <project-path> --to <store>
```

### "the project declares no membership hint for it" (`project_membership_locator_missing`)

The store records this project as a member, but the project itself names no
locator for the store. Everything works on this machine and discovery breaks on
the next one. The same command writes both halves:

```bash
rasen store add-project <project-path> --to <store>
```

### "its membership record cannot be verified here" (`project_membership_unverified`)

The project declares a locator for a store that is not available on this
machine, so the authority cannot be read. The answer is *unknown*, not "not a
member" — nothing is dropped from the eligible set on this basis. Obtain the
store, then re-run doctor:

```bash
git clone <remote> <path> && rasen store register <path>
```

### "records a filesystem path from the machine that wrote it" (`shared_metadata_contains_local_path`)

Git-shared data still carries an absolute path from whoever created it. It is
wrong on every other machine and **no command reads it**. Convert the store's
legacy membership data:

```bash
rasen store migrate-membership <store> --apply
```

### "is named for project … but declares project …" (`store_project_record_key_mismatch`)

A membership record's filename and the identity inside it disagree — usually a
renamed or copied file. Neither side is treated as authoritative: trusting the
name would let a rename reassign membership, and trusting the contents would let
a copy claim another project's. Rename the file to match its `projectId`, or
correct the `projectId` inside it — whichever matches the project you meant.

### "references project … by display name" (`store_legacy_reference_unresolved`)

A legacy `references: project:<name>` entry cannot be mapped to a project
identity here, because that name only means something on a machine where the
project is registered. This is the ordinary fresh-machine answer, not a defect.
Nothing is guessed. Either run the migration where the project is registered, or
add it here:

```bash
rasen store migrate-membership <store> --apply     # on a machine that has it
rasen store add-project <project-path> --to <store>  # here
```

### "cannot name a membership record file" (`project_identity_unrecordable`)

The project's `projectId` is neither a UUID nor a kebab-case id, or it is a name
a filesystem reserves (`con`, `nul`, `com1`, …). It is never altered to fit a
filename: two identities collapsing onto one file would silently overwrite one
project's membership with another's. Set a well-formed `projectId` in the
project's `rasen/config.yaml` and rerun.

### "still holds legacy adoption data" (`store_membership_legacy_manifest`)

The store carries `.rasen-store/adoptions.yaml` and has not been converted yet.
Preview first, then apply:

```bash
rasen store migrate-membership <store>
rasen store migrate-membership <store> --apply
```

### "were inferred … not declared" (`store_membership_roles_inferred`)

Informational. Membership derived from legacy data has no declared roles, so
they are inferred narrowly: an adoption proves *planning* membership and proves
nothing about knowledge. The migration records them explicitly.

### `store add-project --set-primary` refused

`--set-primary` never overwrites a planning store that is already set to a
different store. The refusal is scoped to the pointer only — the membership
record and locator hint that same command wrote are still in place, because they
are a different relation. Rebind deliberately if that is what you meant:

```bash
rasen store upgrade-identity <store> --apply
```

### `store eject` asks for `--into`

Eject no longer follows a path recorded at adoption time; that path belonged to
whichever machine ran the adoption. It resolves the destination explicitly:
`--into`, else the current checkout when its project identity matches, else the
machine registry's single live checkout. Several candidates, or none, is an
error that lists what it found:

```bash
rasen store eject <project-id> --from <store> --into <path>
```

## Sessions

### "The session context at … could not be used"

A command running inside a supervised session was pointed at a session context
file (`RASEN_SESSION_CONTEXT`) that is missing, unreadable, does not match the
context schema, or records a different session. Rasen reports it rather than
quietly resolving from the working directory: a silent fallback is how a
command ends up planning in the checkout's own store instead of the one the
session actually plans in.

The file is machine-local and disposable — it lives under the global data dir
at `sessions/<sessionId>/context.json` and is removed when its session ends.
Nothing is lost by dropping it:

```bash
unset RASEN_SESSION_CONTEXT   # then re-run, or relaunch the session
```

A context file left behind by a crashed session has no effect on any later
session: every reader checks the recorded session id.

### "This run is frozen against project … but the session executes in …"

`rasen pipeline resume` refuses to continue a run in a checkout that is not the
project the run was frozen against. This is deliberate and not overridable: a
resume into the wrong working tree produces a plausible-looking diff, which is
far more expensive to discover than an error. Rasen never falls back to another
clone of the frozen project.

Resume from a checkout of the project named in the message, or launch a session
whose execution target is that checkout:

```bash
cd <checkout of the frozen project>
rasen pipeline resume <change>
```

An explicit `--project` selector only cross-checks a frozen run. Naming a
different project reports the disagreement; it does not retarget the run.

### "Several registered checkouts carry project …" (`project_binding_ambiguous`)

The run was resumed with no session context, the current directory is not that
project, and more than one registered checkout carries its identity. Rasen lists
every candidate rather than choosing one. Resume from the checkout you meant, or
launch the run inside a session, which pins the checkout for you:

```bash
cd <one of the listed checkouts>
rasen pipeline resume <change>
```

### "No checkout of project … was found on this machine"

The frozen project has no registered checkout here and the current directory is
not it. Register the checkout you want the run to continue in:

```bash
cd <checkout>
rasen init
```

## Migration from the legacy workflow

### "Legacy files detected in non-interactive mode"

You're in CI or a non-interactive shell, and rasen found old files to clean up but can't prompt you. Approve automatically:

```bash
rasen init --force
```

### Commands didn't appear after migrating

Restart your IDE. Skills are detected at startup. If they still don't appear, run `rasen update` and check the file locations in [Supported Tools](supported-tools.md).

### My old `project.md` wasn't migrated

That's intentional. Rasen never deletes `project.md` automatically because it may hold context you wrote. Move the useful parts into `config.yaml`'s `context:` section, then delete it yourself. The [Migration Guide](migration-guide.md#migrating-projectmd-to-configyaml) walks through this, including a prompt you can hand to your AI to do the distilling.

## Still stuck?

- **Discord:** [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)
- **GitHub Issues:** [github.com/DumoeDss/rasen/issues](https://github.com/DumoeDss/rasen/issues)
- **From your terminal:** `rasen feedback "what went wrong"` opens an issue for you.

When you report a problem, include your rasen version (`rasen --version`), your Node version (`node --version`), your AI tool, and the exact command and output. It makes help much faster.
