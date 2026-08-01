## Why

Rasen currently exposes several expert skills that are useful only as implementation detail for one host workflow, which makes profiles, routing, and generated installs noisier without adding an independent user journey. Consolidating those methods behind lazy sidecar references preserves their depth where it is needed while keeping the public expert roster focused on independently dispatchable or genuinely standalone capabilities.

## What Changes

- **BREAKING** Retire the independently registered and invokable `rasen-codebase-design`, `rasen-tdd`, `rasen-prototype`, `rasen-navigator`, `rasen-workflow-review`, and `rasen-qa-only` skill identities.
- Move the codebase-design, TDD, prototype, workflow-review, and navigator bodies and references beside their sole hosts (`rasen-propose`, `rasen-apply-change`, `rasen-explore`, `rasen-workflow-author`, and `rasen-help`) and have each host load the relevant material only when that branch is needed.
- Fold QA-only behavior into `rasen-qa` as an explicit report-only/non-UI mode while preserving browser-based evidence, canonical severity tagging, role isolation, and the shared `qa-report.md` contract.
- Update the `full-feature` expert fan-out and `rasen-verify-enhanced` standard path to dispatch `rasen-qa` in the appropriate UI or report-only/non-UI mode, with no dependency on a separate QA-only skill.
- Reduce profile and catalog metadata to the surviving expert roster, remove retired localized picker entries, and clean the six exact retired installed skill directories during init/update without touching similarly named or user-owned directories.
- Move source sidecars to their host-owned locations, keep attribution intact, include host sidecars in generation/parity coverage, and update dependency, count, locale, profile, pipeline, install/update, and documentation tests.
- Leave `rasen-office-hours` and `rasen-office-hours-command` unchanged. Keep `review`, `cso`, `benchmark`, `design-review`, and `qa` independently dispatchable; keep `careful`, `chrome-use`, `codex`, `design-consultation`, `investigate`, and `workflow-author` as opt-in standalone experts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `add-grill-expert-skills`: Rehome the adapted methodology content from standalone expert registrations to host-workflow sidecar references while retaining attribution and substantive guidance.
- `methodology-expert-fusion`: Replace optional calls to standalone methodology experts with lazy reads of the host workflow's bundled references and retire the standalone-invocation guarantee.
- `navigator-router-skill`: Make `rasen-help` the single routing surface and load the detailed navigator map from a bundled reference instead of installing `rasen-navigator`.
- `workflow-library`: Remove the retired experts from the catalog, fold workflow review into the surviving workflow-author expert, update real skill dependencies, and preserve generated sidecar/install cleanup contracts.
- `profiles`: Remove retired expert choices and QA-only from defaults, picker metadata, saved selection choices, and quality-floor counts.
- `full-feature-workflow`: Preserve the six-member conditional fan-out while routing both UI QA and non-UI report-only QA through `rasen-qa`.
- `opsx-verify-enhanced-command`: Use `rasen-qa` report-only/non-UI mode for standard verification and drop the QA-only dependency.
- `expert-dispatch-contract`: Define report-only QA as a mode of `rasen-qa` while preserving canonical evidence and no-edit behavior under orchestration.
- `canonical-severity-vocabulary`: Treat all QA modes as one expert producer with the existing QA severity mapping.
- `expert-source-reading-scope`: Apply the source-reading carve-outs to the single QA skill in both standalone and report-only modes.
- `chrome-use-expert-methodology`: Preserve chrome-use browser requirements for the unified QA skill and move navigator browser routing guidance into help.
- `workflow-next-steps`: Replace workflow references to retired methodology skill identities with bundled lazy-reference guidance.

## Impact

- Catalog/profile surfaces: expert definitions, quality-floor constants, localized expert metadata, fixtures, dependency closure, and count assertions.
- Generated skills: host workflow/expert templates, bundled sidecar trees, parity hashes, init/update materialization, exact-name orphan cleanup, and drift/freshness checks.
- Pipelines and orchestration: `full-feature`, `rasen-auto` wording, `rasen-verify-enhanced`, QA dispatch prompts/modes, and canonical report paths.
- Source/docs/tests: retired template exports and source directories, expert catalog documentation, workflow/package guidance, pipeline dogfood fixtures, and Windows-safe path-based install/update tests.
- No runtime schema expansion is planned: independently scheduled review units remain catalog experts, while single-host methods become ordinary lazy sidecar references.
