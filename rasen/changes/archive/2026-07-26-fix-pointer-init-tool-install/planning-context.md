# Planning Context

## User intent

The user tried to install the Codex version of Rasen into a project whose
planning is externalized through `rasen/config.yaml`:

> This repo's planning is externalized to store 'elftia-store'. Remove the
> store: line first to convert this repo to a local Rasen root.

They expect a supported command path for adding another AI tool's generated
skills to an already initialized project, without converting the project from
an external-store pointer into a local planning root. Implement the fix from a
new worktree and branch based on the latest `origin/dev/0.1.5`, verify it, and
open a pull request.

## Established evidence

- The new worktree is based on `origin/dev/0.1.5` at `b21cec2f`.
- `src/core/init.ts` currently rejects every config-only store pointer before
  processing an explicit `--tools` selection.
- The normal initialization path creates `rasen/specs`,
  `rasen/changes`, and the archive directory, so simply bypassing the pointer
  guard would silently convert the pointer repository into a local planning
  root.
- The existing `cli-init` specification promises that users can add
  additional AI tool configurations after initial setup.
- `rasen update` deliberately does not onboard a new tool, so this capability
  belongs to an explicit `rasen init --tools <tool>` path.
- Existing pointer safety coverage must remain intact for plain `rasen init`,
  malformed pointers, subdirectory invocations, and `--tools none`.
- A focused regression should prove that an explicit non-empty tool selection
  (notably Codex) generates the requested tool assets while preserving the
  pointer's `store:` declaration and without creating local planning
  directories.
- Machine-home registration already classifies a config-only repository with a
  valid store pointer as `store` mode, so pointer repositories can retain the
  normal project-member registration lifecycle during tool-only setup.
- The managed workflow-artifact ledger lives under `rasen/` but does not create
  planning shape; root classification is determined by specs/changes
  directories, so exact-name tool metadata can remain on the shared generation
  path.

## Constraints

- Preserve cross-platform behavior and use Node path utilities in code/tests.
- Keep the change narrowly scoped to explicit tool installation in an exact
  pointer-repository root.
- Add tests before or with the implementation and retain all existing pointer
  safety behavior.
- Do not modify the user's original dirty worktree.
