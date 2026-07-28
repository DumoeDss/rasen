import { describe, it, expect } from 'vitest';

import {
  workflowChoices,
  unselectedBuiltInWorkflowDisplayIds,
  type ProfileState,
} from '../../src/commands/profile-editor.js';
import {
  getProfilePromptMessages,
  getProfileUiMessages,
} from '../../src/commands/profile-messages.js';
import { ALL_WORKFLOWS, ALL_EXPERTS } from '../../src/core/profiles.js';

// Minimal stand-in for @inquirer/prompts' Separator: workflowChoices only
// constructs it for the group labels, never reads it back for real choices.
class FakeSeparator {
  type = 'separator' as const;
  separator: string;
  constructor(separator = '') {
    this.separator = separator;
  }
}

function findChoice(
  choices: ReturnType<typeof workflowChoices>,
  value: string
): { value: string; checked: boolean } | undefined {
  return choices.find(
    (choice): choice is { value: string; checked: boolean } & Record<string, unknown> =>
      typeof choice === 'object' && choice !== null && 'value' in choice && (choice as { value: string }).value === value
  ) as { value: string; checked: boolean } | undefined;
}

describe('profile editor picker faithfulness (D4)', () => {
  it('renders an unselected, non-required built-in workflow as unchecked', () => {
    // A custom selection that omits `audit`; nothing selected requires it.
    const state: ProfileState = { profile: 'custom', workflows: ['propose'] };
    const choices = workflowChoices(
      state,
      getProfilePromptMessages('en'),
      FakeSeparator as unknown as never
    );

    const audit = findChoice(choices, 'audit');
    expect(audit).toBeDefined();
    expect(audit!.checked).toBe(false);

    const propose = findChoice(choices, 'propose');
    expect(propose!.checked).toBe(true);
  });
});

describe('unselectedBuiltInWorkflowDisplayIds (editor discoverability)', () => {
  it('names an unselected built-in workflow for a custom selection', () => {
    const state: ProfileState = { profile: 'custom', workflows: ['propose'] };
    const unselected = unselectedBuiltInWorkflowDisplayIds(state);
    expect(unselected).toContain('audit');
    // A selected workflow is not surfaced.
    expect(unselected).not.toContain('propose');
  });

  it('is empty when every built-in workflow is selected (full profile)', () => {
    const state: ProfileState = {
      profile: 'full',
      workflows: [...ALL_WORKFLOWS, ...ALL_EXPERTS],
    };
    expect(unselectedBuiltInWorkflowDisplayIds(state)).toEqual([]);
  });

  it('formats the localized available-but-unselected note', () => {
    const note = getProfileUiMessages('en').availableBuiltInsNote(['audit']);
    expect(note).toContain('audit');
    expect(note).toContain('Available but not selected');
  });
});
