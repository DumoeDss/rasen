import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  getApplyChangeSkillTemplate,
  getExploreSkillTemplate,
  getHelpSkillTemplate,
  getOpsxProposeSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('consolidated expert host references', () => {
  it.each([
    {
      name: 'propose/codebase-design',
      body: getOpsxProposeSkillTemplate().instructions,
      reference: 'references/codebase-design/README.md',
      trigger: 'design-dense change',
      notInlined: 'Design It Twice',
    },
    {
      name: 'apply/tdd',
      body: getApplyChangeSkillTemplate().instructions,
      reference: 'references/tdd/README.md',
      trigger: 'test-first work is selected',
      notInlined: 'Writing Good Tests',
    },
    {
      name: 'explore/prototype',
      body: getExploreSkillTemplate().instructions,
      reference: 'references/prototype/README.md',
      trigger: 'bounded way to settle it',
      notInlined: 'Logic Prototype',
    },
  ])('$name is a shallow conditional router', ({ body, reference, trigger, notInlined }) => {
    expect(body).toContain(reference);
    expect(body).toContain(trigger);
    expect(body).toMatch(/load it only|do not load/i);
    expect(body).not.toContain(notInlined);
  });

  it('preserves change-root capture and throwaway cleanup where those branches need it', () => {
    expect(getOpsxProposeSkillTemplate().instructions).toContain('changeRoot');
    expect(getApplyChangeSkillTemplate().instructions).toContain('changeRoot');
    const explore = getExploreSkillTemplate().instructions;
    expect(explore).toContain('changeRoot');
    expect(explore).toContain('delete every piece of throwaway code');
  });

  it('keeps Design-It-Twice usable under the flat rasen-auto leaf contract', () => {
    const designTwice = fs.readFileSync(path.join(
      repositoryRoot,
      'skills',
      'workflows',
      'rasen-propose',
      'references',
      'codebase-design',
      'DESIGN-IT-TWICE.md'
    ), 'utf8');

    expect(designTwice).toContain('Standalone `rasen-propose`, with delegation explicitly available');
    expect(designTwice).toContain('dispatched planner leaf under `rasen-auto`');
    expect(designTwice).toContain('do **not** spawn or delegate');
    expect(designTwice).toContain('Draft 3+ radically different interfaces sequentially');
    expect(designTwice).toContain('LEAD-owned fan-out request');
    expect(designTwice).toContain('must never block artifact completion');
  });

  it('makes every Explore prototype deep branch capture the decision and delete all probe code', () => {
    const prototypeRoot = path.join(
      repositoryRoot,
      'skills',
      'workflows',
      'rasen-explore',
      'references',
      'prototype'
    );
    const logic = fs.readFileSync(path.join(prototypeRoot, 'LOGIC.md'), 'utf8');
    const ui = fs.readFileSync(path.join(prototypeRoot, 'UI.md'), 'utf8');

    for (const reference of [logic, ui]) {
      expect(reference).toContain('changeRoot');
      expect(reference).toContain('`rasen-propose`/`rasen-apply-change`');
      expect(reference).toMatch(/delete/i);
    }
    expect(logic).toContain('both the TUI and this logic module are throwaway probe code');
    expect(logic).toContain('delete the reducer / machine / function set together with the TUI shell and task-runner entry');
    expect(ui).toContain('delete the throwaway route, every variant, and the switcher');
    expect(ui).toContain('do not use a production commit, route, or component as the durable record');
    expect(logic).not.toContain("the logic module shouldn't be");
    expect(ui).not.toContain('promote the winning variant to a real route');
    expect(ui).not.toContain('fold the winner into the existing page');
  });

  it('keeps help lazy and one-next-action after navigator absorption', () => {
    const help = getHelpSkillTemplate().instructions;
    expect(help).toContain('references/navigator.md');
    expect(help).toContain('Load the detailed map only when needed');
    expect(help).toContain('Close with one next action');
    expect(help).not.toContain('# Rasen navigator');
  });

  it('keeps retain before archive and the retro alias outside the navigator main flow', () => {
    const navigator = fs.readFileSync(path.join(
      repositoryRoot,
      'skills',
      'workflows',
      'rasen-help',
      'references',
      'navigator.md'
    ), 'utf8');

    expect(navigator.indexOf('**`rasen-ship`**')).toBeLessThan(navigator.indexOf('**`rasen-retain`**'));
    expect(navigator.indexOf('**`rasen-retain`**')).toBeLessThan(navigator.indexOf('**`rasen-archive-change`**'));
    expect(navigator).toContain('`rasen-retro` is a temporary user-invoked compatibility alias');
    expect(navigator).toContain('not a separate profile route');
  });

  it('preserves MIT attribution in every adapted methodology and navigator file', () => {
    const roots = [
      path.join(repositoryRoot, 'skills', 'workflows', 'rasen-propose', 'references', 'codebase-design'),
      path.join(repositoryRoot, 'skills', 'workflows', 'rasen-apply-change', 'references', 'tdd'),
      path.join(repositoryRoot, 'skills', 'workflows', 'rasen-explore', 'references', 'prototype'),
    ];
    const files = roots.flatMap((root) => fs.readdirSync(root).map((name) => path.join(root, name)));
    files.push(path.join(
      repositoryRoot,
      'skills',
      'workflows',
      'rasen-help',
      'references',
      'navigator.md'
    ));

    for (const file of files) {
      expect(fs.readFileSync(file, 'utf8')).toMatch(/MIT.*Copyright Matt Pocock/);
    }
  });
});
