import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readProjectConfig,
  type ProjectConfig,
} from '../../src/core/project-config.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function projectWithConfig(content: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-project-bundle-config-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
  fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), content);
  return root;
}

describe('project knowledgeBundle declaration', () => {
  it('parses one non-empty locator without resolving or rewriting it', () => {
    const root = projectWithConfig(
      'schema: spec-driven\nprojectId: portable-project\nknowledgeBundle: carry/project.bundle.json\n'
    );
    const before = fs.readFileSync(path.join(root, 'rasen', 'config.yaml'), 'utf-8');

    const config = readProjectConfig(root);

    expect(config).toMatchObject({
      schema: 'spec-driven',
      projectId: 'portable-project',
      knowledgeBundle: 'carry/project.bundle.json',
    } satisfies Partial<ProjectConfig>);
    expect(fs.readFileSync(path.join(root, 'rasen', 'config.yaml'), 'utf-8')).toBe(before);
  });

  it.each(['knowledgeBundle: \"\"', 'knowledgeBundle: 42'])(
    'drops an invalid locator with a field-local diagnostic while siblings survive: %s',
    (line) => {
      const root = projectWithConfig(
        `schema: spec-driven\nprojectId: portable-project\n${line}\n`
      );
      const diagnostics: string[] = [];

      const config = readProjectConfig(root, {
        reporter: (diagnostic) => diagnostics.push(diagnostic.key),
      });

      expect(config).toMatchObject({
        schema: 'spec-driven',
        projectId: 'portable-project',
      });
      expect(config?.knowledgeBundle).toBeUndefined();
      expect(diagnostics).toContain('invalidKnowledgeBundle');
    }
  );
});
