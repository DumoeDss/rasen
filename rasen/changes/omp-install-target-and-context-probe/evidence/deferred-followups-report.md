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
