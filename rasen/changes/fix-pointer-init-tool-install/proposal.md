## Why

Projects whose planning is externalized to a registered store cannot currently use `rasen init --tools <tool>` to add another supported AI assistant, because the pointer safety guard treats every init invocation as an attempted conversion to a local planning root. This blocks the existing additional-tool workflow even when the user explicitly asks only to install tool assets.

## What Changes

- Allow an explicit, non-empty `--tools` selection at the exact root of a valid store-pointer repository to install or refresh the selected adapted tools.
- Treat that invocation as tool-only setup: preserve the `store:` declaration and do not create local `rasen/specs`, `rasen/changes`, or archive directories.
- Preserve the existing refusal behavior for plain `rasen init`, `--tools none`, malformed store declarations, and invocations below a pointer repository root.
- Add focused regression coverage for successful Codex skill installation and for the retained pointer-safety boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-init`: Extend additional AI tool initialization to valid externalized-planning repositories while retaining the safety boundary that prevents accidental local-root creation.

## Impact

- Affects the pointer guard and initialization flow in `src/core/init.ts`.
- Adds or updates unit and command-level tests around init behavior in store-pointer repositories.
- Does not change command syntax, store resolution behavior, dependencies, or existing local-root initialization behavior.
