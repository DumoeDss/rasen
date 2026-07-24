import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getRetainCommandSkillTemplate,
  getRetroCommandSkillTemplate,
  RETRO_COMPAT_WRAPPER_DIR_NAME,
} from '../../../src/core/templates/skill-templates.js';
import { copySkillSidecars } from '../../../src/core/shared/skill-generation.js';

const repoRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

describe('rasen-retain router and sidecars', () => {
  it('is a shallow router that loads only the matching branch', () => {
    const body = getRetainCommandSkillTemplate().instructions;
    // Names each mode and the conditional sidecars; off loads neither.
    expect(body).toContain('report.md');
    expect(body).toContain('codify.md');
    expect(body).toMatch(/off/);
    expect(body).toMatch(/Do NOT load .*report\.md.* or .*codify\.md/);
    // A router body, not the substantive contract: the long report/codify
    // procedures live in the sidecars, not inline.
    expect(body).not.toContain('git shortlog');
    expect(body).not.toContain('rasen knowledge apply');
    // No colon-form slash-command references.
    expect(body).not.toMatch(/\/rasen:/);
  });

  it('ships the report and codify sidecars in the published skills tree', () => {
    const sidecarDir = path.join(repoRoot, 'skills', 'workflows', 'rasen-retain');
    expect(fs.existsSync(path.join(sidecarDir, 'report.md'))).toBe(true);
    expect(fs.existsSync(path.join(sidecarDir, 'codify.md'))).toBe(true);

    const report = fs.readFileSync(path.join(sidecarDir, 'report.md'), 'utf-8');
    expect(report).toContain('retro.md');
    expect(report).toContain('retro-latest.md');
    const codify = fs.readFileSync(path.join(sidecarDir, 'codify.md'), 'utf-8');
    expect(codify).toContain('rasen knowledge apply');
    expect(codify).toContain('untrusted');
  });

  it('copies the retain sidecars next to a generated SKILL.md', () => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-retain-sidecar-'));
    try {
      copySkillSidecars('retain-command', targetDir);
      expect(fs.existsSync(path.join(targetDir, 'report.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'codify.md'))).toBe(true);
    } finally {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
  });
});

describe('rasen-retro compatibility wrapper', () => {
  it('is user-invoked only and forces report mode', () => {
    const wrapper = getRetroCommandSkillTemplate();
    expect(wrapper.name).toBe(RETRO_COMPAT_WRAPPER_DIR_NAME);
    expect(wrapper.name).toBe('rasen-retro');
    expect(wrapper.disableModelInvocation).toBe(true);
    expect(wrapper.instructions).toContain('report');
    expect(wrapper.instructions).toMatch(/compatibility/i);
    // The wrapper never codifies.
    expect(wrapper.instructions).not.toContain('rasen knowledge apply');
  });
});
