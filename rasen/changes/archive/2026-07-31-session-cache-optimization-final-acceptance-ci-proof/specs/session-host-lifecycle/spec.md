## MODIFIED Requirements

### Requirement: Native delivery evidence is bound to one exact repository commit
Final cross-platform acceptance SHALL be recorded only after explicit parent authorization of the single portfolio delivery. A controlled parent entrypoint SHALL freeze and later recompute the exact audited tracked delivery index/tree, excluding the pre-existing untracked `packages/ui/package-lock.json` and every incidental untracked file, and SHALL prove that the delivered commit contains that exact tree. The evidence SHALL bind the final candidate, delivery SHA, GitHub target repository, workflow run, and required jobs. Result-bearing physical and CI evidence SHALL live outside the tested repository commit. Local evidence SHALL continue to describe only native-Windows and injected-POSIX execution and SHALL NOT be promoted into a native-Linux claim; native Linux completion SHALL instead require both successful canonical CI state and successful current exact-SHA CI evidence containing every required job.

#### Scenario: Exact candidate is the tracked delivery tree
- **WHEN** repository-local fixes, clean review, task/spec/local-delivery/archive state, and parent repository mutations are complete
- **THEN** the controlled entrypoint persists the normalized repository root, original frozen baseline SHA, delivery-manifest fingerprint, tree/content/binary fingerprints, complete tracked delivery index/tree, and explicit path/blob/mode manifest, rejects forbidden or omitted paths including every package lock, excludes incidental untracked files, and writes a candidate-freeze record without fabricating an attempt, arm result, or canonical acceptance ledger

#### Scenario: Missing parent authorization prevents remote delivery
- **WHEN** local closure or physical acceptance completes without explicit parent portfolio-delivery authorization
- **THEN** the external ledger remains awaiting authorization and no child pushes, opens a PR, triggers remote CI, or claims native evidence

#### Scenario: Controlled delivery proves the commit tree
- **WHEN** the parent authorizes the single portfolio commit and push or PR
- **THEN** the same controlled entrypoint compares the full persisted candidate identity, derives delivery recording from the persisted original baseline rather than a moving `HEAD`, recomputes the frozen tree, creates or accepts the delivery SHA only when `git show <sha>^{tree}` equals that tree, and records authorization and delivery externally

#### Scenario: Existing CI proves the exact delivered SHA
- **WHEN** the delivered repository's existing GitHub workflow runs
- **THEN** the accepted workflow target repository, GitHub origin, exact URL path segments, run ID, run attempt, run URL, and `head_sha` exactly match the controlled delivery record

#### Scenario: Every required job belongs to that workflow run
- **WHEN** required native job evidence is collected from actual GitHub workflow-jobs REST records that do not contain a fabricated `job.repository` field
- **THEN** repository identity is derived from exact `run_url` path segments and each exact named job has the same `run_id`, `run_attempt`, `run_url`, `head_sha`, target repository, job URL origin, and successful conclusion as the selected workflow; numeric-prefix collisions, attempt splices, inconsistent URLs, and caller-enriched substitutes cannot satisfy the gate

#### Scenario: Successful exact-SHA CI closes native Linux separately from local proof
- **WHEN** selected physical evidence and controlled delivery are complete, canonical local evidence remains `nativeLinux: false`, the canonical run records successful CI state, and the current exact-delivered-SHA CI document contains the successful workflow plus all five required native jobs
- **THEN** final acceptance treats native Linux as proven by that matching CI state and document, revalidates the local records without changing their platform claims, and may complete when every other final gate also passes

#### Scenario: Incomplete CI cannot borrow a local platform claim
- **WHEN** CI is pending or failed, its current document is missing, mismatched, or incomplete, or any required exact-SHA job is absent or unsuccessful
- **THEN** final acceptance remains incomplete even when all local gates pass, and no local native-Windows or injected-POSIX claim substitutes for native Linux CI

#### Scenario: Evidence recording does not change the tested commit
- **WHEN** physical or native CI conclusions become available
- **THEN** they advance only the canonical external ledger or immutable SHA-keyed CI artifact without a repository commit, task-box edit, archive mutation, or other change to the tested tree

#### Scenario: Substitute platform or commit evidence is rejected
- **WHEN** evidence comes from a partial child push, a different tree or SHA, WSL or container emulation, injected platform behavior, another GitHub repository, or a run missing any required named job
- **THEN** it may support local diagnostics but cannot close native exact-tree acceptance

#### Scenario: Superseded candidate resets CI and final bindings
- **WHEN** a candidate is superseded before final acceptance
- **THEN** its CI record is archived as history, current CI success is invalidated and atomically reset to pending, and the final gate requires exact agreement between `run.ciState`, the current CI document, candidate tree, physical results, full frozen identity, delivery SHA/tree, workflow run/attempt, and jobs

#### Scenario: Failed CI invalidates the candidate
- **WHEN** a required job fails or a tracked repository mutation is needed after the candidate is frozen
- **THEN** the failure routes to the owning child, `run.ciState` and the current CI document both record matching failure or pending supersession so no older success can close acceptance, the candidate remains failed evidence, and a repaired new tree and SHA must repeat physical and exact-SHA native gates
