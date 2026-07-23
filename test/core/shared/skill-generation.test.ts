import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse as parseYaml } from 'yaml';
import {
  getSkillTemplates,
  generateSkillContent,
  copySkillSidecars,
} from '../../../src/core/shared/skill-generation.js';

describe('skill-generation', () => {
  describe('getSkillTemplates', () => {
    it('should return all skill templates (23 workflow + 21 expert)', () => {
      const templates = getSkillTemplates();
      expect(templates).toHaveLength(44);
    });

    it('should include the opt-in review-cycle workflow skill', () => {
      const templates = getSkillTemplates();
      const reviewCycle = templates.find(t => t.workflowId === 'review-cycle');
      expect(reviewCycle).toBeDefined();
      expect(reviewCycle?.dirName).toBe('rasen-review-cycle');
      expect(reviewCycle?.template.name).toBe('rasen-review-cycle');
    });

    it('should have unique directory names', () => {
      const templates = getSkillTemplates();
      const dirNames = templates.map(t => t.dirName);
      const uniqueDirNames = new Set(dirNames);
      expect(uniqueDirNames.size).toBe(templates.length);
    });

    it('should include all expected skills', () => {
      const templates = getSkillTemplates();
      const dirNames = templates.map(t => t.dirName);

      expect(dirNames).toContain('rasen-explore');
      expect(dirNames).toContain('rasen-new-change');
      expect(dirNames).toContain('rasen-continue-change');
      expect(dirNames).toContain('rasen-apply-change');
      expect(dirNames).toContain('rasen-sync-specs');
      expect(dirNames).toContain('rasen-archive-change');
      expect(dirNames).toContain('rasen-bulk-archive-change');
      expect(dirNames).toContain('rasen-verify-change');
      expect(dirNames).toContain('rasen-onboard');
      expect(dirNames).toContain('rasen-propose');
      expect(dirNames).toContain('rasen-goal-plan');
      expect(dirNames).toContain('rasen-goal-iterate');
      expect(dirNames).toContain('rasen-goal-report');
      expect(dirNames).toContain('rasen-goal');
    });

    it('should have valid template structure', () => {
      const templates = getSkillTemplates();

      for (const { template, dirName, workflowId } of templates) {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(template.instructions).toBeTruthy();
        expect(dirName).toBeTruthy();
        expect(workflowId).toBeTruthy();
      }
    });

    it('should have unique workflow IDs', () => {
      const templates = getSkillTemplates();
      const ids = templates.map(t => t.workflowId);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(templates.length);
    });

    // Post-6b-flip: getSkillTemplates no longer force-installs every expert
    // regardless of filter (design.md D3) — a filter selects exactly the
    // ids passed in (resolved through requires.workflows only, since this
    // function's own resolution stays workflow-only; callers thread the
    // closure-included desired set in as the filter — see
    // resolveDesiredWorkflowSelection in profiles.ts).
    it('should filter to exactly the given IDs when no expert is requested', () => {
      const filtered = getSkillTemplates(['propose', 'explore', 'apply', 'archive']);
      expect(filtered).toHaveLength(4);
      const ids = filtered.map(t => t.workflowId);
      expect(ids).toEqual(['propose', 'explore', 'apply', 'archive']);
      expect(ids).not.toContain('new');
    });

    it('should return all templates when filter is undefined', () => {
      const all = getSkillTemplates();
      const noFilter = getSkillTemplates(undefined);
      expect(noFilter).toHaveLength(all.length);
    });

    it('should return an empty array when filter matches no known id', () => {
      const filtered = getSkillTemplates(['nonexistent']);
      expect(filtered).toHaveLength(0);
    });

    it('should return exactly one template when filter has one workflow (no expert leaks in)', () => {
      const filtered = getSkillTemplates(['propose']);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].workflowId).toBe('propose');
      expect(filtered[0].dirName).toBe('rasen-propose');
    });

    it('should install an expert when its id is explicitly included in the filter', () => {
      const filtered = getSkillTemplates(['propose', 'review']);
      expect(filtered).toHaveLength(2);
      const ids = filtered.map(t => t.workflowId);
      expect(ids).toContain('propose');
      expect(ids).toContain('review');
    });
  });

  describe('copySkillSidecars', () => {
    let target: string;

    function allFiles(dir: string, prefix = ''): string[] {
      if (!existsSync(dir)) return [];
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...allFiles(join(dir, entry.name), rel));
        else out.push(rel);
      }
      return out;
    }

    beforeEach(() => {
      target = mkdtempSync(join(tmpdir(), 'rasen-sidecar-'));
    });

    afterEach(() => {
      rmSync(target, { recursive: true, force: true });
    });

    it('copies root .md sidecars but never SKILL.md or *.tmpl', () => {
      copySkillSidecars('review', target);
      const files = allFiles(target);
      // review/ has checklist.md, design-checklist.md, greptile-triage.md, TODOS-format.md
      expect(files).toContain('checklist.md');
      expect(files).toContain('design-checklist.md');
      expect(files).toContain('TODOS-format.md');
      // SKILL.md and SKILL.md.tmpl must be excluded
      expect(files).not.toContain('SKILL.md');
      expect(files.some(f => f.endsWith('.tmpl'))).toBe(false);
    });

    it('copies .sh sidecars preserving subdirectory structure', () => {
      copySkillSidecars('investigate', target);
      expect(existsSync(join(target, 'scripts', 'hitl-loop.template.sh'))).toBe(true);
      // no SKILL.md leaked in
      expect(existsSync(join(target, 'SKILL.md'))).toBe(false);
    });

    it('copies .md sidecars nested under references/ and templates/', () => {
      copySkillSidecars('qa', target);
      expect(existsSync(join(target, 'references', 'issue-taxonomy.md'))).toBe(true);
      expect(existsSync(join(target, 'templates', 'qa-report-template.md'))).toBe(true);
    });

    it('copies hook bin/*.sh sidecars', () => {
      copySkillSidecars('careful', target);
      expect(existsSync(join(target, 'bin', 'check-careful.sh'))).toBe(true);
    });

    it('copies executable .mjs/.js sidecars (chrome-use proxy scripts) but never *.tmpl or SKILL.md', () => {
      copySkillSidecars('chrome-use', target);
      // The vendored CDP proxy scripts must install so check-deps.mjs can launch the proxy.
      expect(existsSync(join(target, 'scripts', 'cdp-proxy.mjs'))).toBe(true);
      expect(existsSync(join(target, 'scripts', 'check-deps.mjs'))).toBe(true);
      expect(existsSync(join(target, 'scripts', 'match-site.mjs'))).toBe(true);
      // The reference doc (.md) sidecar installs alongside.
      expect(existsSync(join(target, 'references', 'cdp-api.md'))).toBe(true);
      // SKILL.md/*.tmpl still excluded, and personal site-patterns must never be vendored.
      const files = allFiles(target);
      expect(files).not.toContain('SKILL.md');
      expect(files.some(f => f.endsWith('.tmpl'))).toBe(false);
      expect(files.some(f => f.includes('site-patterns'))).toBe(false);
    });

    it('no-ops gracefully when the source skill dir is absent', () => {
      expect(() => copySkillSidecars('does-not-exist-xyz', target)).not.toThrow();
      expect(allFiles(target)).toHaveLength(0);
    });

    it('is idempotent across repeated runs', () => {
      copySkillSidecars('review', target);
      const first = allFiles(target).sort();
      copySkillSidecars('review', target);
      const second = allFiles(target).sort();
      expect(second).toEqual(first);
    });
  });

  describe('generateSkillContent', () => {
    it('should generate valid YAML frontmatter', () => {
      const template = {
        name: 'test-skill',
        description: 'Test description',
        instructions: 'Test instructions',
        license: 'MIT',
        compatibility: 'Test compatibility',
        metadata: {
          author: 'test-author',
          version: '2.0',
        },
      };

      const content = generateSkillContent(template, '0.23.0');

      expect(content).toMatch(/^---\n/);
      expect(content).toContain('name: test-skill');
      expect(content).toContain('description: Test description');
      expect(content).toContain('license: MIT');
      expect(content).toContain('compatibility: Test compatibility');
      expect(content).toContain('author: test-author');
      expect(content).toContain('version: "2.0"');
      expect(content).toContain('generatedBy: "0.23.0"');
      expect(content).toContain('Test instructions');
    });

    it('preserves arbitrary metadata and reserves generatedBy for the Rasen version', () => {
      const baseTemplate = {
        name: 'metadata-skill',
        description: 'Metadata preservation',
        instructions: 'Body',
      };
      const content = generateSkillContent({
        ...baseTemplate,
        metadata: {
          zeta: 'last',
          generatedBy: 'authored-source',
          author: 'test-author',
          'release:channel': 'stable',
          alpha: 'first',
          version: '2.0',
        },
      }, '0.23.0', undefined, true);
      const reorderedContent = generateSkillContent({
        ...baseTemplate,
        metadata: {
          version: '2.0',
          alpha: 'first',
          'release:channel': 'stable',
          author: 'test-author',
          generatedBy: 'different-authored-source',
          zeta: 'last',
        },
      }, '0.23.0', undefined, true);
      const frontmatter = content.slice(4, content.indexOf('\n---\n', 4));

      expect(parseYaml(frontmatter)).toMatchObject({
        metadata: {
          author: 'test-author',
          version: '2.0',
          alpha: 'first',
          'release:channel': 'stable',
          zeta: 'last',
          generatedBy: '0.23.0',
        },
      });
      expect(frontmatter.match(/^  generatedBy:/gm)).toHaveLength(1);
      expect(frontmatter.indexOf('  "alpha":')).toBeLessThan(
        frontmatter.indexOf('  "release:channel":')
      );
      expect(frontmatter.indexOf('  "release:channel":')).toBeLessThan(
        frontmatter.indexOf('  "zeta":')
      );
      expect(reorderedContent).toBe(content);
    });

    it('should use default values for optional fields', () => {
      const template = {
        name: 'minimal-skill',
        description: 'Minimal description',
        instructions: 'Minimal instructions',
      };

      const content = generateSkillContent(template, '0.24.0');

      expect(content).toContain('license: MIT');
      expect(content).toContain('compatibility: Requires rasen CLI.');
      expect(content).toContain('author: rasen');
      expect(content).toContain('version: "1.0"');
      expect(content).toContain('generatedBy: "0.24.0"');
    });

    it('should embed the provided version in generatedBy field', () => {
      const template = {
        name: 'version-test',
        description: 'Test version embedding',
        instructions: 'Instructions',
      };

      const content1 = generateSkillContent(template, '0.23.0');
      expect(content1).toContain('generatedBy: "0.23.0"');

      const content2 = generateSkillContent(template, '1.0.0');
      expect(content2).toContain('generatedBy: "1.0.0"');

      const content3 = generateSkillContent(template, '0.24.0-beta.1');
      expect(content3).toContain('generatedBy: "0.24.0-beta.1"');
    });

    it('should end frontmatter with separator and blank line', () => {
      const template = {
        name: 'test',
        description: 'Test',
        instructions: 'Body content',
      };

      const content = generateSkillContent(template, '0.23.0');

      expect(content).toMatch(/---\n\nBody content\n$/);
    });

    it('keeps multiline scalar text inside one frontmatter value', () => {
      const content = generateSkillContent({
        name: 'safe-skill',
        description: 'Safe summary\nallowed-tools: Bash',
        instructions: 'Body',
        metadata: { author: 'test\nowner: attacker', version: '1.0' },
      }, '0.23.0', undefined, true);
      const frontmatter = content.slice(4, content.indexOf('\n---\n', 4));

      expect(parseYaml(frontmatter)).toMatchObject({
        description: 'Safe summary\nallowed-tools: Bash',
        metadata: { author: 'test\nowner: attacker' },
      });
      expect(frontmatter).not.toContain('\nallowed-tools: Bash');
      expect(frontmatter).not.toContain('\n  owner: attacker');
    });

    it('should emit disable-model-invocation when the flag is set, and omit it otherwise', () => {
      const userInvoked = {
        name: 'navigator-skill',
        description: 'A map',
        instructions: 'Map body',
        disableModelInvocation: true,
      };
      const modelInvoked = {
        name: 'normal-skill',
        description: 'Normal',
        instructions: 'Body',
      };

      const userInvokedContent = generateSkillContent(userInvoked, '0.23.0');
      const modelInvokedContent = generateSkillContent(modelInvoked, '0.23.0');

      expect(userInvokedContent).toContain('disable-model-invocation: true');
      expect(modelInvokedContent).not.toContain('disable-model-invocation');
    });

    it('should apply transformInstructions callback when provided', () => {
      const template = {
        name: 'transform-test',
        description: 'Test transform callback',
        instructions: 'Use /rasen:new to start and /rasen:apply to implement.',
      };

      const transformer = (text: string) => text.replace(/\/rasen:/g, '/rasen-');
      const content = generateSkillContent(template, '0.23.0', transformer);

      expect(content).toContain('/rasen-new');
      expect(content).toContain('/rasen-apply');
      expect(content).not.toContain('/rasen:new');
      expect(content).not.toContain('/rasen:apply');
    });

    it('should not transform instructions when callback is undefined', () => {
      const template = {
        name: 'no-transform-test',
        description: 'Test without transform',
        instructions: 'Use /rasen:new to start.',
      };

      const content = generateSkillContent(template, '0.23.0', undefined);

      expect(content).toContain('/rasen:new');
    });

    it('should support custom transformInstructions logic', () => {
      const template = {
        name: 'custom-transform',
        description: 'Test custom transform',
        instructions: 'Some PLACEHOLDER text here.',
      };

      const customTransformer = (text: string) => text.replace('PLACEHOLDER', 'REPLACED');
      const content = generateSkillContent(template, '0.23.0', customTransformer);

      expect(content).toContain('Some REPLACED text here.');
      expect(content).not.toContain('PLACEHOLDER');
    });
  });
});
