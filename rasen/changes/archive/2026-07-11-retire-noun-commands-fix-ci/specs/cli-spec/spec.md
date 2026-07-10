# cli-spec Specification (delta)

## REMOVED Requirements

### Requirement: Spec Command
**Reason**: The `rasen spec` noun command group is retired. `rasen show <spec> --type spec`, `rasen list --specs`, and `rasen validate <spec>` (verb-first) fully cover showing, listing, and validating specs. The underlying `SpecCommand.show` is retained and delegated to by the verb-first `show` command.
**Migration**: Replace `rasen spec show <id>` with `rasen show <id>` (or `rasen show <id> --type spec`); `rasen spec list` with `rasen list --specs`; `rasen spec validate <id>` with `rasen validate <id>`.

### Requirement: Interactive spec show
**Reason**: Interactive spec selection is provided by the verb-first `rasen show` command (see cli-show "Top-level show command"), which prompts for type then item and delegates to `SpecCommand.show`. The noun-command form is retired.
**Migration**: Run `rasen show` with no arguments to interactively select and display a spec.

### Requirement: Interactive spec validation
**Reason**: Interactive spec selection for validation is provided by the verb-first `rasen validate` command (see cli-validate "Top-level validate command"). The noun-command form is retired.
**Migration**: Run `rasen validate` with no arguments to interactively select and validate a spec.
