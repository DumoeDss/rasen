## Context

The config command currently calls the repository planning-root finder, whose deliberately broad contract accepts the nearest ancestor containing a `rasen/` directory. That is appropriate for general planning-root discovery, but config project operations have a narrower observable contract: they read and write `<root>/rasen/config.yaml`.

On Windows, `os.tmpdir()` commonly lives below `%LOCALAPPDATA%`, and this machine legitimately has `%LOCALAPPDATA%\rasen` for application data. A command launched from the temporary directory therefore receives `%LOCALAPPDATA%` as a false project root. Changing only `TEMP/TMP` to a clean drive location makes all four symptoms pass, proving the collision.

## Goals / Non-Goals

**Goals:**

- Give interactive and explicit project-scope config operations one exact initialized-project predicate.
- Reject an ancestor that has an unrelated `rasen/` directory without the project config file.
- Preserve valid project and Store-backed project behavior.
- Make the regression deterministic on Windows, Linux, and macOS without depending on ambient machine state.

**Non-Goals:**

- Redefine the repository-wide planning-root finder.
- Move or reinterpret global machine data.
- Change config precedence, key scopes, localization, or Store routing.
- Fold this defect into the ECP process-authority foundation.

## Decisions

### Use a config-specific initialized-project resolver

The command layer will first use the existing nearest-root lookup, then accept the candidate only when `resolveConfigFilePath(candidate)` is an existing file. The interactive editor, effective view, and explicit `--scope project` operations consume the same helper.

This keeps the general planning-root contract unchanged while aligning config project identity with the exact file config operations already own.

Alternative: change `findRepoPlanningRootSync` globally. Rejected because many unrelated commands intentionally recognize broader planning roots, making the blast radius disproportionate to this bug.

Alternative: force tests to use a clean `TEMP/TMP`. Rejected because it would hide the same real user-facing false-positive on Windows.

### Reproduce an ambient ancestor inside the test fixture

The regression will create an ancestor containing `rasen/` but no `rasen/config.yaml`, then run the editor from a child directory. This is path-module based and independent of the host's real application-data layout.

## Risks / Trade-offs

- A hand-created `rasen/` directory without `config.yaml` is no longer a config project. This matches the config command's file contract; `rasen init` is the repair.
- A valid `.yml` compatibility path could be excluded if project config supports it. The implementation must use the existing `resolveConfigFilePath` helper rather than hard-code `config.yaml`, preserving current filename compatibility.

## Migration Plan

No data migration is required. The change is additive fail-closed detection. Rollback is the two-file code/test revert, but would restore the Windows false-positive.

## Open Questions

None.
