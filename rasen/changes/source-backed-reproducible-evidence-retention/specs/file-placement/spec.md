## MODIFIED Requirements

### Requirement: Seven file classes each land in their owner root

Every file a Change produces SHALL belong to exactly one of seven classes, and each class SHALL land at a fixed location returned by its owner scope—never from placement configuration:

- fixed planning files (`proposal.md`, `design.md`, `tasks.md`, `specs/`, `planning-context.md`) — project planning scope: `<changesDir>/<change>/`;
- design docs (office-hours, design-consultation, design-review, qa design docs, test plans, and design audits) — the selected project scope's project-design-docs location, or the Store scope's Store-design-docs location only for genuinely cross-project design;
- evidence (`review-report.md`, `cso-report.md`, `qa-report.md`, `benchmark-report.md`, `design-review-report.md`, `review-cycle-report.md`, `verification-report.md`, `ship-log.md`, verification drivers delivered for re-running, and irreplaceable observations required to audit a claim) — project planning scope: `<changeRoot>/evidence/`;
- handoff (handoff documents and relay prompts) — project planning scope: `<changeRoot>/handoff/`;
- probes (executable, reproducible investigation code and manifests) — execution root, by project convention with a fixed fallback;
- ephemera (run-state, disposable collection scratch, caches, and regenerable intermediates) — execution root: `<executionRoot>/.rasen/changes/<change>/ephemera/`;
- coordination (cross-run and cross-worktree arbitration state) — machine root, CLI-owned and accessed only through `rasen` commands.

For a standalone project, the resolver returns the existing in-project locations. For a Store v2 project, `changesDir`, `changeRoot`, project design docs, evidence, and handoff SHALL be inside `rasen/projects/<projectId>/` in the selected Store planning checkout. Store-level design docs remain separate. The execution root is the code checkout/worktree the run operates on and SHALL NOT be inferred from a Store planning root; planning-only work has no execution root.

A raw log or capture SHALL be classified by its evidentiary role rather than its format. A new irreplaceable observation needed for a historical claim SHALL use the evidence location unless an existing approved retention arrangement already owns the original; in that case the evidence report SHALL retain an explicit identity and availability reference. This reference SHALL not introduce a configurable landing location or imply that an external original is included in archive payload verification.

#### Scenario: Evidence lands with the change

- **WHEN** a dispatched expert or verification workflow produces a report for a Change
- **THEN** the report SHALL land under that scope's `<changeRoot>/evidence/`
- **AND** it SHALL remain with the Change through later Archive accounting

#### Scenario: Handoff lands with the change

- **WHEN** a worker or session writes a handoff document or relay prompt
- **THEN** the file SHALL land under that scope's `<changeRoot>/handoff/`

#### Scenario: Ephemera lands in the execution root

- **WHEN** run-state is first recorded for a Change with an execution worktree
- **THEN** it SHALL land under `<executionRoot>/.rasen/changes/<change>/ephemera/`
- **AND** whether it enters Git SHALL be governed solely by the user's `.gitignore`

#### Scenario: Store-selected run splits planning and execution landings

- **WHEN** a Change is planned in a Store v2 project partition and implemented in a project execution worktree
- **THEN** planning files, evidence, and handoff SHALL land in that Store project partition
- **AND** probes and ephemera SHALL land in the execution project without granting another Store member write access

#### Scenario: Planning-only work has no execution fallback

- **WHEN** a Store planning scope has no verified execution checkout
- **THEN** execution-owned locations SHALL be reported as unavailable
- **AND** no Store checkout or current directory SHALL be substituted as an execution root

#### Scenario: Required observation is raw JSON

- **WHEN** a new raw JSON observation is necessary to recompute a historical claim and has no existing approved retention owner
- **THEN** guidance SHALL place that original with evidence rather than treat it as disposable solely because it is raw output
- **AND** derived summaries SHALL reference the original without embedding its full payload

#### Scenario: Generated detail is replaceable

- **WHEN** a detailed report can be regenerated from retained originals with a verified recipe
- **THEN** its disposable generated output SHALL use the execution scope's ephemera location
- **AND** its recipe and current decision SHALL remain in the canonical evidence report or existing index

#### Scenario: Platform path semantics survive evidence placement

- **WHEN** evidence and ephemera locations are resolved on Windows, macOS, or Linux
- **THEN** guidance SHALL use the exact CLI-reported paths with their platform semantics
- **AND** it SHALL not reconstruct a location by concatenating POSIX separators or assuming the current directory is the selected root

### Requirement: Bulky raw research lands in the ephemera area

Propose/explore guidance SHALL direct bulky disposable research material (scratch probing logs, regenerable fetched corpora, long working transcripts) to a `research/` area inside the change's ephemera directory, with conclusions distilled into the committed change artifacts. Guidance SHALL distinguish these intermediates from irreplaceable observations and mutable external inputs needed to audit a claim, which require retained evidence or an identified existing retention owner. A reproducible generator SHALL replace durable generated detail only with identified inputs and a verified reproduction recipe.

#### Scenario: Raw dumps stay out of the PR and the machine root

- **WHEN** the generated propose/explore guidance is inspected
- **THEN** it SHALL direct bulky raw research to the ephemera directory's `research/` area
- **AND** SHALL state that distilled conclusions belong in the committed change artifacts

#### Scenario: Fetched input can change independently of source

- **WHEN** a conclusion depends on a fetched dataset whose bytes can change independently of the generator commit
- **THEN** guidance SHALL identify the dataset's retained version, digest, and availability
- **AND** a mutable URL alone SHALL not establish deterministic regeneration

### Requirement: Classification asks use-and-lifecycle first

Classifying a file or directory into the seven classes SHALL ask, in order: does it outlive changes as design material (design-docs)? is it delivered with the Archive for later re-running or review (evidence — executables allowed; the test is "re-run by later readers", not "is it source")? is it source or a verification project delivered into code history (probes)? is it relay knowledge for successor workers/sessions (handoff)? is it cross-run/cross-worktree arbitration state (coordination)? otherwise it is recovery/regenerable material (ephemera). The first question SHALL NOT be "is it source".

Guidance SHALL treat the original observations required to audit a historical claim as evidence. Re-running a collector SHALL not make those observations regenerable. Regenerable representations SHALL be distinguished from their retained inputs, and an existing original's authoritative location SHALL remain explicit. Classification guidance SHALL preserve sticky-legacy handling and the archive engine's existing ownership/disposition rules; it SHALL not authorize deletion or relocation by filename, extension, or a new recipe alone.

#### Scenario: A verification harness classifies as evidence

- **WHEN** a `verification/` directory holding `verify.sh` and its `README.md` is classified
- **THEN** it SHALL classify as evidence (delivered with the Archive for re-running), not as probes, despite containing executable code

#### Scenario: Collector source lives in code history

- **WHEN** a collector follows the project's existing code convention and its output supports an evidence report
- **THEN** its recipe SHALL refer to that committed source without requiring another source copy under the Change
- **AND** the existing probe/source lifecycle SHALL remain separate from retention of its observations

#### Scenario: Legacy ephemera contains a required original

- **WHEN** a required historical observation in an existing ephemera location must be delivered with the archive
- **THEN** an authorized writer SHALL capture a new immutable evidence snapshot under the CLI-resolved `evidenceDir` before saving an archive plan, verify its byte size and SHA-256 against the captured original, and record both references in the canonical report
- **AND** the authoritative live run-state SHALL remain in place until the existing cleaner decision
- **AND** a report-only expert SHALL report this retention need to the LEAD rather than exceed its canonical-report-only permission
- **AND** copying SHALL require source access and destination write/publication authorization

#### Scenario: Required ephemera is retained only locally

- **WHEN** local-only retention is explicitly approved instead of delivery with the archive
- **THEN** guidance SHALL place `--keep-ephemera` on the saved preview while preserving the selected scope and intent, not on `--apply-plan`
- **AND** it SHALL state that preserved execution-local files are not archive payload evidence
- **AND** if neither an authorized evidence snapshot nor approved local retention is available, cleanup SHALL NOT be authorized
- **AND** existing manifests and archived bytes SHALL NOT be hand-edited
