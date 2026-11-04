## 1. Plan-node lifecycle schema

- [x] 1.1 Extend `src/core/store/issues/types.ts` and `plans.ts`: optional
  `lifecycle` (`required | optional | cancelled | superseded`) on change
  nodes only, conditional `reason` (min 1, `assertPortableIssueText`),
  refused when absent for `cancelled`/`superseded`, undefined values refused
  naming the four; intent nodes carry neither field
- [x] 1.2 Canonicalization + digest stability: explicit `required`
  normalizes to absent; serializer and `executionPlanDigestBody` omit
  `lifecycle`/`reason` when absent (the `changeAlias` pattern) — a
  g-001-shaped revision re-derives its published digest
- [x] 1.3 Schema unit tests: absent ≡ required; cancelled/superseded without
  reason refused; non-portable reason refused at schema; out-of-vocabulary
  value refused naming the four; explicit-required ≡ absent normalization;
  digest pin over a g-001-shaped fixture revision

## 2. Projection

- [x] 2.1 `src/core/issue-status/`: carry each node's lifecycle into
  `IssueNodeStatus`; progress filters both numerator and denominator to
  required nodes, reporting `0/0` for a readable plan with no required nodes
  (still `null` for an unreadable one)
- [x] 2.2 Phase: active/ready signals from wanted nodes (`required` +
  `optional`) only; review condition over required change nodes + no intent
  node; cancelled/superseded recorded activity drives no phase
- [x] 2.3 Health: failure/wait signals from wanted nodes only; cancelled/
  superseded escalations are history
- [x] 2.4 Projection unit tests: optional completion uncounted; 0/0 plan;
  optional in flight beside all-required-terminal → review; cancelled stale
  in-flight run-state drives no phase; failed optional → failed health;
  cancelled failure → history

## 3. Acceptance gate

- [x] 3.1 `src/core/issue-acceptance/`: un-terminal blockers over required
  nodes only; cancelled/superseded exclusions (node, lifecycle, reason)
  reported beside the gate; eligible-at-zero-required states that no work is
  demanded; required-scoped gate snapshot (0/0 coherent)
- [x] 3.2 Gate unit tests: unfinished optional never blocks; cancelled
  exclusion with reason shown; superseded reason naming successor; zero-
  required eligibility with exclusions named; failed-health blocking
  unchanged

## 4. Launch binding

- [x] 4.1 `src/core/issue-execution/`: frontier candidates filtered to wanted
  nodes; `--node` on cancelled/superseded refuses with new refusal kinds
  naming lifecycle + recorded reason (fix hints wired)
- [x] 4.2 Binding unit tests: cancelled refused at start; superseded refused
  at start; frontier never names a cancelled node; optional launches like
  required

## 5. CLI renders and surface checks

- [x] 5.1 `src/commands/store-issue.ts`: show node lines carry lifecycle
  (with reason for cancelled/superseded); gate render shows exclusions beside
  blockers; start refusal renders; `--json` parity for every new fact; list
  progress pair unchanged in shape (already required-scoped by 2.1)
- [x] 5.2 CLI tests: show human/JSON parity incl. lifecycle + exclusions;
  start refusals; no new options — assert the three-way-sync trio verifies
  UNCHANGED (cli-presentation structure, command-registry, locales catalog:
  zero diff expected, gate log records it)

## 6. Dogfood and evidence

- [x] 6.1 Temp store per the trap list (OS temp, main rename, layoutVersion 2
  handwritten, add-project double-clear); seed three committed children;
  author portfolio run-state; publish revision `0001` via
  `--from-portfolio`
- [x] 6.2 Publish `0002` via `--from-file` with one node `cancelled` (reason)
  and one `optional`; verify `0001` bytes unchanged; progress re-scoped;
  gate report shows the exclusion with reason; `start` refuses the cancelled
  node; record receipts under `evidence/`
- [x] 6.3 Teardown: temp store fully removed, no registry/config residue

## 7. Verification and closeout

- [x] 7.1 `pnpm run build`; focused suites: store/issues plans, issue-status,
  issue-acceptance, issue-execution, store-issue CLI, the M-1 pin test green
  untouched
- [x] 7.2 Child-level gate: affected suites + store family + three-way-sync
  trio (expect zero diff) per portfolio lesson 9; any full-suite reds fully
  enumerated and classified against the known machine cluster
- [x] 7.3 `rasen validate issue-node-lifecycle` green (positional form);
  MODIFIED scenario titles verified byte-stable against the synced specs;
  update `architecture-index` only if module responsibilities shifted (they
  should not — no new modules)
