# Change: Reject ambient data directories as config projects

## Why

On Windows, a normal machine-data directory such as `%LOCALAPPDATA%\rasen` can sit above the temporary directory used by a command or test. The config command currently treats any ancestor containing a `rasen/` directory as an initialized project, so an ambient application-data directory can enable project-only rows, add a project-scope prompt, and suppress the localized outside-project notice.

This surfaced as four deterministic root-suite failures while finalizing the ECP process-authority foundation. The defect is independent of that foundation and needs its own bounded bug-fix lifecycle.

## What Changes

- Require config commands to recognize a project root only when the candidate contains the project configuration file that config operations read and write.
- Preserve the existing interactive editor and `--scope project` behavior for initialized projects.
- Add a deterministic cross-platform regression in which an ancestor has an unrelated `rasen/` directory but no project config.
- Record the original full-suite failure and the minimized RED/diagnostic evidence without treating an environment override as a fix.

## Capabilities

### Modified Capabilities

- `cli-config`: project-scoped and interactive config operations distinguish initialized projects from ambient machine-data directories.

## Impact

- Affected code: config-command root resolution only.
- Affected tests: focused interactive config editor/root detection.
- No change to general planning-root discovery, global config location, Store selection, ECP authority contracts, or macOS/MMAC decisions.
