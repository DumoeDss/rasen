## Why

The workflow and expert checkbox picker renders every choice at once because its page size equals the full catalog size. With 45 built-in rows today, the picker and its instructions overflow common and short terminal viewports, affecting `rasen profile new`, `rasen profile`, and the compatible `rasen config profile` entry point.

## What Changes

- Size the workflow/expert picker from the terminal height captured when the prompt opens, reserving space for the question, active description, spacer, and instructions.
- Fall back to a safe seven-choice page when terminal height is unavailable, while keeping at least one choice visible in extremely short terminals and showing all choices when they fit.
- Use one shared picker-options builder for named-profile creation and current-profile editing so all three CLI entry points behave consistently.
- Preserve every workflow, expert, separator, localized label, shortcut, checked state, disabled dependency, and profile persistence contract; choices outside the viewport remain reachable through navigation.
- Treat prompt-time terminal resize as outside this change: a newly opened prompt captures the current height again.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `profiles`: Define height-aware pagination for the shared interactive workflow/expert picker across all profile entry points.

## Impact

- Affects terminal-size handling in `src/utils/terminal-text.ts` and workflow picker construction in `src/commands/profile-editor.ts`.
- Adds focused utility and command regression coverage under `test/utils/` and `test/commands/`.
- Changes only interactive human presentation; command syntax, locale catalogs, profile files, global config, JSON output, dependencies, and lockfiles remain unchanged.
