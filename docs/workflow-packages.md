# Installable workflows and `.rasenpkg`

This document defines version 1 of Rasen's installable workflow and package
contracts. An installable workflow is a skill, an optional command entry point,
and declared UTF-8 sidecar files that can be selected by a profile. It is
distinct from an artifact workflow schema and from a pipeline.

## User-wide storage and identity

User workflows are stored below the machine data directory as
`workflows/<id>/`. Rasen resolves that directory through `getGlobalDataDir()`,
so `RASEN_HOME` and the existing XDG compatibility behavior apply. A profile
stores workflow IDs only; it never embeds workflow content.

The runtime catalog is the stable built-in list followed by valid user
workflows in ID order. `full` and `core` always contain built-ins only; user
workflows are opt-in through a custom or named profile. Saving a selection
expands `requires.workflows` transitively in catalog order. Always-installed
expert skills remain outside the workflow selection.

Built-in IDs cannot be overridden. A user workflow also cannot reuse a skill
name or command ID owned by a built-in or another user workflow. Re-importing
the same ID and digest is a no-op. Reusing an ID with a different digest is an
error in format version 1.

Portable workflow IDs, user skill names, and command IDs must match
`^[a-z0-9][a-z0-9-]{0,63}$`. References to always-installed expert skills use
their catalog names — the `rasen-<name>` skill directory name; the retired
`rasen:<name>` colon form is still accepted for backward compatibility. File paths
are NFC-normalized relative POSIX paths.
They must not contain backslashes, empty segments, `.` or `..`, NUL, Windows
device names, or segments ending in a dot or space. Case-fold and NFC aliases
within one workflow are rejected.

## `workflow.yaml` version 1

Every workflow directory contains `workflow.yaml` and `SKILL.md`. The manifest
is a strict YAML object; unknown fields are rejected.

```yaml
version: 1
id: team-release
command:
  enabled: true
  name: Rasen Team Release
  category: Workflow
  tags: [workflow, release]
files:
  sidecars:
    - references/policy.md
  scripts:
    - scripts/check-release.sh
requires:
  workflows: [apply]
  skills: [rasen-review]
recommends:
  workflows: [verify-enhanced-command]
```

The exact fields are:

- `version`: the integer `1`.
- `id`: the portable workflow ID, equal to the containing directory name.
- `kind`: optional, defaults to `task`. May also be `internal` (a sub-unit
  meant to be invoked by another workflow rather than picked directly by a
  user). `driver` is reserved for built-in outer-loop engines and is not a
  valid value here; an out-of-range value fails strict validation. `kind` is
  catalog/presentation metadata only — it is not part of the workflow digest,
  so declaring or changing it never triggers drift-healing of an installed
  copy. See [`rasen workflow`](cli.md#rasen-workflow) for how `list` groups
  and hides by kind.
- `command`: optional. `{ enabled: false }` disables command delivery. When
  enabled, `name`, `category`, and a non-empty unique `tags` array are required.
  The command ID is the workflow ID, its description comes from `SKILL.md`, and
  its body is the `SKILL.md` instruction body.
- `files`: optional. `sidecars` and `scripts` are unique portable paths. Every
  file other than `workflow.yaml` and `SKILL.md` must be declared exactly once.
  Scripts are data during validation and import and are never executed.
- `requires`: optional. `workflows` is expanded to a transitive closure;
  missing dependencies and cycles are errors. `skills` must name an
  always-installed expert skill and is not added to the profile workflow list.
- `recommends`: optional. Missing workflows produce warnings and are not
  installed or enabled automatically.

`SKILL.md` must use YAML frontmatter with `name` and `description`. It may also
contain `license`, `compatibility`, and a string-to-string `metadata` object.
The Markdown body becomes the installed skill instructions. Relative Markdown
links and code-span paths rooted at `references/`, `scripts/`, `templates/`, or
`bin/` must resolve to declared regular files inside the workflow root.

## Diagnostics

Validation produces one locale-neutral result for both human and JSON views.
Each diagnostic has stable `code`, `severity`, and `message` fields, plus
`path`, `sourcePath`, and `details` when applicable. `details` carries measured
values such as `actual` and `limit`; callers must not parse English prose to
recover machine data. Errors block import and generation. Warnings do not.

## `.rasenpkg` format version 1

The media type is `application/vnd.rasen.package+json`. A `.rasenpkg` file is a
strict RFC 8785 JSON Canonicalization Scheme (JCS) byte sequence: compact UTF-8,
without a BOM or trailing newline. Non-canonical encodings are rejected.

The envelope is a strict discriminated object:

```json
{"format":"rasen-package","formatVersion":1,"kind":"workflow","packageDigest":"sha256:...","roots":["team-release"],"workflows":[{"digest":"sha256:...","files":[{"content":"...","encoding":"utf8","path":"SKILL.md","sha256":"sha256:..."}],"id":"team-release"}]}
```

Both kinds require `format`, `formatVersion`, `kind`, `roots`, `workflows`, and
`packageDigest`:

- `kind: "workflow"` forbids `name` and `profile`, requires at least one root,
  and includes each root's user-workflow dependency closure.
- `kind: "profile"` requires a portable `name` and a strict normalized profile
  object containing `version`, `delivery`, and `workflows`.
- Each workflow has only `id`, `digest`, and `files`.
- Each file has only `path`, `encoding: "utf8"`, `sha256`, and `content`.
- Built-in workflows and always-installed expert skills are referenced but are
  never embedded.

Arrays are normalized before encoding: workflows by ID, files by path, and
roots in stable dependency-expanded selection order.

## Digest preimages

All digests use SHA-256 and render as `sha256:<lowercase hex>`.

- File digest: the exact UTF-8 bytes obtained after fatal decoding and
  re-encoding `content`.
- Workflow digest: JCS bytes for
  `{ "format": "rasen-workflow-digest", "version": 1, "id": <id>, "files": [{ "path": <path>, "sha256": <file digest> }, ...] }`.
- Package digest: JCS bytes for
  `{ "format": "rasen-package-digest", "version": 1, "kind": <kind>, "package": <the normalized envelope without packageDigest> }`.

Digests provide content identity and corruption detection, not publisher
authenticity, review status, or trust. Version 1 has no signature or attestation
field.

## Resource limits

Limits are checked before any permanent write:

- package file: 16 MiB;
- decoded content total: 12 MiB;
- one file entry: 1 MiB;
- file entries: 256;
- workflows: 64;
- path: 240 UTF-8 bytes;
- JSON nesting depth: 32;
- JSON object properties: 4,096.

The decoder rejects duplicate JSON keys, comments, trailing commas, dangerous
object keys, lone surrogates, and numbers outside JavaScript's safe integer
range. Import materializes regular files in a private same-filesystem staging
directory, validates the staged tree again, then atomically renames new
workflow directories. A transaction rolls back only paths it created.

## CLI lifecycle

The top-level `rasen workflow` command supports `list`, `show`, `which`,
`init`, `validate`, `import`, `export`, and `delete`. `init` always writes to an
explicit staging path and never installs. `validate` is side-effect free.
`import` accepts an unpacked directory or `kind: workflow` package and never
executes a declared script. Built-in workflows cannot be exported, replaced,
or deleted.

Human output and help are available in English, Japanese, and Simplified
Chinese. Rasen-owned presentation uses the resolved CLI locale, while
user-authored names, descriptions, and workflow content remain as written. JSON
output keeps workflow/profile IDs, source values, digest strings, diagnostic
codes, paths, and field names locale-neutral.

## Profiles and self-contained packages

A built-in-only profile retains the existing YAML/JSON import and export
format. If a profile selects any user workflow, the default portable export is
a `kind: profile` `.rasenpkg` containing every selected user definition after
dependency expansion. `--thin` explicitly opts into YAML/JSON containing IDs
only; importing that form fails before writing if any user ID is unavailable.

Package import uses the envelope's `name`; renaming the package file has no
effect. `rasen profile import --as <name>` is the explicit rename mechanism.
`--force` permits replacement of the named profile snapshot only. It never
permits a workflow ID with a different digest to replace installed content.
Workflow directories and the final YAML profile write form one logical
transaction; a profile commit failure removes only workflow directories
created by that import.

## Project generation, drift, and cleanup

`init` and `update` resolve the effective profile through the full catalog
before generating files. Selected user definitions provide `SKILL.md`, optional
command content, and validated nested sidecars to every configured tool.
Always-installed expert skills are generated independently of profile choice.

Each project records user-workflow source, content digest, and exact generated
file set in `rasen/.workflow-artifacts.json`. Drift detects a missing source,
digest change, missing/modified generated file, delivery change, or selection
change. Cleanup removes only unchanged files recorded by that ledger. Modified
or additional files are preserved and become unmanaged. Legacy migration never
adopts or deletes a ledger-less directory merely because it resembles a user
workflow.

Pipeline validation uses two sets: every catalog/expert skill is known, while
only the effective workflow dependency closure plus experts is enabled. An
unknown skill reports `pipeline_skill_unknown`; a known workflow skill excluded
by the active profile reports `pipeline_skill_disabled` and blocks execution.

## AI authoring and review

The always-installed `rasen-workflow-author` expert follows this sequence:

1. define purpose, trigger, inputs, output, completion, and prohibited actions;
2. inspect `rasen workflow list --json` and scaffold in a writable staging path;
3. author the minimal manifest, skill, and declared sidecars;
4. run static validation until it has no errors;
5. request an independent `rasen-workflow-review` semantic review;
6. fix findings and statically validate again;
7. show the tree, scripts, dependencies, digest, and remaining risks;
8. import only after the user asks for installation.

The review expert checks boundedness, dependency/prose agreement, overlap,
cross-tool portability, profile/pipeline contracts, destructive/network/secret
boundaries, shell/path safety, completion, and escalation. Its findings include
severity, location, evidence, and required fix. Review is a quality layer, not
a security boundary or package attestation; manual import remains valid without
review metadata.

## Trust boundary

A community package — whether `kind: workflow`, `kind: profile`, or a
pipeline `.rasenpkg` — is a set of executable prompts, not sandboxed data.
Importing one and later selecting it means an agent will read and act on its
`SKILL.md`/instruction content, any declared sidecars, and (for a pipeline) its
`pipeline.yaml` stage sequence. There is no code execution at import time —
scripts are treated as inert UTF-8 files and never run by the CLI — but the
content itself is designed to direct an agent's actions once installed and
selected.

The mitigations available today are:

- **Transactional install** — staged, re-validated, then atomically
  materialized; a failed import rolls back only the paths it created.
- **Content digest verification** — SHA-256 over declared files (workflows)
  or the pipeline's own files, so what you install is provably the bytes that
  were packaged.
- **Structural validation** — `rasen workflow validate` / `rasen pipeline
  validate` check manifest shape, path safety, stage-DAG acyclicity, and
  (for pipelines) decompose recursion bounds and skill references, before
  install and again before each execution (`validatePipelineForExecution`).
- **Author/review experts** — `rasen-workflow-author` and
  `rasen-workflow-review` (covering both workflows and pipelines) give a
  structured authoring and independent-review pass before anyone imports.

There is no signature system and no marketplace. Provenance is whatever the
distributor claims through their distribution channel (a git remote, a PR, a
shared file) — Rasen does not verify publisher identity.

State the limits honestly, not just the mitigations:

- **A digest verifies byte integrity, not safety.** It proves the installed
  content matches what was packaged; it says nothing about whether that
  content is benign.
- **Validation is structural, not behavioral.** `validate` confirms the
  manifest/pipeline shape parses and its declared references resolve; it does
  not simulate what an agent following the instructions would do.
- **Review is a mitigation, not a guarantee.** A passing
  `rasen-workflow-review` pass raises the bar against careless or naive
  authoring; it is not an attestation, a signature, or proof of safety, and a
  reviewer can miss an adversarially crafted package.
- **No signatures, no marketplace.** Anyone can author and distribute a
  package; nothing in the format authenticates who packaged it or vouches for
  its trustworthiness beyond the digest matching its own bytes.

Treat any package from outside your own team the way you would treat an
unreviewed pull request that runs with agent-level trust: read it before you
import it, and import only what you are prepared to have an agent act on.

## Security and known limits

- SHA-256 identifies content and detects corruption; it does not authenticate a
  publisher or prove that a workflow was reviewed.
- Import and validation treat scripts as UTF-8 files and never execute them.
- Usage scanning covers machine-global consumers and the current project, not
  every project directory on the machine. `--unused` is advisory and deletion
  warns about unknown project-local consumers.
- Version 1 intentionally excludes binary assets, compression, signatures,
  trust stores, review attestations, workflow replacement, and instruction
  include/extends behavior.
