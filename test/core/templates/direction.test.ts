import { describe, expect, it } from 'vitest';

import {
  getAutoCommandSkillTemplate,
  getDirectionSkillTemplate,
  getGoalCommandSkillTemplate,
  getHelpSkillTemplate,
  getNavigatorSkillTemplate,
  getOpsxProposeSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { generateSkillContent } from '../../../src/core/shared/skill-generation.js';
import { STORE_SELECTION_GUIDANCE } from '../../../src/core/templates/workflows/store-selection.js';

describe('rasen-direction template contract', () => {
  const template = getDirectionSkillTemplate();
  const body = template.instructions;

  it('has the canonical identity, shared Store guidance, five explicit actions, and optional stance', () => {
    expect(template.name).toBe('rasen-direction');
    expect(body).toContain(STORE_SELECTION_GUIDANCE);
    for (const action of ['## Establish', '## Calibrate', '## Select', '## Project', '## Reconcile']) {
      expect(body).toContain(action);
    }
    expect(body).toContain('Direction is opt-in');
    expect(body).toContain('Absence is healthy');
    expect(body).toContain('Never interpret a general implementation request as Establish');
  });

  it('resolves the planning root through CLI JSON and guards cross-platform references', () => {
    expect(body).toContain('rasen context --json');
    expect(body).toContain('planningHome.root');
    expect(body).toContain('planningHome.changesDir');
    expect(body).toContain('platform-native path');
    expect(body).toContain('remains inside the selected planning root');
    expect(body).toContain('absolute-outside-root');
    expect(body).toContain('Calibrate, Select, Project, or Reconcile');
    expect(body).toContain('successful no-mutation result');
    expect(body).toContain('Establish this workstream with `rasen-direction`');
  });

  it('pins the thin experimental artifacts, statuses, and authority/source-of-truth boundaries', () => {
    for (const artifact of [
      'work.yaml',
      'north-star.md',
      'target-state.md',
      'roadmap.md',
      'spec.md',
      'plan.md',
      'result.md',
      'log.md',
    ]) {
      expect(body).toContain(artifact);
    }
    expect(body).toContain('draft | active | paused | completed | superseded');
    expect(body).toContain('zero or one');
    expect(body).toContain('North Star (optional)');
    expect(body).toContain('> Target State');
    expect(body).toContain('> Roadmap');
    expect(body).toContain('accepted current product behavior comes from main specs and implementation');
    expect(body).toContain('active execution comes from current Run/Session state');
    expect(body).toContain('not a stable public schema');
  });

  it('keeps Direction Target State distinct from rasen-goal and legacy goal.md read-only', () => {
    expect(body).toContain('New Direction work always writes `target-state.md`');
    expect(body).toContain('`goal-plan.md` and `goal-run.json`');
    expect(body).toContain('legacy Target State input');
    expect(body).toContain('must not rename, overwrite, delete, or migrate `goal.md`');
    expect(body).toContain('preserve `goal.md` unless the user separately authorizes removal');
  });

  it('pins Establish and Calibrate confirmation/evidence boundaries', () => {
    expect(body).toContain('semantic duplicate');
    expect(body).toContain('Default to **no separate North Star**');
    expect(body).toContain('`status: draft`');
    expect(body).toContain('until the user confirms');
    expect(body).toContain('observable reality');
    expect(body).toContain('change to Target State outcome, scope, success criteria, or locked decisions as material');
    expect(body).toContain('wait for human confirmation before applying it');
    expect(body).toContain('document/module existence as acceptance evidence');
  });

  it('pins Select and Project to one accepted Slice and existing downstream workflows', () => {
    expect(body).toContain('at most one active Slice');
    expect(body).toContain('observable acceptance and evidence source');
    expect(body).toContain('Multiple Changes remain inside this one Slice acceptance contract');
    expect(body).toContain('independently deliverable as one Change → `rasen-propose`');
    expect(body).toContain('multiple independently deliverable Changes → `auto-decompose`');
    expect(body).toContain('Never send the whole Roadmap to `auto-decompose`');
    expect(body).toContain('Never implement code or execute downstream tasks from Direction');
  });

  it('pins evidence-backed reconciliation, terminal states, and byte-preserving North Star protection', () => {
    expect(body).toContain('passed | partial | failed | superseded | cancelled');
    expect(body).toContain('Completion of every projected Change is insufficient by itself for `passed`');
    expect(body).toContain('missing or stale Changes, branches, PRs, artifacts, or revisions');
    expect(body).toContain('`completed` only when Target State is satisfied');
    expect(body).toContain('`paused` when an external condition or decision is required');
    expect(body).toContain('`superseded` when another workstream replaced it');
    expect(body).toContain('byte-for-byte unchanged');
    expect(body).toContain('separately displayed proposal pending explicit approval');
  });

  it('renders a durable report contract with exactly one next action', () => {
    const generated = generateSkillContent(template, 'test');
    expect(generated).toContain('## Final report');
    expect(generated).toContain('exactly one recommended next action');
    expect(generated).not.toMatch(/\/rasen:/);
  });
});

describe('Direction routing stays explicit and non-coercive', () => {
  it('help and navigator route long-horizon needs while distinguishing the bounded goal loop', () => {
    const help = getHelpSkillTemplate().instructions;
    const navigator = getNavigatorSkillTemplate().instructions;

    expect(help).toContain('rasen-direction');
    expect(help).toContain('ordinary bugs and features still go directly through the Change flow');
    expect(help).toContain('bounded plan → iterate → report loop');
    expect(help).toContain('cross-Change `target-state.md`');

    expect(navigator).toContain('## Optional long-horizon governance');
    expect(navigator).toContain('rasen-direction');
    expect(navigator).toContain('never a required numbered step');
    expect(navigator).toContain('bounded iteration toward one measure');
  });

  it('does not add a Direction prerequisite or implicit handoff to ordinary workflow templates', () => {
    for (const ordinary of [
      getOpsxProposeSkillTemplate(),
      getAutoCommandSkillTemplate(),
      getGoalCommandSkillTemplate(),
    ]) {
      expect(ordinary.instructions, ordinary.name).not.toContain('rasen-direction');
      expect(ordinary.instructions, ordinary.name).not.toContain('target-state.md');
    }
  });
});
