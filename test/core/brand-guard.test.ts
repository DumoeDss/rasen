import { describe, it, expect } from 'vitest';
import {
  getSkillTemplates,
  generateSkillContent,
} from '../../src/core/shared/skill-generation.js';

/**
 * Brand guard: no generated artifact (command file paths, command file bodies,
 * skill directory names, skill file content) may carry a legacy namespace
 * token. Legacy tokens live only in migration/detection code, which this test
 * does not exercise.
 *
 * Forbidden tokens (spec: command-generation "Generated output is free of
 * legacy namespace tokens"):
 *   - `opsx` (any case)   legacy command prefix AND `OPSX:`/`OPSX` display names —
 *                         case-insensitive so uppercase display leaks are caught too
 *   - `commands/opsx/`    legacy command subdirectory
 *   - `openspec-`         legacy skill directory / skill reference prefix
 *   - `openspec:`         legacy expert-skill name prefix
 *   - `openspec/` path    bare legacy workspace path in a body/hint (the workspace
 *                         is `rasen/`). The `.openspec.yaml` filename and
 *                         `.openspec-store` metadata dir use `.`/`-`, not a slash,
 *                         so this check leaves those whitelist tokens untouched.
 */
const FORBIDDEN: Array<{ label: string; test: (s: string) => boolean }> = [
  { label: 'opsx / OPSX (any case)', test: (s) => /opsx/i.test(s) },
  { label: 'commands/opsx/', test: (s) => s.replace(/\\/g, '/').includes('commands/opsx/') },
  { label: 'openspec- skill ref', test: (s) => s.includes('openspec-') },
  { label: 'openspec: name', test: (s) => s.includes('openspec:') },
  { label: 'openspec/ workspace path', test: (s) => /openspec[\\/]/.test(s) },
];

function assertClean(where: string, text: string): void {
  for (const token of FORBIDDEN) {
    expect(token.test(text), `${where} must not contain legacy token "${token.label}"`).toBe(false);
  }
}

describe('brand guard — generated output carries no legacy namespace tokens', () => {
  const VERSION = '0.0.0-test';

  it('skill directory names are all rasen-prefixed and legacy-token-free', () => {
    for (const entry of getSkillTemplates()) {
      expect(entry.dirName.startsWith('rasen-')).toBe(true);
      assertClean(`skill dirName ${entry.dirName}`, entry.dirName);
      assertClean(`skill name ${entry.template.name}`, entry.template.name);
    }
  });

  it('generated skill file content is legacy-token-free', () => {
    for (const entry of getSkillTemplates()) {
      const content = generateSkillContent(entry.template, VERSION);
      assertClean(`skill content ${entry.dirName}`, content);
    }
  });

});
