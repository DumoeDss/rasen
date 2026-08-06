# Design — runtime-adapter-interface-extraction

## Context

Rasen asks three questions per runtime — how full is this session, what did it spend, how do I run a worker on it. `src/core/runtime-adapters.ts` is named as the registry that answers "which runtimes can do which", but it holds **only booleans**. The implementations live elsewhere (`src/core/claude/`, `src/core/codex/`, `src/core/token-audit/`, and inline in `src/core/agent-context.ts`), and the wiring between the two is **eighteen hand-written branch sites in seven different shapes**:

| Shape | Sites | Failure for an unhandled id |
|---|---|---|
| Implicit `else` = claude | `agent-context.ts:216`, `audit.ts:154`, `audit.ts:190` | read with Claude's field names |
| Implicit `else` = zed | `token-audit/management.ts` report validation, native-target resolution | validated against Zed's schema |
| Binary ternary over `DispatchBridge` | `execution-validation.ts:141`, `:152`, `:321-324` | wrong label, wrong install advice, **wrong binary probed** |
| Hand-copied literal array | `project-config.ts:1346`, `viewer/audit.html:219` | config key silently dropped; report rejected |
| Identity sentinel | `agent-context.ts:513-517`, `keepalive/index.ts:343-347` | value leaks into a path argument; gate silently off |
| Hand-maintained N×N table | `KNOWN_DISPATCH_ROUTES` | every cell mandatory; no partial adoption |
| Hand-copied union in another typecheck realm | `packages/ui/src/api/types.ts:341` | UI receives a value its types exclude |

Exactly one of the eighteen (`summarizeAuditResult`, via union narrowing) is protected by the type checker.

Four defects of this exact shape are **live today**, verified against real data on this machine:

1. `agent context --transcript <omp jsonl>` → `available: true, contextTokens: 0` permanently. The sniff falls to its implicit Claude default (`agent-context.ts:216`), then `sumUsage` (`:107-113`) reads `input_tokens`/`cache_read_input_tokens` while the file carries `input`/`cacheRead`/`cacheWrite`.
2. `agent audit <omp jsonl>` → a schema-valid all-zero Claude report at exit 0. `parse.ts:88,151` keys on line-level `type:"assistant"`/`"user"`; omp writes line-level `type:"message"` with the role nested. `Math.min(...[])` → `±Infinity` → coerced to `null` by the `Number.isFinite` guards, so nothing throws. The source session spent 87,848 tokens on its first request.
3. A Claude worker dispatched from a Codex host self-identifies as Codex. `agent.ts:437-443` calls `runClaudePrint` with no `env`, so `runner.ts:199` falls through to bare `process.env` and the child inherits `CODEX_THREAD_ID`/`CODEX_SANDBOX`, which outrank `CLAUDECODE` in `detectHostRuntime`.
4. `claude-opus-5` resolves to no preset in `model-presets.ts:45-57` (the match list has `opus-4`, not `opus-5`), so `resolveModelLimit` falls to 200000 against a real 1M window. A session at 170,000 prompt tokens reports 85% and `shouldHandoff: true` instead of 17%.

The pressure that forces the question now is the fourth runtime. Adding Oh My Pi's probe, audit, and dispatch capabilities in the current structure means finding all eighteen sites three more times.

Three sequencing options were weighed. **Plan B** (add the runtime first, refactor later) grows the branch count to roughly thirty before unwinding it. **Plan C** (extract each interface together with its Oh My Pi capability) makes each change self-justifying but couples an abstraction to a specific consumer. **Plan A** — extract first, add capabilities after — was chosen. Its one real cost, that the live defects wait for a large behavior-preserving change, is neutralized two ways: this change registers Oh My Pi's *session store* (recognition only, no readers), which converts defects 1 and 2 into honest refusals without implementing anything; and a temporary project-scoped learned skill covers the window until this change ships.

## Goals / Non-Goals

**Goals:**

- Make a runtime's declared capability and its shipped implementation one fact, enforced at build time in both directions.
- Replace every runtime-keyed branch site with a lookup that cannot silently select the wrong implementation.
- Fix the four live defects as consequences of the structure, not as separate patches.
- Keep every serialized value byte-identical: configuration keys, wire contracts, run-state, report schemas, CLI output, and the accepted runtime sets for probe / audit / dispatch.
- Leave adding Oh My Pi's three capabilities as "register an adapter", each a small follow-on change.

**Non-Goals:**

- Any Oh My Pi context reader, token auditor, or dispatch adapter. Recognition only.
- A keepalive cost model for any new runtime.
- Moving `src/core/claude/` or `src/core/codex/` to new paths.
- A plugin system, dynamic registration, or any runtime-configurable adapter set. Every adapter is known at compile time.
- Repairing the two typecheck-free mirrors (`viewer/audit.html`, `packages/ui/src/api/types.ts`). Declared follow-up; see D11.

## Decisions

### D1 — Two layers: a leaf declaration and a separate implementation registry

`runtime-adapters.ts` is imported by `config-keys.ts`, `config-schema.ts`, `project-config.ts`, `pipeline-registry/types.ts`, and `management-api/*`. Putting implementations in it would drag `fs`, `child_process`, and the Zed SQLite reader into every schema import, and would create a cycle (`agent-context.ts` already imports `runtime-adapters.ts`; the Claude context reader lives in `agent-context.ts`).

So the declaration stays a leaf and gains nothing that executes:

```
src/core/runtime-adapters.ts        (leaf: capabilities, host fingerprints, route rule, types)
        ▲  import type only
src/core/runtimes/{session-stores,context-readers,audit-readers,dispatch-adapters}.ts
        ▲      (the four satisfies-checked implementation maps)
src/core/{claude,codex,agent-context,token-audit}/…   (unchanged locations)
```

Rejected: one registry holding implementations (import blowup, cycle); a
`runtime-adapters/` barrel that re-exports both (same import blowup for schema
consumers, just hidden).

**AMENDED during implementation — four sibling modules, not one `registry.ts`.**
This decision originally specified a single `src/core/runtimes/registry.ts`.
`AUDIT_READERS` must import `token-audit/audit.ts`, which reaches
`token-audit/zed/database.ts` → `node-sqlite3-wasm`; measured on the dev
machine, that import alone costs **6.8 ms and 9.8 MB RSS**. One barrel would
put it on the `rasen agent context` pre-flight path, which the pipeline
machinery calls per warm-continue decision. The four modules each declare
exactly one `satisfies`-checked map, so D2's enforcement is unchanged, and a
consumer imports only the registry its operation needs. No barrel ships,
deliberately: a barrel that must never be imported is a trap.

**AMENDED — the provider↔registry import cycle is accepted, and made inert.**
This decision cites cycle avoidance as a reason for the split, but the cycle is
unavoidable for a module that both PROVIDES an implementation and CONSUMES the
map: `agent-context.ts` supplies the Claude reader and consumes
`CONTEXT_READERS`; `token-audit/audit.ts` supplies all three auditors and
consumes `AUDIT_READERS`. A Tarjan pass over all 383 `src/**/*.ts` files found
**7 pre-existing cyclic SCCs**, so this is consistent with the codebase rather
than a new hazard class. It is made inert by construction: every adapter member
is an arrow that CALLS its implementation, never a bare function reference, so
no imported binding is dereferenced during module evaluation and load order
cannot matter. That invariant is load-bearing — "simplifying" a wrapper to a
bare reference reintroduces the hazard — and is documented in
`session-stores.ts`'s header.

### D2 — `satisfies Record<DerivedTuple, Interface>` is the enforcement mechanism

The implementation maps are checked against the capability-derived unions the declaration already exports:

```ts
export const CONTEXT_READERS = { claude: …, codex: … } satisfies Record<ProbeRuntime, ContextReader>;
export const AUDIT_READERS   = { claude: …, codex: …, zed: … } satisfies Record<AuditRuntime, AuditReader>;
export const DISPATCH_ADAPTERS = { claude: …, codex: … } satisfies Record<DispatchRuntime, DispatchAdapter>;
```

**Verified with `tsc --strict`, not assumed.** A 25-line probe (kept at `<ephemeraDir>/research/satisfies-probe.ts`) reproduced the registry's derived-union machinery and confirmed both directions:

| Case | Result |
|---|---|
| every declared capability has an implementation | compiles clean |
| capability declared, implementation missing | `TS1360: Property 'codex' is missing … but required in type 'Record<ProbeRuntime, ContextReader>'` |
| implementation present, capability not declared | `TS2353: Object literal may only specify known properties, and 'omp' does not exist in type 'Record<ProbeRuntime, ContextReader>'` |

That pair of errors is the whole spec requirement "a capability with no implementation fails the build" / "an implementation with no capability fails the build". Zero runtime cost, and the declaration module stays a leaf.

Rejected: a runtime assertion at module load (fails late, in whichever command happens to import first, and only for the code path exercised); code generation (a generator is another artifact that can drift); an abstract class hierarchy (inheritance buys nothing here and makes the maps harder to read).

### D3 — Decompose into SessionStore / ContextReader / AuditReader / DispatchAdapter, not probe / audit / dispatch

A flat three-way split matching the three capabilities is the obvious decomposition and it is wrong, for reasons visible in the current code:

- Zed is auditable and has no transcript file at all — its store is a SQLite database. A flat "audit adapter" must therefore also own target recognition, which is why `resolveRuntimeKind` (`audit.ts:150-155`) grew an extension check that has no probe counterpart.
- Claude, Codex, and Oh My Pi each have **one** store read by **two** readers. Duplicating recognition per capability is how the current sniff ended up shared through `detectTranscriptKind` (`audit.ts:152`) while typed `TranscriptKind = ProbeRuntime` (`agent-context.ts:170`) — a type that structurally cannot name an audit-only runtime. That constraint disappears when recognition belongs to the store rather than to a capability.

```
        SessionStore   recognizes a target, locates the live session
       ┌──────┴──────┐
  ContextReader   AuditReader
  claude codex    claude codex zed omp*        (* follow-on)
  omp*

  DispatchAdapter   claude codex   (omp: follow-on)
```

`SessionStore.recognizes` takes a pre-read first line rather than a path, so the file is read once for the whole recognition pass instead of once per adapter.

**AMENDED — `recognizes` receives the first line LAZILY, and `DispatchAdapter`
ships no `buildInvocation`.** The recognition argument is
`{ path, firstLine }` as designed, but `firstLine` is a memoized getter: a
store that recognizes by path alone (Zed's `.db`, Codex's `rollout-*.jsonl`)
never triggers a read, which matters because eagerly reading would pull a
multi-megabyte SQLite database into a string to sniff a line it does not have.
Separately, the planned `buildInvocation` member was dropped:
`buildClaudePrintInvocation` and `buildCodexExecInvocation` take structurally
unrelated option objects and return unrelated shapes, and no call site selects
between them by runtime id (`buildCodexExecInvocation` is not called from
`src/` at all). A common field would be a contract with no consumer, forced to
`unknown` options every caller must re-narrow — reintroducing the branch it
claims to remove.

### D4 — Recognition is a first-match loop with a named fallback constant

```ts
export function detectSessionOwner(target: string, override?: RuntimeAdapterId): RuntimeAdapterId {
  if (override) return override;
  const firstLine = readFirstNonEmptyLine(target);
  for (const store of SESSION_STORE_LIST) {
    if (store.recognizes({ path: target, firstLine })) return store.id;
  }
  return SNIFF_FALLBACK_RUNTIME;   // 'claude' — a stated decision, not a trailing branch
}
```

The fallback value is unchanged, so every target that resolved to a runtime before resolves to the same runtime after — except an Oh My Pi file, which is now claimed by its own store (D8). That is the point.

**AMENDED — there are THREE exceptions, not one.** Unifying recognition also
moved Zed's extension check onto the probe path, where it never existed:
`rasen agent context --transcript <threads.db>` previously fell through the
content sniff to `claude` and failed with "No assistant usage found", and now
refuses naming `zed`. Still a non-zero exit with no occupancy fields, and
arguably mandated by the ADDED requirement since `zed` declares
`canProbeContext: false` — but it is a second declared exception to this
decision's "resolves to the same runtime after" claim, and it is untested on
the probe path. Found by verification, not by the author.

The third is the mirror image, on the audit path: `resolveRuntimeKind`
content-sniffed only `target.endsWith('.jsonl')` and answered `claude` for
every other non-database path, so `rasen agent audit ./copy-of-rollout.log`
whose first row is `session_meta` resolved `claude` before and resolves
`codex` now. A better answer, but a third undeclared departure from
"resolves to the same runtime after" — and the reason recognition now reads
targets the old audit path never opened, which is what makes an unbounded
target (a FIFO, a character device) reachable where it previously was not.
Found by review, not by the author.

### D5 — Dispatch routes derive from the adapters; the N×N table is deleted

The current 2×2 `KNOWN_DISPATCH_ROUTES` encodes a three-line rule:

```
host not dispatch-capable  → legacy-fallback
host === target            → native
otherwise                  → exec-bridge via DISPATCH_ADAPTERS[target].bridge
```

Checked against every shipped cell: claude→claude `native`; claude→codex `exec-bridge`/`codex-exec`; codex→claude `exec-bridge`/`claude-print`; codex→codex `native`. Exact match, so the derivation is behavior-preserving today and adds no cells as adapters are added — which removes the "4 → 9 cells, all mandatory" blocker from the Oh My Pi dispatch follow-on entirely.

`DispatchMode` keeps its `'unsupported'` member and gains a sparse `ROUTE_EXCEPTIONS` map, empty on arrival. Without it the derivation would have no way to say "this pair genuinely does not work"; with it, an unsupported pair is a stated exception rather than a hole.

Rejected: keeping the table and widening it per runtime (the thing being removed); dropping `'unsupported'` (loses the ability to refuse a pair, and `throwUnsupportedRoute` already exists).

**AMENDED — the per-runtime probe options were removed, not kept.** The
implementation task called for a per-adapter `probe` seam *alongside* the
existing `probeCodex` / `probeClaude` options. Keeping both forces
`resolveAvailabilityProbe` to carry a `target === 'codex' ? … : …` branch —
exactly the runtime literal this change exists to delete, and exactly the
"one named option per runtime" shape that blocks a third adapter. Six call
sites were migrated to `probe: { <target>: fn }`; no alias remains.

### D6 — Every user-facing bridge fact moves onto the target's adapter

`cliLabel`, `installHint`, `binaryEnvVar`, `defaultBinary`, and `probeAvailability()` become adapter fields. This deletes the three binary ternaries in `execution-validation.ts` at `:141`, `:152`, and `:321-324`. The third is the serious one: it routes any bridge that is not `codex-exec` to `probeClaude`, so a third bridge's preflight would check the Claude binary and pass on a machine where the actual tool is missing.

### D7 — `childEnv` on the DispatchAdapter, applied unconditionally by the runner

`runtime-adapters.ts:124-128` currently carries the obligation as prose: *"Whoever gives Oh My Pi dispatch MUST inject `RASEN_AGENT_RUNTIME=claude` into that child's environment."* A docstring cannot be enforced. The Claude adapter declares `childEnv: { RASEN_AGENT_RUNTIME: 'claude' }` and `runner.ts:199` merges `adapter.childEnv` over the inherited environment for every rasen-owned spawn.

This is a real behavior change and it fixes live defect 3. Note the asymmetry it preserves honestly: the adapter also declares `spawn: 'rasen-owned' | 'playbook-owned'`, because `codex/invocation.ts:4-8` returns argv and the orchestration playbook owns the process. Only a rasen-owned spawn can be fixed in code; pretending the two are symmetric would invent a spawn site that does not exist.

**AMENDED — `childEnv` is REQUIRED on a rasen-owned adapter, and the merge is
shared.** As first implemented this decision was only half-done, and
verification caught it: `runner.ts` read `DISPATCH_ADAPTERS.claude.childEnv` as
a hardcoded member access, and `childEnv` was an OPTIONAL interface member — so
a future rasen-owned adapter that omitted it compiled clean. That is the same
unenforceable-prose obligation this decision set out to destroy, reproduced one
level down. `childEnv` is now REQUIRED on every dispatch adapter, and typed
`RuntimeIdentityEnv<Id>` so the VALUE is pinned to the declaring runtime:
omitting it or declaring another runtime's id fails the build with `TS2322`.
The merge itself lives in one place, `bridgeChildEnv(target, inherited)`, and
every rasen-owned spawn calls it rather than reaching into an adapter.

**AMENDED AGAIN — the identity is TARGET-SCOPED, because it is inherited by
descendants, not just by the worker.** Found by review, after the amendment
above shipped. `RASEN_AGENT_RUNTIME` is an environment variable, so it reaches
the whole descendant tree, and it outranks every fingerprint. Verified:
`codex host → bridgeChildEnv('claude') → claude worker` correctly reports
`claude`, but a `codex exec` grandchild of that worker inherits
`RASEN_AGENT_RUNTIME=claude` alongside its own `CODEX_THREAD_ID` and reports
`claude` — where before this change it correctly reported `codex`. In that
grandchild `agent context --latest` reads the CLAUDE session store and reports
an unrelated transcript's occupancy as its own: the confident-wrong-number
class D8 targets, reintroduced one level down by the fix for it. The Risks
section weighed only "a worker that relied on inheriting a fingerprint" and
missed descendants entirely.

So the original asymmetry claim above is WRONG in its conclusion, though right
about the mechanism: it is true that Rasen owns no `codex exec` spawn, but it
does not follow that a playbook-owned adapter should declare no identity. What
it cannot do is APPLY one. `childEnv` is therefore required on BOTH arms —
`spawn` now says only WHO applies it — `bridgeChildEnv` merges the target's
identity unconditionally so no ancestor's value can stand, and
`CodexExecInvocation` carries an `env` field that `formatShellInvocation`
renders as a leading `RASEN_AGENT_RUNTIME=codex` (`set "…" &&` on Windows) so
the playbook-owned spawn applies its own. The shipped orchestration playbook
states it as a non-negotiable invariant beside the stdin redirect.

Verification also found a SECOND rasen-owned Claude worker that bypassed the
fix entirely: `management-api/supervisor.ts` spawns `claude -p` for workflow
skills with `env: process.env`, and `daemon.ts` gives the daemon its launching
shell's environment — so a daemon started from a Codex session handed every
Claude worker a Codex identity. This decision named only `runner.ts`, and the
task-3.8 audit enumerated runtime LITERALS rather than SPAWN SITES, which is
why neither caught it. Both sites now go through `bridgeChildEnv`.

### D8 — Register the Oh My Pi session store now, with no readers

The zed-shaped move, one level down. Registering `recognizes` (first line is `{"type":"title",…}`; second is `{"type":"session","version":3,…}`) without registering any reader means:

- `agent context --transcript <omp jsonl>` → recognized as `omp`, no `ContextReader` → refusal naming the harness. Live defect 1 closed.
- `agent audit <omp jsonl>` → recognized as `omp`, no `AuditReader` → refusal before any report is written. Live defect 2 closed.

No capability boolean flips, so `PROBE_RUNTIMES`, `AUDIT_RUNTIMES`, `DISPATCH_RUNTIMES`, every config enum, and every wire contract stay byte-identical. `test/core/config-keys.test.ts:475` (`toEqual(['claude','codex'])`) must remain untouched — a diff there means a capability was flipped by mistake.

`SessionStore.locateLatest` for Oh My Pi is deliberately **not** implemented in this change: it is genuine domain work (two coexisting bucket-naming schemes on disk, terminal breadcrumbs for live-session identification) and belongs with the reader that needs it.

### D9 — Implementation directories stay where they are

`src/core/claude/`, `src/core/codex/`, `src/core/token-audit/`, `src/core/agent-context.ts` keep their paths. The registry is a new file that imports them. Moving them into `src/core/runtimes/<id>/` would touch every import in the repo for no behavioral gain; it can happen later, or never.

### D10 — Host fingerprints become an ordered data table

`detectHostRuntime`'s if-chain becomes `HOST_FINGERPRINTS`, an ordered array of `{ envVar, runtime, source }` carrying the existing precedence rationale as its comment. Same resolution order, same results. Two payoffs: precedence becomes table-testable, and a future "why did you detect this host" diagnostic becomes trivial — worth noting because nothing outside `rasen pipeline show` currently names the detected host to a user.

### D11 — The two typecheck-free mirrors are out of scope, and want different fixes

`viewer/audit.html` and `packages/ui/src/api/types.ts` are separate typecheck realms; no interface in `src/core` reaches them. They also want *different* repairs, which is why bundling them here would be one change doing two things:

- **UI mirror** (`types.ts:341`) — relax the hand-maintained union before the server widens, per the project's `management-api-wire-mirror-field-relaxation` rule, plus a parity test against `AUDIT_RUNTIMES`.
- **Viewer** (`audit.html:219`, `:372-384`) — the right fix is to *delete* the allow-list, accept any report carrying the `rasen-token-audit/2` schema tag, and give the render dispatch an explicit unknown-runtime arm. That makes the viewer forward-compatible so no future runtime touches it at all — a contract change, not a list edit.

Both are declared follow-ups of the audit capability change, where they first matter.

**AMENDED — there was a THIRD mirror, and this change broke it.**
`packages/ui/src/config/controls.ts` hand-maintains `KNOWN_MODEL_IDS` as a
mirror of `MODEL_PRESETS`, so adding `opus-5` (D14) left the UI suggesting the
PREVIOUS Opus generation and omitting the current one — on the very change
whose point is that `opus-5` is current. Its own parity test is one-directional
(mirror → preset, never preset → mirror) and `packages/ui` sits outside the
root vitest include, so the drift was doubly silent. Fixed here rather than
deferred, because unlike the other two this one was CAUSED by this change.
Found by verification, not by the author. The one-directional parity test
remains a hole and joins the follow-up list.

### D12 — This change ships alone; the capability additions follow

```
THIS CHANGE   interface extraction + 4 live-defect fixes + omp recognition
     ↓
  next        omp SessionStore.locateLatest + ContextReader        (probe)
     ↓        └─ must land with, or immediately after, the audit reader:
  next        omp AuditReader                                      (audit)
     ↓           recognition already routes omp away from the Claude auditor,
     ↓           so the two are no longer forced into one change by the sniff
  later       omp DispatchAdapter (+ keepalive decision)           (dispatch)
```

Recognition (D8) is what decouples the probe and audit follow-ons. Before it, adding an Oh My Pi format branch would have made `kind === 'omp'` fall into the Claude auditor's default arm, forcing both readers into one change.

### D13 — Archive ordering: `detect-omp-host-runtime` first

`detect-omp-host-runtime` is complete but not archived, so its delta specs for `runtime-adapter-registry`, `cli-agent-context`, and `opsx-pipeline-registry` have not merged into `rasen/specs/`. This change's `MODIFIED` requirements are written against the **post-merge** text. Archive `detect-omp-host-runtime` before archiving this change, or the modified requirements will silently revert its wording.

### D14 — The `opus-5` preset rides along

One line in `model-presets.ts`, and the same defect class: a hand-maintained list that produces a confident wrong number instead of an error. It affects the Claude probe too, not only Oh My Pi — any session on the current Opus generation. Its test lives in the same suite as the other probe assertions, so separating it would cost more than it isolates. Ground truth: Oh My Pi's own model cache reports `contextWindow: 1000000` for `claude-opus-5`, `anthropic/claude-opus-5`, and `claude-sonnet-5`. Matching is case-insensitive substring first-match, so adding `opus-5` covers the provider-prefixed id as well.

**AMENDED — the same list carried the mirror-image defect, and this change
edited the line it lived on.** Found by review. `opus-4` sat in the 1M bucket,
and matching is case-insensitive substring first-match, so it swallowed every
Opus 4.0 / 4.1 / 4.5 id — which the SAME model cache this decision cites
reports at `contextWindow: 200000`, consistently across `anthropic`,
`google-vertex` and `zenmux`; only 4.6 and later are 1M. Executed against the
build: `resolveModelLimit('claude-opus-4-5-20251101')` returned 1,000,000, so a
190k session reported 19% occupancy instead of 95% and `shouldHandoff` stayed
false. That is the same defect class in the more damaging direction — `opus-5`
failed CLOSED (a handoff that was not needed), `opus-4` failed OPEN (no handoff
before the window overflows). Pre-existing rather than introduced here, but on
the edited line and contradicted by the source consulted while editing it, so
it is fixed here: the 1M families are enumerated (`opus-4-6`, `opus-4-7`,
`opus-4-8`, `opus-5`, …) and a trailing `{ match: ['opus-4'], contextWindow:
200_000 }` entry catches the rest. First-match order is now load-bearing and
says so in the code.

Not fixed: the `gpt-5` preset's 272,000 matches only the `bedrock-mantle`
variants — `zenmux/openai/gpt-5` is 400,000 and `gpt-5.4`/`5.5`/`5.6` are
1,050,000. Which provider surface a preset describes is a product decision, not
a defect, and is left open.

### D15 — A temporary learned skill covers the window before this change ships

The live defects exist now, and Plan A means they are fixed when this change lands rather than immediately. A project-scoped learned skill records the four defects, how to recognize them, and the safe workaround, so any agent working in this repository in the meantime does not trust a fabricated zero. It is a stopgap with a stated end: once this change ships in `v0.1.7` and the fixed behavior has been observed, the skill is retired with `rasen knowledge retire`. Its retirement is the final task of this change, deliberately gated on observation rather than on the merge.

## Risks / Trade-offs

- **A "behavior-preserving" refactor that is not** → The serialized surfaces are the contract. Verification is: no diff in `test/core/config-keys.test.ts:475`, in the derived-tuple assertions (`test/core/runtime-adapters.test.ts:49-53`), or in any wire/schema snapshot. Four behavior changes are intended and each is named in the specs (defects 1–4); anything else is a bug in the refactor.
- **The route derivation is subtly wrong for a pair nobody tests** → Every shipped pair is pinned by `test/core/runtime-adapters.test.ts:161-171`'s `it.each` table. Keep that table exactly as it is; if derivation is right, it passes unchanged. It is the single best oracle for D5.
- **`childEnv` breaks a worker that relied on inheriting a fingerprint** → The injected key is `RASEN_AGENT_RUNTIME`, which is Rasen's own override and outranks all fingerprints by design. No existing worker sets it. Every other inherited value is untouched, and the spec pins that.
- **The refusal is a hard error where callers expected a number** → `tryContextEstimate` must return absence, not zero, and its pipeline caller (`pipeline.ts:959-962`) already handles absence. The spec scenario pins "distinguishable from an estimate of zero occupancy" precisely because zero is the current wrong answer.
- **Locale and shipped-prompt drift** → Three catalogs assert route and refusal facts in prose; four workflow templates state the route matrix and the probe refusal, and editing any of them moves a hand-computed SHA-256 baseline in `test/core/templates/skill-templates-parity.test.ts`. Budget the regeneration; do not discover it at the end.
- **Delta-spec revert if archived out of order** → D13. Mitigated by making the archive order an explicit task.

## Migration Plan

No data, configuration, or schema migration. Existing reports, run-state files, pipeline configurations, and global/project config load unchanged.

Rollback is a revert: nothing persisted changes shape, so a reverted build reads everything a shipped build wrote.

Deployment order within the change: extract the declaration types and the interfaces first, then register the existing implementations one capability at a time so each `satisfies` map compiles before the next is added, then delete the branch sites the maps replace, then the four defect fixes, then copy and docs.

## Open Questions

1. **`SessionStore.recognizes` input** — first line plus path is enough for Claude, Codex, and Oh My Pi (content signature) and for Zed (extension). Does any future store need more than the first line? If so, the pass becomes "read up to N lines once" rather than "read the first line once".
2. **`--dir` / `--projects-dir` semantics per store** — today documented as the Claude projects directory and silently reused as the Codex sessions root (`agent-context.ts:457`). Giving each store its own `rootLabel` makes the help text honest but changes a user-visible flag contract, so it is deliberately not part of this change.
3. **Should `AuditReader` declare its report shape?** Declaring `reportShape` would let the viewer and the management validator dispatch from the registry, reaching the two typecheck-free realms. It also duplicates information the `AuditResult` union already carries. Resolve when D11's follow-up lands, not here.
4. **Keepalive gating** — `isRuntimeGated` keys on runtime id, not capability. It is left exactly as-is by this change (the fail-safe holds), but its docstring at `keepalive/index.ts:250-264` states a rationale that the Oh My Pi dispatch follow-on will falsify. Correct the docstring then, or decide the cost model then; not both now.
