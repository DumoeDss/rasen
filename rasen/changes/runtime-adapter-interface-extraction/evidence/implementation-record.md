# Implementation record — runtime-adapter-interface-extraction

Written during apply. Covers the four decisions where implementation overturned
the design, the residual runtime-literal audit (task 3.8), the follow-on
ordering (8.2), the typecheck-free mirrors (8.3), and the observation gate that
task 8.4 waits on.

## Verification performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `pnpm lint` | clean |
| `npx vitest run` | 6063 passed, 27 skipped, **1 failed** — `test/cli-e2e/basic.test.ts > localizes pipeline human output`, proven environmental (below) |
| Route parity, 35 host × pipeline `pipeline show --for-execution --json` outputs vs `HEAD` | byte-identical, 0 diffs |
| `test/core/config-keys.test.ts`, `test/core/runtime-adapters.test.ts` | unmodified (`git diff` empty), both pass |

### The one failing test is pre-existing and environmental

`localizes pipeline human output while preserving machine and user values`
asserts `stderr === ''`. It receives the skill/CLI version-drift warning
(`root-selection.ts:857`).

Evidence it is not this change:

- The same test passes on a clean `HEAD` worktree (`git worktree add /tmp/rasen-base HEAD`).
- `.claude/skills/*/SKILL.md` in this working tree are stamped by whichever CLI last ran `rasen update` — `0.1.6-dev.local` when this was first diagnosed, `0.1.7-dev.local.1` now. Those files are **untracked**; only `.claude/skills/rasen-npm-pack/` is tracked, and it is locally deleted.
- Running `rasen pipeline list` from a directory with no installed skills produces empty stderr; running it from the repo root produces the warning. The drift source is the working tree's skill install, not any source file this change touched.
- It is not closable by installing the new pack — see "Correction: installing the pack does NOT clear the version-drift warning" below for why a dev-local install can never match the repository's plain version.

### Live-data smoke tests (task 7.3)

Against `~/.omp/agent/sessions/-SyncLocal-rasen/2026-08-06T03-31-52-129Z_019fd520-….jsonl`:

| Command | Before | After |
|---|---|---|
| `agent context --transcript <omp>` | `available: true, contextTokens: 0`, exit 0 | exit 1, `No context reader exists for the recognized session runtime "omp"` |
| `agent audit <omp> --out <path>` | schema-valid all-zero Claude report, exit 0 | exit 1, `No token auditor exists for the recognized session runtime "omp"`, **no file written** |
| `agent context --latest` | `unsupported-host`, exit 0 | unchanged |
| `agent context --transcript <real claude opus-5 session>` | limit 200000 → 99.7% → `shouldHandoff: true` | limit 1000000 → `pct 0.199452` → `shouldHandoff: false` |

The last row is defect 4 measured on a real 199,452-token session, not a fixture.

## Deviations from the design and tasks

### ADR-1 — Four sibling registry modules, not one `runtimes/registry.ts` (deviates from D1)

D1 specifies a single `src/core/runtimes/registry.ts`. Shipped instead:
`session-stores.ts`, `context-readers.ts`, `audit-readers.ts`,
`dispatch-adapters.ts`.

Evidence: `AUDIT_READERS` must import `token-audit/audit.ts`, which reaches
`token-audit/zed/database.ts` → `node-sqlite3-wasm`. Measured on this machine:
`import('node-sqlite3-wasm')` costs **6.8 ms and 9.8 MB RSS**. A single barrel
would put that on the `rasen agent context` pre-flight path, which pipeline
machinery calls per warm-continue decision. Splitting costs nothing and each
module still declares exactly one `satisfies`-checked map, so D2's enforcement
is unchanged. No barrel is shipped, deliberately: a barrel that must never be
imported is a trap.

### ADR-2 — The registry↔provider import cycle is accepted and made inert

D1 introduces the split partly to avoid a cycle, but the cycle is unavoidable
for a module that both *provides* an implementation and *consumes* the map:
`agent-context.ts` supplies the Claude reader and consumes `CONTEXT_READERS`;
`token-audit/audit.ts` supplies all three auditors and consumes
`AUDIT_READERS`.

The repo already tolerates cycles — a Tarjan pass over all 383 `src/**/*.ts`
files found **7 pre-existing cyclic SCCs**, including a 20-module one spanning
`workflow-registry`/`learned-skills`/`templates`. So this is consistent with
existing practice, not a new hazard class.

It is made inert by construction: **every adapter member is an arrow that calls
its implementation**, never a bare function reference. No imported binding is
dereferenced during module evaluation, so evaluation order cannot matter. That
invariant is documented in `session-stores.ts`'s header; breaking it (by
"simplifying" a wrapper to a bare reference) would reintroduce the hazard.

### ADR-3 — `DispatchAdapter` carries no `buildInvocation` (deviates from task 1.1)

Task 1.1 lists `buildInvocation` as a `DispatchAdapter` field. Excluded.

`buildClaudePrintInvocation` takes `BuildClaudePrintInvocationOptions`
(requires `contract: WorkerContract`) and returns `ClaudePrintInvocation`
(carries `stdin`). `buildCodexExecInvocation` takes sandbox/effort/provider
options and returns argv plus a rendered shell string. They are structurally
unrelated. Grep confirms **no call site selects between them by runtime id** —
`buildCodexExecInvocation` is not called from `src/` at all outside its own
module; it appears only in a playbook template. There is no branch to retire,
so a common field would be a contract with no consumer, forced to `unknown`
options that every caller must re-narrow — reintroducing the branch it claims
to remove. `spawn: 'rasen-owned' | 'playbook-owned'` already records the real
asymmetry (D7). Every other D6 field is present and does retire a branch.

### ADR-4 — `probeCodex`/`probeClaude` were removed, not kept (deviates from task 3.6)

Task 3.6 says to add the per-adapter `probe` seam *alongside* the existing
named options. Keeping both forces `resolveAvailabilityProbe` to carry
`target === 'codex' ? options.probeCodex : options.probeClaude` — precisely the
runtime-literal branch task 3.8 exists to remove, and precisely the
"one named option per runtime" shape that blocks a third adapter. Six call
sites (1 in `src/commands/validate.ts`, 5 in one test file) were migrated to
`probe: { <target>: fn }`. Clean cutover, no alias.

### ADR-5 — Management operations dispatch from a local map, not `AUDIT_READERS` (deviates from task 3.5)

Task 3.5 says to replace the three implicit-else-is-Zed sites in
`token-audit/management.ts` with `AUDIT_READERS` lookups. Those three
operations — report-shape validation, recent-session discovery, native-target
resolution — are implemented *in* `management.ts`. Putting them on
`AUDIT_READERS` would make `runtimes/audit-readers.ts` import `management.ts`
while `management.ts` imports `audit-readers.ts`: a second cycle bought for
nothing, since these are management-API concerns (UI session discovery, report
import validation) the core auditors never use.

Shipped instead: `AUDIT_MANAGEMENT`, declared in `management.ts` and checked
`satisfies Record<AuditRuntime, {...}>`. Same build-time enforcement in both
directions, no cycle, no type leakage. All three implicit elses are gone; the
250-line validation bodies moved into three named functions rather than being
rewritten. Design open question 3 ("should `AuditReader` declare its report
shape?") stays open, as D11 intends.

## Task 3.8 — residual runtime-literal audit

The task expects exactly two deliberate exceptions. The audit found **more**,
and the design undercounted. Every `=== '<runtime>'` remaining in `src/`,
classified:

**Deliberate, named in the design (2):**

- `agent-context.ts:579` — `runtime !== 'unknown'`. An unidentified host has no
  adapter to contradict; gating it would break every existing caller.
- `execution-validation.ts:288` — `host.runtime === 'unknown'`. Selects between
  the two distinct notices (unidentified vs recognized-without-adapter).

**Deliberate, additional — not implementation selection over runtimes (3):**

- `token-audit/audit.ts:162,183` — `override === 'zed'` / `kind !== 'zed'`.
  Gates two runtime-specific CLI flags (`--match`, `--db`). A flag-scope
  statement. Encoding "which flags this runtime accepts" as an adapter field
  would be a contract with one implementor and no second use.
- `commands/agent.ts:346` — `options.runtime !== 'claude'` in `agent dispatch`.
  The command implements exactly one bridge; its serialized failure envelope
  pins `bridge: 'claude-print'`. Converting one line while the surrounding
  body stays Claude-specific would be cosmetic. Its *adapter-derived* parts
  (binary env var, default binary, label, install advice) were migrated.
- `token-audit/types.ts:368,377` — `isCodexAuditResult`/`isZedAuditResult`.
  Discriminated-union type guards. These are the one site the design already
  counted as type-checker-protected.

**Out of scope, different registry or explicitly deferred (4):**

- `init.ts:318,1078`, `update.ts:500` — `tool.value === '<id>'` over the
  **`AI_TOOLS` installation registry**, which `runtime-adapters.ts`'s own header
  states is a separate contract.
- `retired-edit-boundary.ts:130,150,224` — per-tool hook installation in tool
  config files, not runtime adapter selection.
- `keepalive/index.ts:344-345` — `isRuntimeGated`. Design open question 4 leaves
  it exactly as-is; the fail-safe holds.
- `pipeline-registry/run-state.ts:116-125`, `commands/pipeline.ts:1106` —
  inference and display keyed on *which id field a runtime records*
  (`sessionId` vs `threadId`), genuinely runtime-shaped state, not in the
  design's eighteen.

Conclusion: no *implementation selection* over a runtime id remains in `src/`.
The design's "two deliberate `'unknown'` distinctions" should read "two
`'unknown'` distinctions plus three deliberate non-selection literals".

## Task 8.2 — follow-on order

1. **Oh My Pi `SessionStore.locateLatest` + `ContextReader`** (probe). Recognition
   already routes `omp` away from the Claude reader, so this is `locateLatest`
   (two coexisting bucket-naming schemes under `~/.omp/agent/sessions/`, plus
   terminal breadcrumbs for live-session identification) and a reader over the
   `input`/`cacheRead`/`cacheWrite` field names. Flipping `canProbeContext`
   makes the `satisfies` map demand the reader, and vice versa.
2. **Oh My Pi `AuditReader`** (audit). Independent of (1) now that recognition
   is decoupled — before this change, `kind === 'omp'` fell into the Claude
   auditor's default arm, forcing both into one change. Must land with, or
   immediately after, (1): the two share the store, and shipping only one
   leaves a harness that can be measured but not audited (or the reverse).
3. **Oh My Pi `DispatchAdapter`** (dispatch), plus the keepalive cost-model
   decision. Last because it is the only one with a policy question attached
   (design open question 4: `isRuntimeGated` keys on runtime id, and its
   docstring rationale at `keepalive/index.ts:250-264` is falsified the moment
   Oh My Pi can dispatch). Route derivation means this adds **no** route cells
   — the 4→9-cell blocker is gone.

Each step is "register an adapter, flip one boolean" — the build then names
anything missing.

## Task 8.3 — the two typecheck-free mirrors (follow-ups of the audit capability change)

Neither is reachable from `src/core`; both are separate typecheck realms. They
want *different* repairs, which is why they are not bundled here (D11). Order
matters:

1. **`packages/ui/src/api/types.ts:341` — relax FIRST.** Per this project's
   `management-api-wire-mirror-field-relaxation` rule: widen the hand-maintained
   runtime union in the UI mirror *before* the server widens. A stale mirror
   lets both typechecks pass while consumers render `undefined`. Add a parity
   test against `AUDIT_RUNTIMES` so the mirror cannot drift again.
2. **`viewer/audit.html:219,372-384` — replace the allow-list, don't extend it.**
   The right fix is to delete the runtime allow-list, accept any report carrying
   the `rasen-token-audit/2` schema tag, and give the render dispatch an
   explicit unknown-runtime arm. That makes the viewer forward-compatible so no
   future runtime touches it at all — a contract change, not a list edit.

## Task 8.4 — `omp-session-file-fabricated-zeroes` retired with this change

Done: `rasen knowledge retire omp-session-file-fabricated-zeroes --scope project`.

D15 gates the retirement on "this change ships in `v0.1.7` and the fixed
behavior has been observed in real use", and calls it "the final task of this
change". **This change is `v0.1.7`**, so the gate closes here rather than in a
later release. Both halves are satisfied:

- Shipped: this change is the `v0.1.7` content.
- Observed in real use, not in fixtures: the four defects were exercised
  against a live Oh My Pi session file under `~/.omp/agent/sessions/` and a
  real 199,452-token `claude-opus-5` session (the smoke-test table above).

Retiring it is not merely permitted, it is now **required**: every one of the
skill's three claims is false against the shipped code, so leaving it active
would teach agents to distrust correct output —

| Skill claim | Status after this change |
|---|---|
| "both fall through to the Claude reader and return a confident zero at exit 0" | false — both refuse, non-zero, naming the harness |
| "treat `contextTokens` 0 with `available` true as a failed read" | actively harmful — a zero-turn Codex rollout legitimately reads 0 |
| "do not trust an opus-5 occupancy percentage" | false — `opus-5` resolves to its real 1M window |

The retirement touched only the machine-local knowledge home
(`~/.rasen/project-knowledge/<id>/learned-skills/…`); no tracked repository
file changed.

### `runtime-adapter-host-id-widening-audit` — retired, gate met

Done: `rasen knowledge retire runtime-adapter-host-id-widening-audit --scope project`,
followed by `rasen update` to de-materialize it.

It was process guidance, not a defect warning: "adding an id to the runtime
adapter registry — convert every sentinel-literal branch to a capability test
and sweep locale copy, shipped prompts, docs, and exact-equality assertions."
This change makes most of that structural (capability tests replace the
sentinels, derivation replaces the route table, `satisfies` catches a missing
implementation); it does not make the sweep half automatic, which is why the
locale catalogs, shipped playbooks, published guides, and SHA-256 baselines
still had to be found and edited by hand here.

The gate was the local install, and it is met — this branch is what the
machine now runs:

```
$ npm ls -g @atelierai/rasen --depth=0
└── @atelierai/rasen@0.1.7-dev.local.1
```

All four fixes were re-verified through that globally installed binary, not
through `bin/rasen.js`: the Oh My Pi context probe and audit both exit 1
without writing a report, and the real `claude-opus-5` session still reports
`limit: 1000000, pct: 0.199452`.

### Correction: installing the pack does NOT clear the version-drift warning

An earlier revision of this record claimed the install would close the drift
warning and the failing e2e test along with the gate. That was wrong, and the
reason is structural rather than incidental.

A dev-local install carries a `-dev.local.<n>` suffix, so its version can
never equal the repository's plain `package.json` version. `rasen update`
stamps `.claude/skills/*/SKILL.md` with whichever CLI ran it, and the drift
check compares that stamp against the CLI currently running. Three versions
are in play and only two can ever agree:

| | before this session | after the install |
|---|---|---|
| global CLI | `0.1.6-dev.local` | `0.1.7-dev.local.1` |
| skill stamp | `0.1.6-dev.local` | `0.1.7-dev.local.1` |
| repo build (`bin/rasen.js`, what the e2e test spawns) | `0.1.6` | `0.1.7` |
| result | global quiet, e2e test fails | global quiet, e2e test fails |

The shape is identical, one version up: no regression, and no improvement
either. Choosing the other side — `node bin/rasen.js update`, stamping
`0.1.7` — would make the suite green and put a warning on every global `rasen`
invocation in this repository instead. The current state preserves the one
that was already in force.

Neither state affects CI: `.claude/` is gitignored, so a CI checkout has no
installed skills, `getAllToolVersionStatus` finds nothing, and the assertion
`stderr === ''` holds.

## Out of scope, found during the prose sweep

Recorded so they are not lost, and deliberately not fixed here:

- `docs/audits/rasen-codex-host-runtime-and-subagent-wait-diagnosis.md` publishes
  a host-fingerprint precedence list (`:272-279` as "current", `:340-348` as
  "recommended") that omits `CODEX_THREAD_ID` and `OMPCODE`, and a capability
  claim at `:356` that the registry has only a `canDispatch` dimension. All
  **pre-existing** — both fingerprints predate this change, which only converted
  the if-chain to a table with identical resolution. The file reads as a live
  diagnosis of a state two changes stale; it wants a superseded banner like
  `docs/codex-workflow-integration.md:3`.
- `README.md:99` and its three localized twins say audit "works on Claude Code
  transcripts and Codex rollouts" — a 2-of-3 enumeration omitting Zed, which is
  audit-capable. Pre-existing.
- `docs/cli.md` (124 KB, the canonical CLI reference) documents no `rasen agent`
  command group at all, so the refusal has no reference-doc home. Shipped
  prompts now lead the published docs on this behavior.
