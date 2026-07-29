import { describe, expect, it } from 'vitest';

import { resolveCliPresentation } from '../../../../src/core/completions/cli-presentation.js';
import { BashGenerator } from '../../../../src/core/completions/generators/bash-generator.js';
import { FishGenerator } from '../../../../src/core/completions/generators/fish-generator.js';
import { PowerShellGenerator } from '../../../../src/core/completions/generators/powershell-generator.js';
import { ZshGenerator } from '../../../../src/core/completions/generators/zsh-generator.js';

describe('completion generators consume resolved presentation', () => {
  const presentation = resolveCliPresentation({
    locale: 'ja',
    facts: {
      availableToolIds: ['claude', 'codex'],
      defaultSchema: 'spec-driven',
      workspaceDir: 'rasen',
    },
  });

  it.each([
    ['bash', new BashGenerator()],
    ['fish', new FishGenerator()],
    ['powershell', new PowerShellGenerator()],
    ['zsh', new ZshGenerator()],
  ] as const)('projects canonical aliases before rendering %s', (_shell, generator) => {
    const script = generator.generate(presentation.completionCommands);
    expect(script).toContain('store');
    expect(script).toContain('list');
    expect(script).toContain('ls');
  });

  it('preserves static completion values after resolution', () => {
    const script = new ZshGenerator().generate(presentation.completionCommands);
    expect(script).toContain(':value:(global project)');
  });

  it('uses the same localized copy in description-capable shells', () => {
    const profile = presentation.completionCommands.find(
      (command) => command.name === 'profile',
    );
    expect(profile).toBeDefined();

    for (const generator of [
      new FishGenerator(),
      new PowerShellGenerator(),
      new ZshGenerator(),
    ]) {
      expect(generator.generate(presentation.completionCommands)).toContain(
        profile?.description,
      );
    }
  });
});
