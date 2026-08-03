import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { getLocaleCatalog } from '../../../src/locales/index.js';
import { copySkillSidecars } from '../../../src/core/shared/skill-generation.js';
import {
  getWorkflowAuthorSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { getExpertSkillDefinitions } from '../../../src/core/workflow-registry/index.js';

const cleanup: string[] = [];

afterEach(() => {
  for (const directory of cleanup.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('workflow author and review expert skills', () => {
  it('registers workflow-author as the sole expert identity with localized bundled-review guidance', () => {
    const experts = getExpertSkillDefinitions();
    expect(experts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workflow-author', dirName: 'rasen-workflow-author' }),
    ]));
    expect(experts.map((expert) => expert.id)).not.toContain('workflow-review');
    expect(getLocaleCatalog('en').expertSkills.workflowAuthor).toContain('staging');
    expect(getLocaleCatalog('ja').expertSkills.workflowAuthor).toContain('レビュー');
  });

  it('keeps authoring in staging and delegates all permanent writes to workflow import', () => {
    const instructions = getWorkflowAuthorSkillTemplate().instructions;
    expect(instructions).toContain('rasen workflow list --json');
    expect(instructions).toContain('rasen workflow init <id> --output');
    expect(instructions).toContain('rasen workflow validate <staging-path> --json');
    expect(instructions).toContain('references/workflow-review/README.md');
    expect(instructions).toContain('Only after the user asks to install');
    expect(instructions).toContain('rasen workflow import <staging-path>');
    expect(instructions).toContain('Never edit the user-wide workflow registry directly');
    expect(instructions).not.toMatch(/(?:mkdir|cp|mv)\s+[^\n]*\/workflows/);
  });

  it('requires an independent semantic review with structured security findings', () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundled-review-body-'));
    cleanup.push(destination);
    copySkillSidecars('workflow-author', destination);
    const instructions = fs.readFileSync(
      path.join(destination, 'references', 'workflow-review', 'README.md'),
      'utf8'
    );
    for (const expected of [
      'reviewer who did not author',
      'purpose, trigger, scope, inputs, outputs, completion, and escalation',
      'destructive, network, secret, and external writes',
      'shell interpolation, path traversal, credential handling',
      '[severity] location',
      'Evidence:',
      'Required fix:',
      'not a signature',
    ]) {
      expect(instructions).toContain(expected);
    }
  });

  it('packages the review checklist beside the generated skill', () => {
    const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-bundled-review-skill-'));
    cleanup.push(destination);

    copySkillSidecars('workflow-author', destination);

    const checklistPath = path.join(destination, 'references', 'workflow-review', 'checklist.md');
    expect(fs.existsSync(checklistPath)).toBe(true);
    const checklist = fs.readFileSync(checklistPath, 'utf8');
    expect(checklist).toContain('Security and user control');
    expect(checklist).toContain('Completion and failure behavior');
    expect(checklist).toContain('Do not execute any script');
  });
});
