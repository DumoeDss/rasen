import { describe, expect, it } from 'vitest';

import { getSkillTemplates } from '../../../src/core/shared/skill-generation.js';
import { getArchiveChangeSkillTemplate } from '../../../src/core/templates/workflows/archive-change.js';
import { getDirectionSkillTemplate } from '../../../src/core/templates/workflows/direction.js';

describe('generated planning-scope guidance', () => {
  it('never teaches a flat Store Change, specs, or project-partition path', () => {
    const offenders: string[] = [];
    const flatPlanningPath = /(?<!\.)\brasen\/(?:changes|specs|projects)(?:\/|\b)/u;
    const siblingAlgorithm = /(?:planningHome\.changesDir|root\.path)[^\n]{0,160}\b(?:sibling|archive|rasen)\b/iu;

    for (const { dirName, template } of getSkillTemplates()) {
      if (flatPlanningPath.test(template.instructions) || siblingAlgorithm.test(template.instructions)) {
        offenders.push(dirName);
      }
    }

    expect(
      offenders,
      'Use root.scope.paths, changeRoot, artifactPaths, archive.archiveDir, evidenceDir, handoffDir, or ephemeraDir from CLI JSON; never reconstruct Store planning paths.'
    ).toEqual([]);
  });

  it('keeps the standalone design-doc fallback behind typed-scope failure checks', () => {
    for (const { dirName, template } of getSkillTemplates()) {
      if (!template.instructions.includes('$DOCS_ROOT/rasen/design-docs')) continue;
      expect(template.instructions, dirName).toContain(
        '.root.scope.paths["project-design-docs"]'
      );
      expect(template.instructions, dirName).toContain(
        'The selected planning scope does not expose project-design-docs'
      );
      expect(template.instructions, dirName).toContain('git rev-parse --show-toplevel');
    }
  });

  it('pins Archive and Direction to their typed locations', () => {
    const archive = getArchiveChangeSkillTemplate().instructions;
    expect(archive).toContain('root.scope.paths["active-changes"]');
    expect(archive).toContain('root.scope.paths["archive-line"]');
    expect(archive).toContain('root.scope.paths.specs');
    expect(archive).toContain('archive.archiveDir');
    expect(archive).not.toContain('<root.path>/rasen/changes');

    const direction = getDirectionSkillTemplate().instructions;
    expect(direction).toContain('root.scope.paths["project-work"]');
    expect(direction).not.toContain('sibling of the CLI-resolved changes directory');
  });
});
