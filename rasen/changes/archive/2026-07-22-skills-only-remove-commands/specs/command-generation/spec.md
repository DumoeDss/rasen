## REMOVED Requirements

### Requirement: CommandContent interface
**Reason**: The command delivery surface is retired. Rasen no longer generates tool-specific command files; skills are the single delivery format. The `CommandContent` interface and its module are deleted.
**Migration**: None for end users. Skill files (`.claude/skills/rasen-*/SKILL.md` and per-tool equivalents) already produce the same slash commands. The command copy is recoverable from git history if ever needed.

### Requirement: ToolCommandAdapter interface
**Reason**: The 26 per-tool command adapters are deleted along with the command-generation module. Each tool's command file-path knowledge that is still needed for cleaning up pre-existing installs is frozen into a static module (see `legacy-cleanup` capability, "Retired command files are pruned on init and update").
**Migration**: Cleanup of previously generated command files is handled by the static retired-command-paths knowledge; no adapter runtime survives.

### Requirement: Command prefix defined once
**Reason**: No command files are generated, so a runtime command-prefix constant driving adapter paths is obsolete. The skill-side guard that generated output is free of legacy namespace tokens (`/opsx:`, `opsx-`, `commands/opsx/`, `openspec-`) is preserved by skill generation and the template parity golden master.
**Migration**: The prefix used by the static cleanup path candidates is a frozen constant in the retired-command-paths module.

### Requirement: Command generator function
**Reason**: With no command files generated, the `generateCommand` function has no callers and is deleted.
**Migration**: None.

### Requirement: CommandAdapterRegistry
**Reason**: The adapter registry existed only to look up per-tool command adapters, all of which are deleted.
**Migration**: None. Consumers that used the registry to resolve command-file paths for cleanup (update/init/migration/profile-sync-drift/workflow-artifact-ledger) now read the static retired-command-paths module.

### Requirement: Shared command body content
**Reason**: Command bodies no longer exist; only skill bodies remain, generated from the skill templates.
**Migration**: None.

### Requirement: Legacy cleanup for renamed OpenCode command directory
**Reason**: Cleanup of legacy OpenCode command files is retained as behavior but relocated: it no longer lives in the command-generation module (which is deleted) and no longer generates replacement command files. The cleanup of old and current rasen command files across all tools is defined by the `legacy-cleanup` capability's new "Retired command files are pruned on init and update" requirement.
**Migration**: `rasen init`/`rasen update` still remove old `.opencode/command/` (singular) and other legacy command artifacts; they no longer write new command files.
