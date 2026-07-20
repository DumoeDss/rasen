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

Built-in IDs cannot be overridden. A user workflow also cannot reuse a skill
name or command ID owned by a built-in or another user workflow. Re-importing
the same ID and digest is a no-op. Reusing an ID with a different digest is an
error in format version 1.

Portable workflow IDs, user skill names, and command IDs must match
`^[a-z0-9][a-z0-9-]{0,63}$`. References to always-installed expert skills use
their catalog names, including the existing `rasen:<name>` namespace. File paths
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
  skills: [rasen:review]
recommends:
  workflows: [verify-enhanced-command]
```

The exact fields are:

- `version`: the integer `1`.
- `id`: the portable workflow ID, equal to the containing directory name.
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
