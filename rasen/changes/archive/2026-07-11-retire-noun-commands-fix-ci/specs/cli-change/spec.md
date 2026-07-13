# cli-change Specification (delta)

## REMOVED Requirements

### Requirement: Change Command
**Reason**: The `rasen change` noun command group is retired. `rasen show <change>`, `rasen list`, and `rasen validate <change>` (verb-first) fully cover showing, listing, and validating changes. The underlying `ChangeCommand.show` is retained and delegated to by the verb-first `show` command.
**Migration**: Replace `rasen change show <id>` with `rasen show <id>` (or `rasen show <id> --type change`); `rasen change list` with `rasen list`; `rasen change validate <id>` with `rasen validate <id>`.

### Requirement: Legacy Compatibility
**Reason**: This requirement described `rasen list` as deprecated in favor of `rasen change list` — the inverse of current reality after the verb-first migration. It is stale and removed alongside the noun command group.
**Migration**: `rasen list` is the supported command for listing changes; no `rasen change list` fallback exists.

### Requirement: Interactive show selection
**Reason**: Interactive change selection is provided by the verb-first `rasen show` command (see cli-show "Top-level show command"), which prompts for type then item and delegates to `ChangeCommand.show`. The noun-command form is retired.
**Migration**: Run `rasen show` with no arguments to interactively select and display a change.

### Requirement: Interactive validation selection
**Reason**: Interactive change selection for validation is provided by the verb-first `rasen validate` command (see cli-validate "Top-level validate command"). The noun-command form is retired.
**Migration**: Run `rasen validate` with no arguments to interactively select and validate a change.
