## Context

The motivating archive contained 5,442 regular files and 1,458,806,983 bytes. Its existing Git allowlist kept bulk data out of Git, but not out of archive copying and journal processing. One 149,549,560-byte summary contained detailed observations already present in referenced attempt output; the inspected sample's 220-element observation array matched the original. These are retained-data observations, not a measured archive speedup or an estimate of whole-package deduplication savings.

The current implementation already provides the relevant seams:

- `src/core/file-placement.ts` and the `file-placement` capability separate planning evidence, execution-owned probes, and ephemera without placement configuration.
- `src/core/templates/experts/_shared.ts` supplies expert preamble and probe-placement guidance; `workflows/_orchestration.ts` supplies the shared workflow playbook.
- Benchmark, investigation, verification, ship, and archive templates describe collection, result reporting, and evidence consumption. Existing report names, verdict lines, and test-evidence fields are consumed by later stages.
- Some wording groups raw logs and captures with regenerable intermediates. A historical observation is not regenerable merely because a program can collect another observation.

The product change is a workflow guidance contract, not a new archival storage or execution subsystem. It must reach generated/installed skills rather than only repository-local instructions. Proposal base: `upstream/dev/0.1.8` at `f0ae20d19a30c265ad3f3ffaaa5bb3cd148d12dd`.

## Goals / Non-Goals

**Goals:**

- Replace reproducible detail with pinned source and identified inputs while keeping historical decisions auditable.
- Retain each required observation once; summaries refer to it rather than embedding it repeatedly.
- Distinguish reproduction capability, demonstrated regeneration, and observed historical outcomes.
- Keep the ordinary reading path compact and preserve existing report/placement contracts.

**Non-Goals:**

- Changing the archive journal, cleaner, manifest accounting, relative-link rebasing, CLI JSON, or verdict parser.
- Running arbitrary recipe commands automatically, adding a recipe validator/service, or promising hermetic builds.
- Introducing a new storage backend, file class, configuration key, report hierarchy, or universal byte/sample limit.
- Editing MadoPilot collectors, rerunning its performance work, or modifying existing archived evidence.
- Treating less storage as permission to omit failures, reduce statistical samples, or weaken release gates.

## Decisions

### 1. Use one shared guidance module, not a new execution interface

Add one small shared template module under `src/core/templates/` for the evidence-retention instructions. Follow the existing shared-string pattern, with a named exported constant and an explicit consumer list. Reuse it from the expert preamble and the relevant workflow templates; do not make workflows import the entire expert preamble. Include it once per emitted skill, including orchestration-embedded variants.

Required coverage is planning (`propose`, `explore`), collection (`investigate`, `benchmark`, and report-producing experts through their shared preamble), implementation/orchestration evidence production, verification (`verify-change`, `verify-enhanced`, `review-cycle`), and evidence consumption (`ship`, `archive-change`, bulk archive, retention guidance). Reconcile consumer-specific instructions rather than appending text that contradicts them. Preserve standalone roots and dispatched report-only experts' canonical-report-only write restriction; other dispatched writers retain their stage permissions.

Delivered consumer list:

- Direct workflow imports: `propose`, `explore`, `apply-change`, `verify-change`, `verify-enhanced`, `ship`, `archive-change`, `bulk-archive-change`, `retain`, `goal-plan`, `goal-iterate`, `goal-report`.
- Orchestration header: `auto`, `goal`, `review-cycle`; selective bundles inherit the header once.
- Expert `PREAMBLE`: `review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`, `codex`.
- Direct expert import: `investigate`; unrelated dialogue experts do not inherit it.

Alternative: a machine-enforced recipe format and new CLI commands. Rejected because the immediate problem is what agents collect, duplicate, and read; introducing a storage/execution platform is unnecessary. The Module's Interface is the emitted evidence contract and its integration points, with Locality provided by a shared source.

### 2. Classify reproducibility before choosing retention

Use three modes, which are guidance concepts rather than CLI enum values:

| Mode | Meaning | Durable basis |
| --- | --- | --- |
| Deterministic regeneration | Recreate a fixture or other byte-stable output | Pinned generator, inputs/seed, relevant environment, command, expected digest |
| Historical reanalysis | Recompute a conclusion from the original observations | Retained observations plus pinned analysis source and method |
| Experimental rerun | Collect new observations with the same procedure | Pinned procedure and conditions; the result is a new run, not the old evidence |

Require a successful regeneration check before calling an omitted deterministic output reproducible. For reports containing variable timestamps or paths, define and verify the stable result domain explicitly; do not claim whole-file byte identity. If the check is unavailable, record the recipe as unverified and keep the claim limited.

Alternative: keep only a commit and rerun everything. Rejected because timing, memory, OS events, external service behavior, permissions, and failures are not determined by source history alone.

### 3. Embed a compact recipe in an existing report or index

The default is a section in the canonical report, not an additional mandatory JSON file. Reuse a project's existing index when it already carries the necessary fields. Multiple independent scopes may have separate recipes, but each recipe has one authoritative location and consumers link to it.

The minimum information is:

- Claim/question, acceptance or stopping condition, reproduction mode, actual outcome, and unsupported/unrun scope.
- Generator/analysis repository and full commit; measured implementation repository and commit when different; repository-relative entry point and working directory.
- Actual executed-source identity. For dirty or untracked execution inputs, identify preserved patch/content and their digests, or state that source identity is incomplete. A HEAD tree alone is not the dirty execution's identity. A source commit is not substituted for a measured binary's identity when that matters to the claim.
- Exact commands/arguments, configuration, seed when relevant, dependency lock identity, toolchain/runtime/native dependencies, and relevant OS/hardware/mode/permission assumptions.
- Input and observation references: explicit base, locator, saved byte size and SHA-256 when bytes exist, and availability/access requirements. Generated inputs may instead point to an already verified deterministic recipe and expected digest.
- Expected output or stable result domain, original run result, and the actually performed regeneration/reanalysis check. State unperformed checks explicitly.

Keep fields proportional to the claim. A deterministic text fixture does not need an OS process census. Share repeated environment/input metadata once rather than embedding it in every sample. Ordinary qualitative reviews retain findings, source references, and observed commands; they do not need a fabricated dataset or recipe for observations they never collected.

Existing `TEST EVIDENCE`, `VERIFY VERDICT:`, and ship-log machine fields remain unchanged. Recipe information is separate human-readable context and does not grant a new test-skip or archive capability.

### 4. Keep one original and derive detail on demand

For new collection scopes, choose the claim, required observations, stopping condition, and storage handling before collecting. Retain the data needed to reproduce the reported statistics and classifications, including failures, exclusions, and incomplete attempts. Do not call a percentile summary sufficient when auditing the claim requires its samples.

A current report contains the decision, essential aggregates, limits, and references. Sample arrays, full stdout, repeated runtime-image inventories, and generated detailed tables belong in their authoritative originals or disposable generated outputs, not in every summary. This bounds the reading surface by claims and artifact groups rather than sample count. A brief failed-run diagnostic is allowed when it explains a finding; an entire copied log is not the default.

This Change does not retroactively delete data. For future outputs, avoid creating unnecessary durable copies. Any later cleanup is separately authorized and uses existing ownership/disposition rules.

New standalone benchmark captures use one Windows-safe UTC `YYYY-MM-DDTHHmmssSSSZ-<uuid>` identifier in the existing report filename forms. Create immutable, non-overwriting measurement and baseline records. A baseline capture has one authoritative baseline JSON, not a duplicate run JSON. Reports cite the exact original; `baseline.json` may remain a byte-identical current working copy for compatible readers, not a pointer. Preserve required legacy bytes before replacing a working copy and record `old locator + captured SHA-256 -> retained locator`, with byte size, in the new report. Leave the working file unchanged when access/authorization is unavailable or an exact historical locator must remain unchanged; select the new immutable baseline directly.

### 5. Refine lifecycle guidance without changing placement machinery

Keep all seven classes and existing CLI-resolved roots. Irreplaceable observations needed for a claim are evidence, regardless of extension. New local originals without an existing approved retention destination stay with evidence; this is the safe default, not a promise that all raw data disappears from archive payloads. Deterministic derived files and disposable collection scratch use ephemera. Generator source follows project code conventions or the existing probe fallback; an already established verification harness delivered with an archive remains evidence.

An already retained private/external original may be referenced without copying it, but its ownership and availability must be explicit. A digest is not a backup, download permission, or receiver verification. This Change introduces no external placement option and does not move new payloads to an invented location.

Required originals in ephemera follow the shared authorized-retention procedure in `src/core/templates/evidence-retention.ts`: capture a new immutable evidence snapshot, verify its byte size and SHA-256 against the captured original, and bind the report to that snapshot before saving an archive plan. Keep authoritative live run-state in place until the existing cleaner decision. Report-only experts record unmet retention needs for the LEAD to route to an authorized writer. Copying requires source access and destination write/publication authority.

Explicitly approved local-only retention uses `--keep-ephemera` on the saved preview, not `--apply-plan`; it preserves execution-local files without adding them to the archive payload. If neither an authorized snapshot nor approved local retention is available, do not authorize cleanup. Do not hand-edit cleaner manifests or infer safety from filenames. Existing archives remain immutable, and absence of the new recipe is not a retrospective archive failure.

The source-backed ownership and compatibility decision is recorded in [ADR: Retain observations through existing ownership seams](adr-retention-boundaries.md). It changes guidance, not archive-engine behavior.

### 6. Treat recipes as data, with portable and private references

Use repository-relative paths with an explicit repository/commit base, and CLI-reported Change paths for planning artifacts. Local-only locators state their root and access limits. Windows drive paths, spaces, separators, and case sensitivity retain their platform meaning; implementation path calculations use Node.js `path` functions rather than shell/path concatenation. Store/project/target-line selection is preserved on supported commands; unavailable execution roots stay unavailable.

Do not execute or fetch a recipe while merely reading/verifying a report. A run needs a trusted command and an explicitly selected execution scope. Report sensitive inputs by approved reference rather than copying credentials, captures, or private absolute paths into publishable artifacts. If source or inputs cannot be retrieved, expose the unavailable dependency instead of claiming successful reproduction.

### 7. Verify the delivered guidance and the evidence model

After implementation, build and install/generate the affected skills into an isolated temporary project using the existing workflow-generation path. Inspect the actual emitted collection and verification instructions, including dispatched and standalone cases. Test the user-visible scenarios with a small disposable deterministic generator, fixed input, and a small retained observation dataset:

1. Regenerate a deterministic fixture from its pinned recipe and verify its expected digest.
2. Derive a detailed report from retained samples without embedding those samples in the summary; recreate the same declared aggregates/verdict from the recipe.
3. Identify changed inputs, missing/private originals, and dirty source correctly; do not execute a recipe merely to inspect it.
4. Treat a new timing run as new evidence, leaving the original outcome intact.
5. Confirm existing verdict/test-evidence consumption and platform-aware generation behavior remain intact.

Use established behavioral generation/installation checks and recorded inspection of actual installed instructions. Retire `test/core/templates/skill-templates-parity.test.ts`; do not replace it with permanent prompt-string, wiring, or hash assertions. Hash re-pinning establishes changed bytes, not correct retention authority or historical evidence identity. Keep smoke artifacts disposable and record only commands, outcomes, and limits. A full performance campaign or mutation of the motivating archive is unnecessary.

Reconcile seven active requirement blocks across `expert-template-inlining`, `workflow-template-parity` (two blocks), `verify-ship-evidence`, `expert-dispatch-contract`, `expert-dialogue-override`, and `methodology-expert-fusion`. Explicitly REMOVE the six hash-gate requirements with migration notes and ADD their generated-delivery replacements; obsolete hash-specific scenarios are intentionally retired, not silently dropped from a MODIFIED block. The methodology reference-cleanliness requirement remains MODIFIED with all existing scenario identities. Preserve substantive generation, severity, dialogue, mode/routing, build/update, Store selection, handoff precedence, and consumer contracts. The historical one-time inline-migration equivalence requirement is unchanged. Canonical specs remain owner-controlled; these deltas do not synchronize or archive themselves.

## Risks / Trade-offs

- Guidance is not automatic enforcement -> describe the shipped behavior as instructions, inspect installed output, and make unsupported claims visible to reviewers.
- Retention can become another reporting burden -> reuse canonical reports/indexes, record shared context once, and require only fields relevant to the claim.
- Some raw originals remain large -> preserve their evidentiary value; reducing derived duplication is separate from reducing experiment scope or optimizing the archive engine.
- Source/input loss makes recipes unusable -> record availability and retrieval prerequisites, and distinguish a hash from accessible bytes.
- Private data limits independent reanalysis -> preserve confidentiality and report the limitation rather than advertising complete reproducibility.
- Existing templates contain broader raw-log/ephemera wording -> reconcile the explicit consumer set and placement documentation in the same implementation.

## Migration Plan

Ship the guidance through the normal template/skill generation and update routes. New runs follow the contract; existing active records keep their authoritative locations and can add a recipe when next changed without rewriting past observations. Archived evidence is untouched. Rollback reverts guidance/documentation changes only; there is no data-format migration, new runtime configuration, or archive transaction to reverse.

## Open Questions

None required to begin implementation. Per-project storage policies, statistical methods, and access to private originals remain explicit inputs to each collection scope, not new global defaults.
