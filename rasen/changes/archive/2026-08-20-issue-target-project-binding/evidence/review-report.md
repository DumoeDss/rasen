# Review report — `issue-target-project-binding` (VERIFY, reviewer-1, 2026-08-20)

Independent verifier; the reviewed delta is the uncommitted working tree on top of
`24d7f58e` (branch `feat/issue-phase3`, worktree `.claude/worktrees/issue-layer`).
Swept by claim against `proposal.md` / `design.md` / `tasks.md`, the three spec
deltas, and the parent planning context's `## Planner findings` + lesson chain.

## Verdict

**CLEAN — SHIP.** 0 Blocker, 0 Major, 0 Minor, 3 Info.
Every load-bearing claim re-verified independently (tests re-run with real exit
codes, mutations proved in an isolated copy, persistent-store receipts
re-derived live).

## Unit-test gate (re-run by reviewer; real exit codes, never piped)

dist verified fresh before CLI batches (dist mtime 18:24 > src 18:19; gate
string present in `dist/core/store/issues/reference-verification.js`).

| Batch | Files | Result |
| --- | --- | --- |
| New unit suites (`store-issue-target-project`, `issue-status-target-project-degradation`) | 2 | 8 passed, exit 0 |
| CLI suites (new `store-issue-target-project-cli` + prior `lifecycle`/`start`/`status`) | 4 | 20 passed, exit 0 |
| Family batch (`store-issue-plan-canonicalization`, `layout-migration-plan-gates`, `store-issue-scope`, `store-issue-uncommitted-reference`, `store-issue-digest-anchors`, `store-issue-layout`, `store-issue-migration-compiler`, `issue-status-projection`, `issue-status-lifecycle`, `issue-plan-publication-resolution`, `issue-plan-publication-orchestration`) | 11 | 137 passed + 1 pre-existing skip, exit 0 |
| Three-way-sync trio (`cli-presentation`, `command-registry`, `completion`, `completion-installer-i18n`) | 4 | 70 passed + 1 pre-existing skip, exit 0 |
| Migration replay callers (`layout-migration-module`, `layout-migration-scene-bridge-e2e`, `layout-migration-mapping`) | 3 | 43 passed, exit 0 |

Total re-run: 24 files, 278 passed, 2 pre-existing skips, 0 failed, all exit 0.
Covers every src file the delta touches plus its families; the full-suite gate
stays at portfolio level per the 08-17 adjudication. `rasen validate
issue-target-project-binding` green (exit 0).

## Gate-by-gate findings

### 1. Byte-stability of Phase-2-era revisions — VERIFIED, methodology equivalent-in-force

- The pin at `test/core/store/store-issue-plan-canonicalization.test.ts:121-194`
  pins the full serialized YAML bytes AND the digest (`7382cf19…`) — the
  serialization landing site, not round-trip equality.
- The literal was derived from post-change real output, which alone would be
  weak — but it is backed by the strongest possible equivalence: the delta
  contains **zero changes** to `src/core/store/issues/plans.ts` (serializer +
  digest + `normalizePlanNodes` all byte-identical to `24d7f58e`; `git diff`
  empty), so the pre-change module IS the post-change module on this path —
  post-change pinning ≡ pre-change derivation. Pre-existing literals
  `d35cf8f0…` (line 86) and `0961437e…` (line 103) predate the change and still
  pass, independently proving the digest formula unmoved.
- Persistent store (live, read-only, reviewer-run): revision
  `rasen/issues/issue-multi-change-execution/plans/0001.yaml` sha256
  `477f89625a36a561ed7a5b5c42ca5aba2ae5603d3455321bc599702cdc079d66`
  identical before and after my own `store issue show` via the worktree CLI.
  Matches the implementer's receipt hash exactly.
- Note (expected, not a defect): my show capture from the MAIN checkout cwd
  reads `progress: 0/3 / not-started` where the implementer's worktree-cwd
  receipt reads `3/3 / run-terminal`. Same revision bytes, same node set, same
  plan digest line — the difference is the spec'd run-state visibility
  (`issue-status-projection`: "An unrelated working directory sees committed
  evidence only"); the children's outcomes are not yet committed, and the
  implementer's before/after pair was same-cwd, so their axes-equality claim is
  methodologically sound.

### 2. Membership validation on BOTH publication paths — VERIFIED, design-exact

- Gate at `src/core/store/issues/reference-verification.ts:87-101`
  (`roles.planning` false → `issue_reference_target_not_planning_member`,
  naming node, project, BOTH recorded roles, sorted planning members, and the
  `rasen store add-project` OR-widen repair). Fires before the target-line and
  committed-identity checks, for intent and change nodes alike — exactly
  design D2/D3, not a lookalike.
- Both sources provably meet it in one place: `publishPlan` →
  `verifyReferences` (`src/core/store/issues/module.ts:226,648`) with roles
  from `listProjectEntries`; the `--from-portfolio` channel hands compiled
  node inputs to the same mutation (`src/commands/store-issue.ts:866-886`),
  and portfolio node ids ARE child ids (`src/core/issue-publication/compiler.ts:54`),
  so the refusal names the child as the spec scenario requires.
- CLI-level proof on both sources: knowledge-only `--from-file` refusal and
  knowledge-only portfolio child refusal, plus the spanning-members
  publication (`alpha-child`+`beta-child` across two planning members, each
  node carrying its own project, visible in `show --json`) —
  `test/commands/store-issue-target-project-cli.test.ts:133-223`. "Spanning is
  free" is real (no cross-node project constraint exists in the code), matching
  the publication delta's "A single publication SHALL be free to carry…".
- Unknown project keeps the existing named refusal
  (`issue_reference_scope_conflict`, "no project catalog for… expected: one of
  <recorded members>") — unit test
  `test/core/store/store-issue-target-project.test.ts:163-172` and receipt
  `dogfood-temp/6`. Knowledge-only vs no-record semantics are distinct codes
  with distinct repairs, per design D3.

### 3. Node-line format change — VERIFIED, strength preserved

- New format `<nodeId> <kind> <projectId> <alias> — <obs>` matches the MODIFIED
  requirement's wording order ("identifier, kind, target project, Change alias,
  observed execution state") — `src/commands/store-issue.ts:346-348`.
- The three prior CLI suites' updated assertions are still full-line content
  strings (`g-001 change ${PROJECT} child-a — in-flight` etc.;
  lifecycle:187-190, start:425, status:172) — same `toContain` anchor strength
  as before, project interpolated, not loosened. A repo-wide sweep found no
  other assertion of the old format left behind.
- MODIFIED requirement titles byte-stable; retained scenario titles
  byte-stable. Retained scenario bodies: `issue-plan-publication` 3/3
  verbatim; `issue-status-projection` 3/4 verbatim, one intentional one-line
  widening (see Info-2).

### 4. `IssueReferenceCatalogs` shape change — VERIFIED, no un-migrated constructor

- Exactly two constructors exist repo-wide and both are migrated:
  `src/core/store/issues/module.ts:659-669` (roles from parsed catalogs) and
  `src/core/store/layout-migration/plan.ts:937-946` (frozen member set declared
  planning-eligible, with the grandfathering rationale in-code). All other
  `projectIds` hits in the tree belong to unrelated interfaces
  (`query/references.ts`, `finalization/*`, `resolution.ts:288` feeds
  `gatherReferenceEvidence`, not `IssueReferenceCatalogs`).
- Cross-worktree: every other worktree sits on pre-phase-3 branches where this
  interface change does not exist in their base; the only phase-3 siblings
  (untracked dirs in THIS worktree) construct nothing of the shape. No
  un-migrated consumer anywhere.
- The additive fixture option `knowledgeOnlyProjects`
  (`test/helpers/store-workspace-fixture.ts:53-58,173-188`) is byte-identical
  for existing callers: default path emits the exact same strings
  (`planning: true`, `knowledge: false`, `state: bound`, `boundAt:`) — verified
  against the previous literals; the knowledge-only branch additionally drops
  `boundAt` and writes `state: unbound`, used only by the new suites.
- `IssueNodeStatus` widening is compile-guaranteed single-seam: `ObservedNode`
  omits `projectId`/`targetLineId`
  (`src/core/issue-status/projection.ts:79-82`), `withLifecycle` is the only
  site that completes an `IssueNodeStatus` (both node kinds, no defaulting);
  `show --json` prints `status` wholesale so the fields ride structurally
  (`src/commands/store-issue.ts:788-797`). `list` untouched.

### 5. Persistent-store dogfood — VERIFIED read-only

- Reviewer re-ran the read live (worktree CLI, `--store issue-registry`):
  revision hash unchanged across the read (477f8962…, above); node lines now
  name the knowledge-only member `e2ee72ed-…`; the store's single member record
  is indeed `planning: false / knowledge: true / unbound` — the ground-truth
  case the design names, and the g-003 prerequisite flag is accurate.
- Receipt authenticity: `dogfood-persistent-before-human.txt:18` shows the OLD
  node line (no project); `before-json` `status.nodes` carry no `projectId`
  key (verified structurally: 3× false) while `after-json` carries it 3× true;
  axes identical (done/healthy/3/3) in both receipts.
- Refusals minted nothing on the temp store: receipt 8 shows the issue with
  `revisions: (none)` after the refusals; `$TEMP` has zero leftover
  `rasen-dogfood-target*` dirs (cleanup held); the dogfood script references
  the persistent store only in a comment stating it is never touched.

### 6. Fences — VERIFIED clean

`src/core/pipeline-registry/`, `packages/ui/**`, `src/core/templates/`
untouched; no `package.json` version movement; no new CLI command/option/locale
key (trio batch green proves no drift). Prior tests touched exactly the
declared set: the three CLI suites (assertion format only), canonicalization
(added test), layout-migration-plan-gates (added test), fixture helper
(additive option). Nothing else in `test/` moved.

### 7. Fixture-coincidence / mutation spot-checks (reviewer-run, isolated copy)

Mutations applied in a throwaway copy of the tree (junctioned node_modules;
worktree untouched), each reverted after:

- **Mutation A** — gate disabled (`if (false && !member.roles.planning)`): the
  two knowledge-only refusal tests FAIL (change-node and intent-node), the
  unknown-project test stays green. The gate tests discriminate, and the
  unknown-project regression genuinely tests the pre-existing code, not the
  new gate.
- **Mutation B** — serializer key order swapped (`contentSha256` before
  `createdAt` in `serializeExecutionPlanRevision`): ONLY the new golden byte
  pin fails; all 10 digest tests stay green. The pin covers serialization
  changes the digest literals are blind to — the uniform-change lesson guard
  is real.
- **Mutation C** — digest formula perturbed (`+ " "` on the canonical body):
  all three literal tests fail (both pre-existing witnesses + the new golden).
  Triple-pinned.

## Findings

**Blocker:** none. **Major:** none. **Minor:** none.

- **Info-1 — interface letter diverges from tasks/design wording (no behavioral
  gap).** `tasks.md` 1.1 / design D4 say the catalogs grow "each project's
  planning-role fact … `projectIds` derives from it". The implementation
  (`reference-verification.ts:34-47`) removes `projectIds` from the interface
  entirely (derived internally as `declaredProjects`) and carries full
  `roles: { planning, knowledge }` rather than a lone `planningRole` boolean —
  the fuller shape is required by the refusal text ("roles … as they are
  recorded, not half of them"). Design used "e.g.", intent fully honored; noted
  so archive sync is not surprised.
- **Info-2 — one retained scenario body widened (intentional).** MODIFIED delta
  for `issue-status-projection` adds "per-node target projects" to the THEN
  list of "Both forms agree". Title (identity label) unchanged; the edit is the
  minimal coherent coverage of the new fact carried by both forms.
- **Info-3 — cosmetic redundancy in the refusal diagnostic.** The
  not-planning-member refusal states roles and planning members twice (message
  body, then `expected`/`actual` diagnostic fields) — visible in
  `evidence/dogfood-temp/5-refusal-from-file-knowledge-only.txt`. Harmless to
  machine consumers; no action suggested.

## Numbers summary

- Reviewer re-runs: 24 files / 278 passed + 2 pre-existing skips / 0 failed /
  all exit 0; `rasen validate` green.
- Mutations: 3/3 caught by the intended tests, with clean discrimination
  (A: 2/6 fail on the gate suite's knowledge-only tests only; B: byte pin
  alone; C: all digest literals).
- Persistent store: sha256 identical across an independent read;
  receipt-vs-live node-set, plan digest, and revision hash all agree.
