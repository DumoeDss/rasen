## Context

E1 made `rasen bootstrap` report the whole gap, E2 made it register, and E3 made it obtain from remotes. Together they made the repair the rest of the CLI has been pointing past: every command that fails on a declared Store still tells the user to run one narrow repair (`rasen store register <path>`), discover the next gap, and repeat. The command that would close the whole gap in one run now exists. This change makes the failure text say so, and gives `rasen doctor` a read-only section that reports the same gap in one place.

The invariant is **read-only**: E4 changes what commands **say** when they fail, never what they **do**. No command that failed before will succeed after this change; no command that succeeded will change behavior. The registry, the Store metadata, and every checkout are untouched.

Dependency state: **E1, E2, and E3 are all shipped and review-clean.** Their delta specs are frozen (none archived; the branch is unmerged). This change adds one requirement to the `store-bootstrap` capability and claims no new capability.

## Goals / Non-Goals

**Goals:**

- Every command that fails on a declared Store names `rasen bootstrap` as the repair where bootstrap can actually repair — and does not name it where it cannot.
- The printed repair is pasteable and unambiguous, reusing E1's selector rule.
- `rasen doctor` gains a read-only bootstrap-readiness section composed from facts it already gathers.
- The seam F4 (knowledge-bundle-prepare-integration) extends is explicit and documented.

**Non-Goals:**

- Changing what any command does on failure. The exit codes, the zero-write guarantee, and the failure taxonomy are E1/child-A's settled contract.
- Re-litigating the repair vocabulary child A built (`store-identity`'s "every unavailable-Store failure carries a copy-pasteable repair"). That the repair string becomes `rasen bootstrap` satisfies that contract; it does not amend it.
- The knowledge-bundle readiness F4 will add. The structure is designed for it; the data is not gathered here.
- Modifying the bootstrap command itself, its modes, or its output. E1/E2/E3 own those.

## The architectural finding — the breadth is in the tests, not the source

The LEAD's seed estimated ~8–12 command sites. The codebase says otherwise. **Every command that resolves a declared Store funnels through one pair of functions:**

- `primaryRepair(binding)` — the first repair command, shown in one-line messages.
- `describeUnavailableStore(binding)` — the full failure line, ending with `Next: ${primaryRepair(binding)}`.

Both live in `src/core/store/identity.ts`. The repair arrays they read are built in two places:

1. `src/core/store/identity.ts` — the `unavailable(...)` constructor, called for each `StoreUnavailableReason`. For the `not-registered` reason, the array today is `[registerRepair(expected), doctorRepair()]` — "register this path, or see doctor." For identity-mismatch, root-unhealthy, alias-ambiguous, and malformed-pointer reasons, the array names `rasen store doctor` and `rasen doctor`.
2. `src/core/store/identity-diagnostics.ts` — the `registerRepair(label)` and `storeBootstrapRequired(label)` factories that produce the strings inside those arrays.

Every consuming surface reads through these:

- `src/core/root-selection.ts` (550, 557, 563, 569, 620) — `primaryRepair` for root-selection errors and the `unavailable-store-declaration` notice that `pipeline.ts`, `store.ts`, `config.ts`, `context.ts`, `work.ts`, `show.ts`, `validate.ts`, and the `workflow/*` commands surface.
- `src/core/effective-config.ts` (200, 202) — the `StoreError` every config-reading command raises.
- `src/core/learned-skills/{context,stores}.ts` — learned-skills resolution.
- `src/core/store/{membership,migration-ops}.ts` — membership and migration surfaces.
- `src/core/config-api/project-addressing.ts` (107) — the config API.

**None of these consumers build their own repair text.** They call `primaryRepair` or `describeUnavailableStore`, which read the array the resolver built. So changing the repair text where bootstrap can repair is a change to **two files** (the resolver and its diagnostic factory), and every command that resolves a Store inherits it.

The breadth the estimate assumed is real, but it lives in the **test surface**: each consuming path needs a test proving the new repair text reaches it. Those tests are how the spec's "every ordinary command" claim is proven without editing every command.

## Decisions

### D1 — Repair ordering: bootstrap first where bootstrap can repair; doctor elsewhere

The `not-registered` reason is the one bootstrap actually closes — it registers, obtains, and prepares. Its repair array becomes `[bootstrapRepair(expected), registerRepair(expected), doctorRepair()]`: bootstrap first (the whole-gap repair), the single-step `register` second (for the user who wants exactly one step), and `doctor` last (for diagnosis).

The reasons bootstrap **cannot** repair keep their existing repair arrays, unchanged:

- `uid-mismatch` — bootstrap cannot fix a checkout carrying the wrong identity. The repair stays `rasen store doctor <id>`.
- `root-unhealthy` — bootstrap cannot repair an unhealthy Rasen root. Stays `rasen store doctor`.
- `alias-ambiguous` — bootstrap cannot pick between two Stores sharing a name. The repair keeps the `<identity>` placeholder.
- `metadata-missing` / `metadata-error` — bootstrap does not create or repair Store metadata. Stays `rasen store doctor`.
- `pointer-malformed` — bootstrap does not rewrite a project declaration that is malformed. Stays `Edit <filePath>` + `doctor`.

This is the distinction the spec draws: name bootstrap where it can repair, and do not name it where it cannot. Naming bootstrap for a mismatched identity would be the exact failure mode the spec forbids — a hint that fails when pasted.

### D2 — `bootstrapRepair` factory and the unambiguous selector

A new `bootstrapRepair(label)` factory in `identity-diagnostics.ts` produces `rasen bootstrap`. It does NOT carry a selector suffix today, because bootstrap resolves against the current project (it reads the project's own declarations). The unambiguous-selector rule applies to the **Stores bootstrap names in its output**, not to the `rasen bootstrap` command itself — the command takes no Store argument.

The selector rule becomes load-bearing in one place: when the **diagnostic** that accompanies the repair names a Store (the `store_bootstrap_required` diagnostic), its message and fix continue to use `describeStore(label)`, which already renders the identity alongside the name when both are known. The repair command itself (`rasen bootstrap`) is selector-free.

### D3 — The `store_bootstrap_required` diagnostic fix becomes bootstrap

`storeBootstrapRequired(label)` today sets `fix: registerRepair(label)`. E4 changes the fix to `fix: bootstrapRepair(label)`, because the diagnostic fires in exactly the state bootstrap was built to close. The single-step `registerRepair` remains in the repair array (D1) for the user who wants it; the diagnostic's one-line `fix` is the whole-gap repair.

### D4 — Doctor readiness: composed from existing facts, no new I/O

The bootstrap-readiness section is **pure composition** over facts doctor already gathers: the resolved-or-unavailable Store binding, the membership findings, and the machine-home registration. Doctor already reads all of these through `gatherHealth`. The readiness section is derived from them by the same `inspectRelationships` function that builds the rest of the health report — it performs no I/O of its own.

This keeps the read-only guarantee structural rather than behavioral: the readiness section cannot write because it is composed from inputs a function that does not write received. The same way `membership` is structured today.

Concretely, `inspectRelationships` derives a `bootstrapReadiness` result from:
- `input.storeBinding` — resolved vs. unavailable (the planning Store's state).
- `input.membership` — confirmed vs. not-recorded vs. unverifiable.
- `input.machineHomeEntry` — the current checkout is registered.

Each missing fact becomes a finding with a stable code and a copy-pasteable repair (`rasen bootstrap`, or the specific single-step repair when bootstrap cannot close that gap). The section's end state is one of `complete`, `degraded`, or `blocked` — the same three states bootstrap itself reports, so doctor and `bootstrap --check` agree by construction.

### D5 — The F4 seam: extend `bootstrapReadiness.findings`, not the composition

F4 (`knowledge-bundle-prepare-integration`) extends doctor's readiness to cover knowledge-bundle preparation. The seam is:

- `InspectRelationshipsInput.bootstrapReadiness` is an optional `BootstrapReadinessInput` carrying the per-check facts the readiness composer needs.
- `RelationshipHealth.bootstrapReadiness` is the composed output: `{ state, findings }`.
- F4 adds knowledge-bundle facts to the **input** (a new optional field, gathered from the knowledge home D2 built) and the composer extends its derivation to include them. The output shape does not change — F4's findings join the same `findings` array under the same three-state result.

This means F4 does not re-design the section. It adds one input field, one gathering call (the knowledge-home probe), and extends the composer's switch to cover it. The `state` semantics stay: `complete` only when every check — including the new knowledge-bundle one — passes.

The input shape:

```
bootstrapReadiness?: {
  storeBinding: <the resolved-or-unavailable planning Store binding>;
  membership: <the membership health>;
  machineHomeRegistered: boolean;
  // F4 extends here: knowledgeBundlePrepared?: boolean;
}
```

The output shape:

```
bootstrapReadiness: {
  state: 'complete' | 'degraded' | 'blocked';
  findings: Array<{ code: string; severity: 'error'|'warning'|'info'; message: string; repair: string }>;
}
```

### D6 — Zero concurrent-session file overlap (verified)

Two concurrent sessions are active in this tree. The analysis:

**Pipeline-registry session** owns: `src/commands/pipeline{,-messages}.ts`, `src/core/pipeline-registry/**`, `src/core/{keepalive,runtime-adapters,codex,management-api,templates}/**`, `src/cli/index.ts`, and their tests. **UI session** owns: `packages/ui/**`, `rasen/config.yaml`.

E4's source-edit set is:

1. `src/core/store/identity.ts`
2. `src/core/store/identity-diagnostics.ts`
3. `src/core/relationship-health.ts`
4. `src/commands/doctor.ts`
5. `src/commands/shared-gather.ts`
6. `src/locales/{en,zh-cn,ja}.json`
7. `docs/cli.md`

**None of these appear in either concurrent session's modified set** (verified against `git status --porcelain`). The pipeline commands (`pipeline.ts`, `pipeline-messages.ts`) consume the resolver's output through `notice.repair` and inherit the new repair text without any edit — which is the architectural finding D1 relies on. **E4 has zero file overlap with either concurrent session.** No deferrals are needed.

### D7 — Spec surface: ADD only, no MODIFIED blocks

E4 adds one requirement to `store-bootstrap`. It does not modify any requirement E1, E2, or E3 shipped — their scenarios are frozen and preserved verbatim. The repair-text change in the resolver is an implementation detail that satisfies child A's existing `store-identity` contract (every unavailable-Store failure carries a pasteable repair); it does not amend that contract, following the same reasoning E's design D1 established.

## Risks / Trade-offs

- **Naming bootstrap for a state it cannot repair misleads the user.** → The repair array is chosen per-reason: bootstrap first for `not-registered` (where it closes the gap), the existing `doctor` / single-step repair retained for every identity-level failure. The spec forbids naming bootstrap for a mismatched identity, and the implementation matches by construction.
- **Doctor's readiness section drifts from bootstrap's check-mode output.** → Both compose from the same facts (the resolved Store binding, membership, registration). The "Diagnosis and bootstrap agree" scenario is the structural guard: a test asserts the two name the same Stores as missing.
- **A consumer surfaces a stale repair string because it cached or rebuilt one.** → No consumer rebuilds; all read `primaryRepair(binding)`. The test surface covers each consumer path to prove the new text reaches it.
- **F4 re-designs the readiness section instead of extending it.** → The seam (D5) is documented here as the input/output contract F4 inherits. F4 adds an input field and extends the composer; it does not restructure the output.

## Migration Plan

1. **Repair text.** The `bootstrapRepair` factory and the reordered repair array land first. Every command inherits the new text immediately; no consumer edit is needed.
2. **Doctor readiness.** The composed section and its rendering land together, behind the existing `doctor` command.
3. **Locales and docs.** The new doctor section's strings and the troubleshooting entries land last.

Rollback: reverting removes a repair-string change and a read-only doctor section. No command changes behavior; no data becomes unreadable.

## Open Questions

None. The architecture funnels through one resolver pair, the concurrent-session overlap is zero, and the doctor-readiness seam is the only interface F4 consumes.
