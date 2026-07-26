## 1. Canonical Direction Skill

- [x] 1.1 Add the approved `development-guide.md` under `rasen/work/direction-workflow/` unchanged in meaning, preserving its opt-in, Target State, evidence, and Phase 1 boundaries.
- [x] 1.2 Add the canonical `rasen-direction` `SkillTemplate` with shared Store/project selection guidance, CLI-resolved planning-root discovery, safe cross-platform references, explicit action routing, and a missing-workstream success/repair path.
- [x] 1.3 Encode the experimental workstream/artifact authority contract, `target-state.md` versus `rasen-goal` distinction, legacy `goal.md` read-only compatibility, source-of-truth boundaries, approval points, and final one-next-action report in the skill or an installed built-in sidecar.
- [x] 1.4 Implement the Establish and Calibrate instruction branches, including duplicate discovery, optional North Star, draft-before-activation, observable-baseline checks, and confirmation for material Target State revisions.
- [x] 1.5 Implement the Select, Project, and Reconcile instruction branches, including one active Slice, evidence-bearing acceptance, propose/auto-decompose handoff, no implementation by Direction, honest result states, stale-state health checks, terminal workstream states, and North Star write protection.

## 2. Built-in Discovery and Routing

- [x] 2.1 Export and register workflow id `direction` / skill `rasen-direction` through the existing template facade and built-in workflow catalog without adding it to `CORE_WORKFLOW_IDS`, a pipeline, or `WORKFLOW_CHAIN`.
- [x] 2.2 Add non-empty English, Japanese, and Simplified Chinese profile-picker names and descriptions for `direction`, then update the built-in catalog shape fixture.
- [x] 2.3 Update `rasen-help` to route explicit long-horizon direction, slice-selection, and reconciliation needs to `rasen-direction` while preserving direct Change and `rasen-goal` routing.
- [x] 2.4 Update `rasen-navigator` with an optional long-horizon Direction entry outside the mandatory main line and a concise Target State versus goal-loop distinction.

## 3. Contract and Integration Tests

- [x] 3.1 Add focused template tests that pin all five actions, artifact names/status values, authority/source-of-truth rules, legacy compatibility, confirmation boundaries, Project handoffs, evidence-backed reconciliation, terminal states, and byte-preserving North Star protection.
- [x] 3.2 Extend catalog/profile/localization tests to prove `direction` is generated for full and explicit custom selections, omitted from core, and described in all three locale catalogs.
- [x] 3.3 Extend init/update generation tests with temporary, `path.join`-constructed paths to prove selecting Direction installs only `rasen-direction/SKILL.md` and that ordinary init/update create no `rasen/work/` or Direction artifacts on Windows-compatible path semantics.
- [x] 3.4 Add Direction to workflow-template function/generated-content parity maps and generated-workflow cross-reference coverage, recomputing hashes from canonical rendered output and leaving unaffected hashes unchanged.
- [x] 3.5 Add regression assertions that Direction is absent from the main workflow-chain table and that ordinary propose/auto/goal templates do not acquire a Direction prerequisite or implicit handoff.

## 4. Honest Dogfood and Verification

- [x] 4.1 Build the CLI, generate the installed skill through the normal update/generation path in an isolated temporary project, and inspect the rendered skill plus any sidecars rather than editing generated output.
- [x] 4.2 Use the implemented Direction contract to establish the real `direction-workflow` workstream with a thin manifest, Target State, Roadmap, and initial Slice artifacts; record only observed build/test/generation evidence and keep the Result `partial` while review, PR, merge, or other acceptance evidence is still pending.
- [x] 4.3 Run a fresh-agent/read-only discoverability check against the dogfood artifacts, confirming it can identify the authority chain, sole active Slice, evidence status, unresolved acceptance, and one next action without chat history; record the observed result without manufacturing delivery evidence.
- [x] 4.4 Run the focused Direction, workflow-registry, profile/localization, init/update, workflow-chain, router, and template-parity test suites, then run `pnpm build`, `pnpm lint`, and the repository test suite; document any platform coverage delegated to CI for macOS/Linux.
