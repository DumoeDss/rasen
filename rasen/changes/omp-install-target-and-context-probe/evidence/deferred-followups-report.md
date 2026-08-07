# Deferred Follow-Ups: omp-install-target-and-context-probe

Open work this change deliberately does NOT close. `rasen archive` counts these
entries into the archived `.openspec.yaml` `quality.metrics` and hashes this file
into `archive.json`, so read it before treating the change as closed.

Each entry carries a `Findings:` line so the archiver counts it.

## Slices this change does not deliver

The proposal declares two slices out of scope and proposes them separately. Both
are named here so their owners are unambiguous.

### FU-A — Token auditing for Oh My Pi (`canAudit`)

Findings: 1 open — declared a Non-Goal by design.md, unchanged by this change.

`RUNTIME_ADAPTERS.omp.canAudit` stays `false`, so `AUDIT_RUNTIMES` remains
`claude, codex, zed` and every audit surface rejects `omp` with its existing
actionable error. Delivering it means an `AUDIT_READERS.omp` entry, the report
shape for Oh My Pi's per-message usage rows, the audit-management registry, and
the report viewer's runtime handling.

This slice owns three follow-ups recorded by `runtime-adapter-interface-extraction`
(`rasen/changes/runtime-adapter-interface-extraction/evidence/deferred-followups-report.md`):

- **FU-2** — the audit zero-report invariant a spec scenario states but the code
  does not enforce.
- **FU-3** — the audit wire mirror in `packages/ui`, one-directional like the
  threshold mirror this change fixed.
- **FU-4** — the audit viewer's runtime allow-list, which should become a
  schema-tag check.

### FU-B — Worker dispatch to Oh My Pi (`canDispatch`)

Findings: 1 open — declared a Non-Goal by design.md, unchanged by this change.

`RUNTIME_ADAPTERS.omp.canDispatch` stays `false`, so `DISPATCH_RUNTIMES` remains
`claude, codex`, no pipeline runtime value is added, and `resolveDispatchRoute`
keeps answering `legacy-fallback` for an Oh My Pi host. Its real cost is not
plumbing: `src/core/templates/workflows/_orchestration.ts` is ~1040 lines written
around two harnesses, so a native Oh My Pi arm is authorship.

This slice owns **FU-1** from `runtime-adapter-interface-extraction`: dispatch
spawn enforcement — `DispatchAdapter.childEnv` is build-checked on declaration
but not on application.

## Found while implementing this change

### FU-C — A Codex host's implicit `--latest` still reads the Claude store

Findings: 1 open — a pinned wart this change had to work around, not introduce.

`implicitLatestStoreRuntime` (`src/core/agent-context.ts`) routes an inferred
`--latest` to the detected host's own session store, which is what makes an
Oh My Pi session report its own occupancy. `codex` is excluded by
`LEGACY_LATEST_STORE_HOSTS` because `cli-agent-context` requires a Claude or
Codex host's implicit discovery to stay byte-identical to its pre-existing
behavior, and a Codex host resolves through the Claude projects directory today.

Routing Codex to its own rollout store is strictly better — it is the same
wrong-answer class this whole line of work exists to remove — but it changes a
shipped contract, so it needs its own change with the spec scenario updated
rather than arriving as a side effect of adding a harness. The pin is defended by
a test (`test/core/agent-context.test.ts`, "keeps a Codex host pinned to the
fallback store"), so removing it is a deliberate act.

### FU-D — Oh My Pi's docs disagree about whether `SYSTEM.md` walks ancestors

Findings: 1 open — an upstream documentation conflict, resolved conservatively here.

`omp://config-usage.md:242` lists `SYSTEM.md` alongside `RULES.md` and
`.omp/AGENTS.md` as reading "the nearest non-empty ancestor `.omp` directory",
while `omp://system-prompt-customization.md:30` states plainly that `SYSTEM.md`
discovery does **not** walk ancestors and that starting in `<repo>/packages/api`
will not find `<repo>/.omp/SYSTEM.md`.

`detectOmpNestedInstallCapture` warns about `AGENTS.md` and `RULES.md` only —
the two files the `omp-integration` spec names, and the two whose ancestor walk
both documents agree on. If the first document is the accurate one, a nested
install also captures an enclosing `SYSTEM.md` and Rasen under-warns by one
file. Under-warning is the correct failure direction (the install is legitimate
either way), but the ambiguity should be settled against the harness's behavior
rather than its prose, and `CAPTURED_PROJECT_FILES` widened if it walks.

### FU-E — The two typecheck realms have incompatible unused-symbol policies

Findings: 1 open — pre-existing, and it constrained where this change could put a test.

`packages/ui/tsconfig.json` sets `noUnusedLocals: true`; the root `tsconfig.json`
does not. A cross-realm import edge therefore drags the root package's module
graph into the UI program, where four root-side declarations become errors — one
of them (`_RecognitionOrderCoversEveryRuntime` in
`src/core/runtimes/session-stores.ts`) a deliberate compile-time guard that
cannot be "fixed" without weakening it.

The consequence: the `ThresholdBindingRow` mirror guard could not import
`PROBE_RUNTIMES` into `packages/ui/test/`, so it runs as two halves — a
compile-time exhaustive `Record` in the UI realm and a source-text comparison in
the root suite (`test/core/management-api/threshold-binding-row-mirror.test.ts`).
Both directions are covered, but the split is a workaround. The existing
precedent (`packages/ui/test/config/controls.test.ts:165`) is only accidentally
clean: `model-presets.ts` has a tiny transitive graph. The durable repair is to
align the two realms' unused-symbol policy, or to give the UI package a typed
entry point into the root registry that does not pull the whole graph.

### FU-F — The published `--tools` lists were wrong in a second way

Findings: 1 open — partially corrected here; the underlying doc model is untested.

`docs/{,zh/}supported-tools.md` and `docs/{,zh/}cli.md` listed ~30 tool IDs as
available to `--tools`, when `--tools` accepts only the four `adapted: true`
entries and refuses every other one. This change corrects all four documents and
adds the long-missing `hermes` and the new `omp`, but nothing prevents the next
drift: no test compares any published list against
`getToolsWithSkillsDir()`. The registry-derived assertion added to
`test/core/shared/tool-detection.test.ts` guards the code path, not the docs.


## Found by adversarial verification (six independent slices)

### FU-G — An empty detection directory counts as a detection, for every `detectionPaths` tool

Findings: 1 open — pre-existing semantics this change inherits; narrowing it changes another tool.

`getAvailableTools` (`src/core/available-tools.ts`) resolves a `detectionPaths`
entry with `fs.statSync` and no emptiness check, so an EMPTY `.omp/skills/`
reports Oh My Pi as configured. The consequences are the ones D2 exists to
prevent: `rasen update` re-nudges forever once a user selects `omp` and later
deletes the skills, and non-interactive `rasen init` with no `--tools` silently
selects it.

Tightening it was attempted and REVERTED: three pre-existing tests
(`test/core/available-tools.test.ts`) create an EMPTY `.github/prompts`,
`.github/agents` and `.github/skills` and assert `github-copilot` IS detected. So
empty-directory detection is that tool's deliberate, pinned contract, and `omp`
follows the precedent consistently. Narrowing it belongs to a change that owns
`github-copilot`'s contract. `src/core/omp/project-context.ts` already carries the
right predicate (`readdirSync(...).length > 0`) for the same question about the
same directory, so the repair has a shape to copy.

### FU-H — The Claude session locator does not confirm a candidate's recorded cwd

Findings: 1 open — a latent pre-existing hazard this change's spec had to be narrowed around.

`findLatestMainTranscript` (`src/core/agent-context.ts`) trusts the directory
`claudeProjectsDir` derives and reads no recorded `cwd`. The slug is lossy —
`/a/b.c` and `/a/b/c` produce the same name (verified) — and Claude transcripts DO
record `cwd` (verified on a real transcript), so the confirmation step is
implementable. Its `fs.statSync(full).mtimeMs` is also unguarded, throwing raw
`ENOENT` on a raced deletion instead of `AgentContextUnavailableError`.

This change originally stated its locator discipline as a registry-WIDE
requirement that the Claude locator violates. The requirement was NARROWED to
multi-layout runtimes rather than the code changed, because `cli-agent-context`
requires Claude discovery to stay byte-identical and the proposal declares Claude
probing unchanged. This entry owns the repair.

### FU-I — `pnpm --dir packages/ui typecheck` does not run on a pull request

Findings: 1 open — the reason this change's mirror guard needed two halves.

`.github/workflows/ci.yml`'s `ui_build` job runs `install`, a four-file `vitest`
subset, and `build` — not `typecheck`. Only `release.yml:48` runs that. Every
compile-time-only guard in `packages/ui`, including the exhaustive
`Record<ThresholdBindingRow, true>` added here, is therefore a release-time gate
rather than a merge gate. The drift is still caught pre-merge by the root-side
source-text guard added here, but `KNOWN_MODEL_IDS` (FU-5) reached a release
precisely through this hole. One-line CI change, deferred because
`test/release-workflow.test.ts` pins the release workflow's shape.

### FU-J — `--limit 1.5` is truncated by the CLI before validation sees it

Findings: 1 open — pre-existing; it makes one arm of a regression test unreachable end to end.

`src/cli/index.ts` parses with `parseInt(v, 10)`, so `1.5` becomes `1` and
`validateProbeLimit`'s integer check never fires. Measured: `--limit 1.5` on a real
transcript reports `limit: 1` and `pct: 124101` — a 12,410,100% occupancy — while
`--limit 0`, `-1` and `abc` correctly exit 1. Not in this change's diff. The repair
is to parse with `Number(v)`.

### FU-K — Terminal escapes in a directory name reach the terminal unfiltered

Findings: 1 open — pre-existing CLI-wide class; this change adds one more site.

The nested-install disclosure interpolates absolute paths into two `console.log`
lines. A directory named with CSI/OSC sequences clears the screen and rewrites the
terminal title when the warning prints, reachable from a hostile clone because the
`.git` boundary is checked after the capture test.

Verified NOT an inconsistency: no filesystem path is sanitized for console output
anywhere in the CLI (`selectedProjectRoot`, `Machine home:` and the `RASEN_HOME`
warning all interpolate raw), and `sanitizeInline` targets a different threat
(forging instruction lines in agent guidance) with three content-only call sites.
Scoping a fix to only this warning would CREATE an inconsistency; the repair is one
`sanitizePathForDisplay` applied uniformly at the console boundary.

### FU-L — One legacy prefix sweep can delete a user-authored skill

Findings: 1 open — inherited behavior; the requirement admits no exception.

`pruneRetiredExpertSkillDirs` (`src/core/legacy-cleanup.ts`) is a `readdir` +
prefix scan on `openspec-gstack-` and is reached on the omp path from both `init`
and `update`. A user-authored `.omp/skills/openspec-gstack-mine/` is removed. Every
other deletion reaching that root is exact-name or ownership-ledger scoped and is
safe. The behavior is inherited — it applies identically to `.claude/skills` and
predates this change — but `omp-integration`'s "SHALL leave any non-`rasen-` skills
untouched" is written absolute. Either narrow the requirement to name the rebrand
sweep as a deliberate legacy exception, or give the sweep a manifest guard.

### FU-M — The registered-but-capability-free registry arm now has no instance

Findings: 1 open — an invariant left without a subject, not a behavior change.

`runtime-adapter-registry` retains the scenario "A registered runtime with no
capability is still recognized". `omp` was the only all-false entry; after the flip
none exists (`zed` still carries `canAudit`), so `runtimesFor`'s behavior for such
an adapter is untested against the shipped registry. The scenario is still a real
forward contract. `test/core/runtimes/registry-enforcement.test.ts` already
declares its own local registry in `HARNESS`, so it could carry a capability-free
id without touching the shipped one.