## Context

`InitCommand.execute()` currently classifies the nearest `rasen/` directory before tool selection. A config-only directory with a valid `store:` declaration is rejected unconditionally, which protects it from becoming a local planning root but also prevents an explicit request such as `rasen init --tools codex` from reaching the existing tool-generation path.

The ordinary extend path cannot simply be enabled for pointer repositories: `createDirectoryStructure()` ensures `rasen/specs`, `rasen/changes`, and `rasen/changes/archive`, which would change root classification and divert future planning away from the declared store. Pointer repositories are otherwise first-class registered project members, so tool setup should retain the existing selection, generation, tracking, and reporting behavior without creating local planning shape.

## Goals / Non-Goals

**Goals:**

- Recognize an explicit, valid, non-empty `--tools` selection at the exact root of a valid store-pointer repository as tool-only setup.
- Reuse the existing adapted-tool validation, workflow selection, skill generation, managed-artifact tracking, tool-specific setup, and success reporting paths.
- Preserve the pointer configuration and prevent creation of local specs, changes, or archive directories.
- Keep pointer safety behavior stable across Windows, macOS, and Linux, including path aliases and platform-native separators.
- Keep all ordinary local-root initialization and extend behavior unchanged.

**Non-Goals:**

- Turning `rasen update` into a tool-onboarding command.
- Allowing interactive tool selection, auto-detection, or `--tools none` to bypass pointer protection.
- Supporting init from a descendant directory of a pointer repository.
- Repairing malformed store declarations or converting a pointer repository into a local planning root.
- Changing store registration, planning-root resolution, or command syntax.

## Decisions

### 1. Make pointer tool-only mode an explicit execution mode

After classifying the nearest Rasen root, the init flow will enter pointer tool-only mode only when all of these conditions hold:

1. the nearest root is config-only and has a valid `store:` value;
2. the requested target is that exact root after canonicalizing existing paths;
3. `--tools` was supplied; and
4. the existing tool-argument resolver returns at least one adapted tool.

Malformed pointers are rejected before considering tool-only mode. A plain invocation, `--tools none`, or a target below the pointer root follows the existing externalized-planning refusal.

Canonical path identity will use the existing `FileSystemUtils.canonicalizeExistingPath()` behavior rather than separator manipulation or new matching logic. This handles native Windows path spelling, case/alias normalization, and symlink or junction aliases consistently with the rest of the codebase.

**Alternative considered:** Treat any existing `rasen/` directory as extend mode. Rejected because the shared extend path creates local planning directories and changes the repository's planning identity.

**Alternative considered:** Add a new command or flag dedicated to tool installation. Rejected because `rasen init --tools` is already the specified and documented onboarding surface.

### 2. Share tool generation while suppressing local-root mutations

Pointer tool-only mode will continue through the existing tool-state lookup, adapted-tool validation, active workflow/profile resolution, skill and sidecar generation, exact-name cleanup, managed-artifact tracking, tool-specific setup, project-member registration, learned-skill reconciliation, and success summary.

Operations whose contract assumes a local planning root will be skipped in this mode:

- creation or ensuring of `rasen/specs`, `rasen/changes`, and the archive directory;
- creation or profile-lock mutation of `rasen/config.yaml`.

The existing `store:` declaration remains authoritative. Tool-managed files such as `.codex/skills/**` are expected outputs; managed metadata may continue to be tracked using the existing exact-name ledger behavior without creating planning shape.

**Alternative considered:** Build a separate reduced skill installer. Rejected because duplicating tool resolution and generation would drift from normal init behavior, especially for profiles, sidecars, cleanup, and tool-specific settings.

### 3. Lock the safety boundary with focused tests

A core init regression will create a pointer fixture using `path.join()`, run an explicit Codex selection, and assert that Codex skills are generated, the `store:` declaration survives, and local planning directories remain absent.

Command-level coverage will exercise the user-visible CLI path and retain or extend assertions for:

- plain `rasen init` refusal;
- `rasen init --tools none` refusal;
- malformed pointer refusal;
- descendant-directory refusal; and
- successful explicit non-empty tool installation at the pointer root.

Existing filesystem identities in tests will be canonicalized with `fs.realpathSync.native()` where equality is asserted, following the repository's Windows test guidance. CLI-focused tests will build first when they execute the generated `dist/` entry point.

## Risks / Trade-offs

- **[Risk] An overly broad bypass silently creates a local planning root.** → Gate the mode on canonical exact-root identity plus a valid non-empty explicit selection, and assert absence of every planning-shape directory after success.
- **[Risk] Early tool-argument resolution changes unrelated init behavior or error precedence.** → Resolve the argument only inside the valid exact-pointer branch and leave the ordinary path untouched.
- **[Risk] A separate tool-only implementation diverges from normal skill generation.** → Reuse the existing generation pipeline and condition only the local-root mutations.
- **[Risk] Windows path aliases make a root invocation look like a descendant invocation.** → Compare canonical existing paths through the shared filesystem utility and include native-path coverage.

## Migration Plan

No data migration is required. The behavior is additive for a command that currently fails before writing. Rollback consists of reverting the conditional pointer tool-only path; repositories that used the feature retain valid tool assets and their unchanged store pointer.

## Open Questions

None.
