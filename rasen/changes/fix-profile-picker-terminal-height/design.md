## Context

The shared workflow/expert checkbox currently sets `pageSize` to the complete choice count and builds the same choices twice. The built-in catalog contributes 22 workflows, 21 experts, and two group separators, so the prompt can require about 50 rendered rows after the question, spacer, active description, and instructions are included. `promptForNewProfileState()` serves `rasen profile new`; `runInteractiveProfileEditor()` serves both `rasen profile` and `rasen config profile`, so a local fix at only one call site would leave the same overflow elsewhere.

Inquirer treats `pageSize` as the choice-list line budget and does not derive it from terminal height. Its checkbox default is seven. Rasen already bounds active descriptions to two visual lines and resolves terminal width in `src/utils/terminal-text.ts`; terminal-height discovery belongs beside that stream-oriented utility, while the five-row picker reserve remains profile-picker policy.

## Goals / Non-Goals

**Goals:**

- Snapshot the output terminal height when each workflow/expert picker opens.
- Keep the choice viewport within the known height after reserving five rows for the question, spacer, up to two description lines, and instructions.
- Use a seven-line fallback when height is unavailable or invalid, a one-line lower bound for valid extremely short terminals, and the choice count as the upper bound.
- Preserve every choice and all existing selection, localization, description, shortcut, dependency, and persistence behavior.
- Route named-profile creation and current-profile editing through one options builder.
- Keep terminal-size handling cross-platform and dependency-free.

**Non-Goals:**

- Live recalculation while an already-open prompt is resized.
- A custom Inquirer prompt or reliance on Inquirer private APIs.
- New wrapping rules for questions, instructions, choice names, or descriptions.
- Applying height-aware pagination to unrelated selects or checkboxes.
- Changes to locale catalogs, profile storage, global config, JSON output, dependencies, or lockfiles.

## Decisions

### 1. Resolve terminal rows through a defensive stream utility

Add `resolveTerminalRows(output = process.stdout)` to `src/utils/terminal-text.ts`. A minimal structural stream type exposes optional `rows` and `getWindowSize()`. The helper returns only a positive integer: it prefers `output.rows`, then tries the second tuple entry from `getWindowSize()`, and returns `undefined` for missing, non-finite, non-integer, non-positive, or throwing values.

This mirrors the existing terminal-column responsibility without changing `resolveTerminalColumns()`. Reading `process.stdout` matches Inquirer's current default output context. The structural type avoids private Node or Inquirer APIs and permits focused fake-stream tests on macOS, Linux, and Windows.

Alternatives considered:

- Read only `process.stdout.rows`: simpler, but misses streams that expose height only through `getWindowSize()`.
- Use `stty`, environment variables, or a new package: rejected as platform-specific or unnecessary.
- Put row normalization in `profile-editor.ts`: rejected because raw terminal stream discovery is not profile-domain policy.

### 2. Keep page-size policy profile-specific and pure

Define `DEFAULT_WORKFLOW_PICKER_PAGE_SIZE = 7`, `WORKFLOW_PICKER_RESERVED_ROWS = 5`, and a pure `resolveWorkflowPickerPageSize(choiceCount, terminalRows)` in `profile-editor.ts`.

For unavailable or invalid rows, return `min(choiceCount, 7)`. For valid rows, return `min(choiceCount, max(1, terminalRows - 5))`. The five reserved rows are the current maximum outside the list: question (1), spacer (1), active description (2), and instructions (1). Treating `pageSize` as a rendered-line budget lets Inquirer continue handling wrapped choices.

Alternatives considered:

- Omit `pageSize` and accept Inquirer's fixed default of seven: fixes overflow in many terminals but does not use available space and can still overflow terminals shorter than the reserve plus seven.
- Use a fixed 10- or 20-row page: reproduces the bug at different terminal heights.
- Generalize the policy for every prompt: rejected because reserve requirements differ and this bug is scoped to the profile workflow/expert picker.

### 3. Build workflow picker options once through one integration seam

Add a private `workflowPickerOptions(currentState, messages, SeparatorCtor)` builder. It constructs `workflowChoices()` once, snapshots `resolveTerminalRows(process.stdout)` once, derives `pageSize` from that same array's length, and returns the existing message, instructions, shortcuts, theme, and choices unchanged. Both checkbox calls use this builder.

This prevents choice-count/config drift, ensures all three CLI entry points share the policy, and removes duplicate catalog work without changing choice metadata or selected values.

Alternative considered: duplicate the height calculation at both call sites. Rejected because it would preserve the current duplicated options and make future divergence likely.

### 4. Test observable seams with explicit height snapshots

Utility tests cover stream row precedence, `getWindowSize()` fallback, invalid values, and throwing accessors. Pure policy tests use the fixed contract vectors. Command tests set and restore the `process.stdout.rows` property descriptor, invoke the real profile command/editor paths with mocked prompts, and assert page size separately from the full choice count and persisted result.

The prompt test seam is the public options passed to `@inquirer/prompts`, which is the last stable application-owned boundary before terminal rendering. Manual TTY smoke checks remain necessary for cursor movement and actual viewport behavior.

## Risks / Trade-offs

- [Question or instructions wrap in an extremely narrow terminal and exceed the five-row reserve] → Keep the existing two-line description bound, document the width limitation, and treat dynamic header/help measurement as a separate improvement.
- [Terminal size changes while the prompt is open] → Keep the opening snapshot stable; reopening the prompt captures the new size. This avoids custom renderer and listener lifecycle complexity.
- [A stream exposes throwing `rows` or `getWindowSize()` access] → Catch both accesses and fall back safely.
- [Global `process.stdout.rows` mutation leaks between tests] → Save and restore the original property descriptor in `afterEach`/`finally`, and run the focused regression deterministically.
- [Future Inquirer rendering changes alter the five-row assumption] → Keep the reserve rationale next to the constant and re-run manual TTY checks when upgrading Inquirer.

## Migration Plan

No data migration is required. The change is an interactive presentation adjustment with no persisted-format or machine-contract changes. Rollback consists of reverting the utility, options builder, and related tests/spec scenario.

## Open Questions

None. Live resize and narrower-terminal header/help wrapping are explicitly deferred.
