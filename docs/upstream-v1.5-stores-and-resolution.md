# Upstream v1.5.0 In Depth: The Stores System and Architectural Convergence

> This document analyzes two major additions in upstream `origin/main` (Fission-AI/OpenSpec, version v1.5.0, synced 2026-07) relative to this fork (dev-harness, fork point `afdca0d`):
>
> 1. **The Stores system** — a new model replacing the entire beta-era workspace / initiative / collection / context-store set of concepts (a breaking change, PR #1190 and a series of preparatory evolutions).
> 2. **Architectural convergence** — in two layers:
>    - **Root-resolution convergence** (part of the stores beta): all ordinary commands now uniformly go through `src/core/root-selection.ts` to decide "which OpenSpec root to act on," and the JSON output envelope and exit-code contract have been unified.
>    - **Resolution-logic parity fixes** (commit `a325305`, PR #1280, fixing #1182/#1202/#1156): converge the three paths — change discovery, task counting, and SHALL/MUST validation — that validate / view / archive had each copied and then silently diverged, back onto the canonical implementation.
>
> The document closes with migration guidance for merging upstream into dev-harness.
>
> Primary sources: upstream source code (`src/core/store/`, `src/core/root-selection.ts`, `src/commands/{store,context,workset,doctor,shared-output}.ts`), upstream official docs (`docs/stores-beta/user-guide.md`, `docs/agent-contract.md`), upstream design history (`openspec/work/simplify-context-and-workspace-model/`, `openspec/initiatives/context-store-and-initiatives/`), and `git show a325305`.

---

## Part 1: The Stores system

### 1. The one-sentence overview

A **store** is "a standalone Git repository holding a standard `openspec/` (specs + changes), plus a very thin identity file `.openspec-store/store.yaml`." You register it by name once on your machine; afterward, all ordinary OpenSpec commands can operate inside it with `--store <id>`.

**OpenSpec itself never clones / pulls / pushes / syncs** — sharing relies entirely on the user's own git pushing and pulling. This is a deliberate design bottom line ("No sync, ever — by design").

The core proposition is compressed by upstream into two lines:

```
Specs are what is true.    (specs/    = established facts)
Work  is what is in motion. (changes/  = work in progress)
```

### 2. The problem it solves

OpenSpec traditionally lives inside a single code repository: the `openspec/` directory sits next to the code. When planning grows beyond a single repository, this is no longer enough:

- A feature spans an API server, a web app, and a shared library — whose `openspec/` does the plan live in?
- A team starts planning before any code exists, or the thing being planned will never become code "in this repo."
- Requirements are owned by one team and consumed by several — wiki versions drift, and coding agents can't read them.

The old beta model tried to answer this with a whole parallel set of concepts:

```
Context stores sync truth.       (the context store synchronizes truth)
Collections shape truth.         (the collection organizes truth)
Initiatives coordinate work.     (the initiative coordinates work)
Workspaces open local views.     (the workspace opens local views)
Changes implement repo-owned slices.
```

The verdict was failure: users and agents had to understand four or five product systems at once — hard to explain, hard to implement, hard to dogfood (deleting the workspace command group netted roughly 12,900 lines removed). The new direction:

```
OpenSpec is a Git-native artifact format for specs and work.
```

### 3. Old-to-new concept mapping

| Old concept (beta, removed) | New destination |
|---|---|
| context store | Renamed to **store**, with an explicit "never synces"; the committed file format is retained, machine tokens all change from `context_store_*` to `store_*`, and the data directory `context-stores/` → `stores/` |
| collection | Removed, no replacement |
| initiative | Removed; work goes straight into `changes/`; `new change --initiative` is rejected (the `initiative_option_removed` diagnostic code is retained); `openspec set change` is removed entirely; `--store` is repurposed as a "root selector" |
| workspace (command group) | Split in two: **workset** (locally opens multiple folders) + **context** (assembles a working set from declarations) |
| code-repo declaration + local map | Removed entirely on 2026-06-19 (unclear mental model), replaced by workset's explicit manual composition |

The precise boundaries of the three new nouns:

| Noun | Definition | Shared? |
|---|---|---|
| **store** | A standalone Git repository: a standard `openspec/` + a `.openspec-store/store.yaml` identity file; registered locally by id | The repository itself is shared via git; the local registration record is not shared |
| **workset** | A purely local, private "named view": gather several folders (planning repo + chosen code repos) under one name and open them together in a specified tool with a single command | Never shared, never committed, never derived from declarations |
| **context** (working context) | The working set computed from **declarations** (the root + the stores it references), for an agent to read or to write a VS Code workspace file | No independent state; purely computed |

Key distinction: **context is data derived from declarations** (it contains only the root + referenced stores; it does not infer code repos); **workset is hand-assembled by a person** (it contains code repos and is purely local). The two are deliberately kept separate.

Approaches rejected during design (do not reintroduce them in our own design after merging):

- `openspec context` was once designed as a change-anchored `openspec workset <change-name>`, later overturned — workset does not anchor to a change and is not derived from declarations;
- A top-level marker file (e.g. `.openspec.yaml` at the project root) — that name is already taken by per-change metadata;
- Reusing the "repo" noun to name a store — agents would mishear it as "the code checkout currently being operated on";
- A per-change link object — "that amounts to reinventing the initiative."

### 4. Disk layout and data format

#### 4.1 Inside a store repository

```
<store-root>/                      ← user-chosen path (e.g. ~/openspec/team-plans)
├── .openspec-store/
│   └── store.yaml                 ← identity file (committed, shared with the repo)
└── openspec/
    ├── config.yaml
    ├── specs/
    └── changes/
        └── archive/
```

`.openspec-store/store.yaml` (`MetadataStateSchema` in `src/core/store/foundation.ts`, Zod strict):

```yaml
version: 1
id: team-plans                                  # must be a kebab-case id
remote: git@github.com:acme/team-plans.git      # optional: authoritative clone source
```

The `remote` is written into the initial commit by `store setup --remote` and propagates with every clone — so health checks and error messages can print a complete, paste-ready fix command for a teammate who doesn't yet have this store.

#### 4.2 Local global data directory (`getGlobalDataDir()`)

| Platform | Data directory |
|---|---|
| `$XDG_DATA_HOME` set | `$XDG_DATA_HOME/openspec` |
| macOS / Linux | `~/.local/share/openspec` |
| **Windows** | **`%LOCALAPPDATA%\openspec`** |

- **Store registry**: `<dataDir>/stores/registry.yaml`
  (on Windows, actually `%LOCALAPPDATA%\openspec\stores\registry.yaml`).
  ⚠️ The upstream `docs/stores-beta/user-guide.md` table writes this as
  `<data dir>/openspec/stores/registry.yaml`, with an extra `openspec` layer — that is a documentation typo; the code is authoritative (`GLOBAL_DATA_DIR_NAME` is already `'openspec'`).
- **Worksets**: `<dataDir>/worksets/`.
- There is also a separate **config directory** (`getGlobalConfigDir()`; on Windows it uses `%APPDATA%` rather than `%LOCALAPPDATA%`): `%APPDATA%\openspec\config.json`, holding the `openers` tool table, profile, featureFlags, etc.

`registry.yaml` (`RegistryStateSchema`, strict; atomic write + a `registry.yaml.lock` file lock):

```yaml
version: 1
stores:
  team-plans:
    backend:
      type: git                                        # currently the only backend
      local_path: /Users/you/openspec/team-plans        # normalized absolute path
      remote: git@github.com:acme/team-plans.git        # optional (observed origin)
      branch: main                                      # optional
```

Core invariant: **one store id allows only one checkout on a given machine**
(`store_id_conflict` / `store_path_conflict`).

#### 4.3 The code-repo-side declaration (`openspec/config.yaml`)

A code repository can declare two kinds of relationships with stores:

```yaml
schema: spec-driven
references:                          # which stores this repo's work "draws on" (read-only context)
  - platform-reqs
  - { id: design-system, remote: "git@github.com:acme/design-system.git" }
store: team-plans                    # default store pointer (fallback, not an override)
```

- `references` is deliberately kept out of the Zod schema; it is hand-parsed by `parseDeclarationList` into `DeclarationEntry[]` (`{id, remote?}`), deduplicated by id keeping the first occurrence;
- The `store:` pointer takes effect **only when** this directory is a "config-only directory" (no specs/ or changes/ under `openspec/`, i.e. no planning shape); a real root always wins, and the pointer is ignored with a warning;
- The pointer has two read paths, deliberately different: `readProjectConfig` is lenient (bad values are dropped with a warning); `readStorePointer` (used by root resolution) **reports** bad values (`invalid_store_pointer`) rather than silently dropping them — silently dropping a pointer would let work land in the wrong place, which is a data-safety problem.

### 5. CLI command surface

Four command groups share a unified failure contract (`src/commands/shared-output.ts`): in human mode they print two lines, `Error:` / `Fix:`, plus exit 1; in `--json` mode they print **exactly one** JSON document on stdout (containing `status: StoreDiagnostic[]`) plus exit 1.

#### `openspec store <sub>`

| Subcommand | Key flags | Behavior |
|---|---|---|
| `store setup [id]` | `--path`, `--init-git`/`--no-init-git`, `--remote`, `--json` | Creates the store shape, writes `store.yaml`, defaults to `git init` + an initial commit, and registers it locally |
| `store register [path]` | `--id`, `--yes`, `--json` | Registers an already-healthy root; a missing identity file is written back after confirmation; **never commits** |
| `store unregister <id>` | `--json` | Deletes only the local registration record, not the files |
| `store remove <id>` | `--yes`, `--json` | Deletes the registration record **and the local folder** |
| `store list` | `--json` | Lists locally registered stores |
| `store doctor [id]` | `--json` | Checks registration / metadata / root health / git facts; read-only |

Git integration is extremely narrow (`src/core/store/git.ts`): **the only write operations are `git init` and a single initial commit** (both happen only during setup); everything else is read-only probing (`gitHasCommits`, `gitHasUncommittedChanges`, `gitOriginUrl` reads local config and never touches the network).

#### `openspec context`

Resolves the root (diagnostic commands do not scaffold; `allowImplicitRoot: false`) and assembles the working set = the root + the stores it references that are registered and available locally. The human output lists "OpenSpec root" + "Referenced stores" (each with a fetch command `Fetch: openspec show <spec-id> --type spec --store <id>`). `--code-workspace <path>` is its only write operation — it generates a VS Code workspace file.

#### `openspec workset <sub>`

`create` (`--member <path|name=path>` repeatable, the first is primary, `--tool <id>`), `list`, `open <name>` (opens all members with the saved tool; the editor opens a multi-root window), `remove` (never touches member folders). The opener table comes from the global config's `openers` key — **a new tool is configuration, not code**.

#### `openspec doctor`

Division of labor with `store doctor`: `store doctor` inspects **the stores themselves in the registry**; `openspec doctor` inspects whether **the current root and the stores it references** are healthy and usable locally. Read-only; each finding carries a paste-ready `Fix:`.

### 6. Relationship to the changes/specs lifecycle (cross-repo workflow)

- A store holds a standard `openspec/`, **and can absolutely contain changes**:
  `openspec new change add-login --store team-plans` creates the change at `team-plans/openspec/changes/add-login/`, and the entire lifecycle (`status` / `instructions` / `validate` / `archive`) works as usual with `--store`.
- **A change lives in exactly one root**; across roots it is two changes.
- Cross-repo relationships come in three flavors, none of them a managed link:
  1. **location**: `--store` selects which root the work lands in;
  2. **reference**: the code repo declares which stores it draws on — read-only context.
     `openspec instructions` attaches an **index** of the referenced stores' specs (one summary line + a precise fetch command per entry), **index, not inline** — upstream content is never frozen inline into the generated instructions (the index total is capped at 50KB; exceeding it emits `reference_index_truncated`);
  3. **citation**: cited in artifact prose ("derives from platform-reqs/billing"); the agent fetches it live via the reference mechanism.
- A typical layered flow: a platform team maintains requirement specs in a store; product teams write low-level designs and changes in their own repo's root, treating the store as referenced context. Nobody's work moves house.

### 7. Beta status

"Beta" is **a documentation-level stability statement, not a runtime feature flag**:
`registerStoreCommand` / `registerContextCommand` / `registerWorksetCommand` / `registerDoctorCommand` are registered unconditionally, with no toggle check (the global config's `featureFlags` exists but these paths do not consume it). The implication: command names, flags, file formats, and JSON keys may all change between versions.

Known limitations: one checkout per id; never synces (a stale checkout shows stale specs until you pull yourself); `view` / `templates` / `schemas` and the deprecated noun forms do not accept `--store`; JSON keys have a casing fissure (see 8.3 below).

---

## Part 2: Architectural convergence

Upstream's "convergence" is actually two layers of work at different granularities; when analyzing the merge they must be considered separately.

### 8. Layer 1: Root-resolution convergence (the skeleton rework of the stores beta)

This layer explains why `src/core/archive.ts` (+296/−65 relative to the fork point), `src/commands/validate.ts`, `src/cli/index.ts`, and other files saw large upstream changes — they were all reworked to resolve "which root am I acting on" through a single entry point.

#### 8.1 A single decision point: `src/core/root-selection.ts`

All ordinary commands (`list` / `show` / `validate` / `status` / `instructions` / `instructions apply` / `new change` / `archive` / `doctor` / `context`) resolve the root through `resolveOpenSpecRoot()` using the same precedence:

```
1. --store <id> specified explicitly   → that registered store's root    source: "store"
2. walk up from cwd to nearest "qualifying" openspec/ → this repo        source: "nearest"
   (config-only dir + valid store: pointer → declared store              source: "declared")
3. no nearest root and registered stores exist locally → error + selection prompt
   (no_root_with_registered_stores)
4. nothing at all                       → scaffolding commands treat cwd as the root  source: "implicit"
                                          diagnostic commands fail outright (no_openspec_root)
```

Notable design details:

- **"Qualifying root" test** (`findQualifyingRootSync`): merely having an `openspec/` directory does not make a root; it must have a planning shape (specs/ or changes/) **or** a config file. Otherwise the recommended `~/openspec/<id>` store layout would turn `$HOME` into a ghost root that captures every command.
- **Fallback never overrides**: a `store:` pointer on a real root is ignored (stderr warning).
- **`--store-path` was explicitly removed** (`store_path_not_supported`) — forcing users to `store register` first and then `--store <id>`, so the id → path mapping has only one source: the registry.
- `inspectRegisteredStore()` is the **single non-throwing inspection path** for metadata identity + root health: the root resolver maps failures to errors, the reference-index assembler maps the same failures to warnings — one inspection path never forks (source comment verbatim: "One shared inspection path — never fork it.").

Return type:

```ts
interface ResolvedOpenSpecRoot {
  path: string;
  changesDir: string;   // <root>/openspec/changes
  specsDir: string;     // <root>/openspec/specs
  archiveDir: string;   // <root>/openspec/changes/archive
  defaultSchema: 'spec-driven';
  source: 'store' | 'declared' | 'nearest' | 'implicit';
  storeId?: string;
}
```

#### 8.2 CLI adapter: `resolveRootForCommand()`

The first thing each command's action does is call it:

- Success in human mode → prints a banner to stderr: `Using OpenSpec root: <id> (<path>)` (written to stderr to keep stdout — which agents consume — clean);
- Failure in `--json` mode → prints "that command's null shape + `status: [diagnostic]`" to stdout, sets `exitCode = 1`, and returns `null` (the caller must return);
- Failure in human mode → the exception continues up to the command's normal error handling.

Companion utilities: `withStoreFlag(root, cmd)` makes all subsequent prompt commands automatically carry `--store <id>` (so users can paste directly); `isStoreSelectedRoot()` is the sole basis for cross-root behavior (absolute-path output, `--store` prompting).

#### 8.3 The unified machine-readable contract (`docs/agent-contract.md`)

This "agent contract" was audited item by item against the shipped code (capstone audit):

- **Exactly one JSON document per invocation** on stdout; human copy, spinners, and store banners all go to stderr;
- **Unified diagnostic envelope** `StoreDiagnostic`:
  `{ severity: "error"|"warning"|"info", code, message, target?, fix? }`,
  with 100+ flat snake_case diagnostic codes across the system (`unknown_store`, `store_id_conflict`, `archive_tasks_incomplete`, …), each carrying a paste-ready `fix` wherever possible;
- Success payloads uniformly embed `root: { path, source, store_id? }`;
- **Exit-code contract**: success (including healthy findings) = 0; a failing `--json` command = 1 + a null shape + `status`; `validate` with failing items = 1; interactive cancellation = 130;
- Known fissure: the store family's JSON keys are snake_case, the workflow family's are camelCase (`root.store_id` is the exception, snake_case everywhere) — unification is deferred to a versioned release.

### 9. Layer 2: Resolution parity fixes (commit `a325305`, PR #1280)

> ⚠️ Scope clarification: this commit is often misread as a large refactor. In reality it is a **surgical bug-fix bundle**: source changes are only 53 lines in `change.ts`, 73 in `validator.ts`, 76 in `task-progress.ts`, 21 in `validate.ts`, 12 in `base.schema.ts`, and `archive.ts` **just +4/−4**, plus 459 lines of parity tests. It does not touch `src/core/artifact-graph/`, nor `project-config.ts`. Commit message verbatim:
> "Fix converges each divergent path onto the canonical one; parity is asserted by test. No new surface, no behavior change to the already-correct paths."

Here "canonical resolution" refers to the logic of "what a change resolves to": (1) which changes count as existing; (2) which files task progress is counted from; (3) how delta spec files are discovered and how SHALL/MUST rules are validated. The pain point: `status` / `instructions` got these three right, while `validate` / `view` / `archive` / `change` each copied its own version and **silently diverged**.

#### 9.1 Fix #1182: inconsistent threshold for change existence

- **Before**: `validate` used `getActiveChangeIds()` (which requires a `proposal.md` in the directory to count as a change), while `status` / `instructions` only checked directory existence. Consequence: a freshly scaffolded change with no proposal yet was recognized by `status` but reported as "Unknown item" by `validate`; `validate --all` **silently exited 0** in a repo that only had directories.
- **After**: all three call sites in validate were switched to the canonical `getAvailableChanges(projectRoot, changesDir)` (`src/commands/workflow/shared.ts`, which lists by directory existence only, filtering out archive and dot-prefixed directories).
- Incidental fix: `validateChangeDeltaSpecs` previously scanned only one level of `specs/<cap>/spec.md`, so nested `specs/<area>/<cap>/spec.md` were missed — a recursive walker `findDeltaSpecFiles(specsDir)` was added to discover spec.md at any depth.

#### 9.2 Fix #1202: task counting was blind (a data-safety bug)

- **Before**: `getTaskProgressForChange` was hard-coded to read only the single file `changes/<name>/tasks.md`. But a schema can declare a task artifact via `apply.tracks`, whose `generates` is a glob (which can match multiple nested tasks.md). `status` went through `resolveArtifactOutputs` to resolve by glob; `view` / `archive` did not. Consequence: (a) view misjudged changes with nested tasks as Draft; (b) **archive's "incomplete-tasks" gate failed** — upstream testing moved a 3/5-incomplete change straight into archive.
- **After**: `getTaskProgressForChange(changesDir, changeName, projectRoot)` gained a third parameter, and the internal call chain was unified to:

  ```
  resolveSchemaForChange (explicit param > change's .openspec.yaml > config.yaml > 'spec-driven')
    → resolveSchema (project openspec/schemas/ > user data-dir schemas/ > package built-in schemas/)
    → findTrackedTasksArtifact (apply.tracks match > fallback id==='tasks')
    → resolveArtifactOutputs (fast-glob) → accumulate counts across all matched files
    → any step failing → fall back to single-file tasks.md (helper guarantees never-throw)
  ```

  All 5 call sites in view / list / archive / change were updated to pass projectRoot; the hand-copied second `countTasks` in `change.ts` was deleted along with its regex constant.

#### 9.3 Fix #1156: SHALL/MUST hints failed for main specs

- **Before**: delta specs went through imperative validation (with precise hints), while main specs went through a Zod `.refine` — but the main-spec parser folded the requirement header into the text before running Zod, so Zod could not distinguish "the keyword is only in the heading" from "it is in the body" and could only emit a generic error.
- **After**: the `.refine(SHALL||MUST)` on `RequirementSchema.text` in `base.schema.ts` was removed; SHALL/MUST validation is now owned imperatively by `Validator.applySpecRules`, reusing the same parser the delta path trusts (`extractRequirementsSection(content).bodyBlocks`), reporting each requirement exactly once with the same byte-for-byte actionable hint as the delta path ("move the SHALL to the line under the header").

The whole set of fixes is pinned by 5 parity-test files (`test/utils/task-progress.test.ts`, `test/core/validation.test.ts`, `test/commands/validate.test.ts`, `test/core/archive.test.ts`, `test/core/view.test.ts`), preventing the three paths from forking again.

---

## Part 3: Impact on the dev-harness merge

### 10. Conflict-surface review

The core src files that both dev-harness and upstream modified — and that will conflict: `src/cli/index.ts`, `src/commands/validate.ts`, `src/core/archive.ts`, `src/core/init.ts`, `src/core/profiles.ts`, `src/core/project-config.ts`, `src/core/artifact-graph/instruction-loader.ts`, `src/core/global-config.ts`. The large upstream changes to archive/validate come mainly from **layer-1 root-resolution convergence** (+ a small amount of parity fixes from a325305); they are not a single commit, so a commit-by-commit cherry-pick is impractical — an overall merge is the way.

### 11. Where our custom logic should migrate to the new mount points

| Type of change in our fork | Correct mount point after merge |
|---|---|
| Extra checks / gates before archive (opsx) | Still in `ArchiveCommand.run`, but the task-gate data source must go through `getTaskProgressForChange(changesDir, name, projectRoot)` (the three-arg version); do not hand-copy task counts again |
| validate's change discovery | Switch to `getAvailableChanges(root.path, root.changesDir)` (upstream validate wraps it in a private `listChangeIds` method for sorting); all three call sites must switch, or the parity tests fail. Note: dev-harness currently calls `getActiveChangeIds()` with no args — the signature already differs from upstream's pre-fix version, so watch the arguments when resolving conflicts |
| validate's custom spec rules | Add them in `Validator.applySpecRules` (imperative); **do not** add them back to `base.schema.ts`'s Zod refine (upstream has moved SHALL/MUST down out of there; dev-harness still carries the old `.refine` and must delete it on merge) |
| Nested multi-area delta handling | Discover recursively with `Validator.findDeltaSpecFiles(specsDir)` |
| Root/output handling for any new command | After registering it in `src/cli/index.ts`, call `resolveRootForCommand()` at the start of the action; JSON output follows the "one document + `root` block + `status` array" contract; diagnostics use the `StoreDiagnostic` envelope (snake_case code + paste-ready fix) |
| Our pipeline / opsx CLI output | Recommend gradually aligning with the agent-contract envelope (`shared-output.ts`'s `asStatus` extracts diagnostics duck-typed; a custom Error just needs a same-shaped `diagnostic` field to be reusable) |

### 12. Recommended migration order (low → high risk)

1. `src/utils/task-progress.ts` (self-contained, never-throw, with a single-file fallback) → update the 5 call sites to pass projectRoot;
2. `validator.ts`'s `findDeltaSpecFiles` + `applySpecRules` SHALL/MUST + deleting `base.schema.ts`'s refine — **these three must move together**, otherwise you get double-reporting or under-reporting;
3. `validate.ts`'s change discovery switches to `getAvailableChanges` — this is where our fork's root/discovery signatures cross the most, so the conflict is most likely here;
4. After each step, run the upstream-brought parity tests to lock in parity.

Other notes:

- **CORE_WORKFLOWS conflict** (`src/core/profiles.ts`): we added `'auto-command'`, upstream added `'sync'`, on the same line — keep both on merge;
- The stores' data-directory logic depends on `getGlobalDataDir()` / `getGlobalConfigDir()`; our fork has a small change to `global-config.ts` (+12/−1) — when resolving conflicts, ensure these two functions' semantics match upstream, or a registry-path drift will make every store "unregistered";
- If our opsx docs and skill templates contain workspace / initiative vocabulary, they need to be aligned to stores terminology after merge (upstream even cleaned the diagnostic codes once).

---

## Appendix: Index of upstream authoritative materials

| Topic | Location (origin/main) |
|---|---|
| Stores user guide | `docs/stores-beta/user-guide.md` |
| Agent JSON contract (all shapes + the diagnostic-code catalog) | `docs/agent-contract.md` |
| Design goals and constraints | `openspec/work/simplify-context-and-workspace-model/goal.md`, `roadmap.md`, `workset-direction.md` |
| Beta evolution history (why workspace/initiative were torn down) | `openspec/initiatives/context-store-and-initiatives/README.md`, `direction-git-native-work.md`, `decisions.md` |
| Store core implementation | `src/core/store/{foundation,registry,operations,git,errors}.ts` |
| Root-resolution implementation | `src/core/root-selection.ts` |
| Resolution parity fixes | `git show a325305` (including the change directory `openspec/changes/fix-validate-view-resolution-parity/` proposal/design/specs) |
