import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parse as parseYaml } from 'yaml';
import {
  appendStoreReference,
  readProjectConfig,
  validateConfigRules,
  suggestSchemas,
  ensureProjectIdInConfig,
  resolveArchiveTiming,
  resolveArchiveDestinationValue,
  resolveAutopilotGatePolicy,
} from '../../src/core/project-config.js';

describe('project-config', () => {
  let tempDir: string;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-test-config-'));
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    consoleWarnSpy.mockRestore();
  });

  describe('readProjectConfig', () => {
    describe('resilient parsing', () => {
      it('should parse complete valid config', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  Tech stack: TypeScript, React
  API style: RESTful
rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
  specs:
    - Use Given/When/Then format
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          context: 'Tech stack: TypeScript, React\nAPI style: RESTful\n',
          rules: {
            proposal: ['Include rollback plan', 'Identify affected teams'],
            specs: ['Use Given/When/Then format'],
          },
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should parse minimal config with schema only', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
        });
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should return partial config when schema is invalid', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: ""
context: Valid context here
rules:
  proposal:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          context: 'Valid context here',
          rules: {
            proposal: ['Valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'schema' field")
        );
      });

      it('should return partial config when context is invalid', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: 123
rules:
  proposal:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            proposal: ['Valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'context' field")
        );
      });

      it('should return partial config when rules is not an object', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: Valid context
rules: ["not", "an", "object"]
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          context: 'Valid context',
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'rules' field")
        );
      });

      it('should handle rules: null without aborting config parsing', () => {
        // YAML `rules:` with no value parses to null
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: Valid context
rules:
`
        );

        const config = readProjectConfig(tempDir);

        // Should still parse schema and context despite null rules
        expect(config).toEqual({
          schema: 'spec-driven',
          context: 'Valid context',
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'rules' field")
        );
      });

      it('should filter out invalid rules for specific artifact', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - Valid rule
  specs: "not an array"
  design:
    - Another valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            proposal: ['Valid rule'],
            design: ['Another valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Rules for 'specs' must be an array of strings")
        );
      });

      it('should filter out empty string rules', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - Valid rule
    - ""
    - Another valid rule
    - ""
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            proposal: ['Valid rule', 'Another valid rule'],
          },
        });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Some rules for 'proposal' are empty strings")
        );
      });

      it('should skip artifact if all rules are empty strings', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - ""
    - ""
  specs:
    - Valid rule
`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({
          schema: 'spec-driven',
          rules: {
            specs: ['Valid rule'],
          },
        });
      });

      it('should handle completely invalid YAML gracefully', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: [unclosed');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('could not parse')
        );
        // The warning names the file and never dumps a stack trace.
        const warned = consoleWarnSpy.mock.calls.at(-1)?.[0] as string;
        expect(warned).toContain('config.yaml');
        expect(warned).not.toContain('node_modules');
        expect(warned.split('\n')).toHaveLength(1);
      });

      it('should warn when config is not a YAML object', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), '"just a string"');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('not a valid YAML object')
        );
      });

      it('should handle empty config file', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), '');

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
      });
    });

    describe('references parsing', () => {
      function writeConfig(body: string): void {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'config.yaml'), body);
      }

      it('keeps entries deduplicated and order-preserving, including invalid grammar', () => {
        writeConfig(
          'schema: spec-driven\nreferences:\n  - team-context\n  - team-context\n  - "BAD ID"\n  - other-context\n  - 7\n'
        );

        const config = readProjectConfig(tempDir);

        // Grammar validation is the index assembler's job; the parser
        // keeps raw ids so bad ids surface as diagnostics.
        expect(config?.references).toEqual([
          { id: 'team-context' },
          { id: 'BAD ID' },
          { id: 'other-context' },
        ]);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Some 'references' entries are invalid")
        );
      });

      it('ignores legacy targets declarations', () => {
        writeConfig(
          'schema: spec-driven\n' +
            'references:\n  - team-context\n  - { id: team-context, remote: https://192.0.2.1/a.git }\n  - 7\n' +
            'targets:\n  - api-server\n  - { id: api-server, remote: https://192.0.2.1/b.git }\n  - 7\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.references).toEqual([
          { id: 'team-context', remote: 'https://192.0.2.1/a.git' },
        ]);
        expect('targets' in (config ?? {})).toBe(false);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining("Some 'targets' entries are invalid")
        );
      });

      it('normalizes map entries and fills remotes across duplicates (3.3)', () => {
        writeConfig(
          'schema: spec-driven\nreferences:\n' +
            '  - team-context\n' +
            '  - { id: team-context, remote: https://192.0.2.1/team.git }\n' +
            '  - { id: team-context, remote: https://192.0.2.2/other.git }\n' +
            '  - { id: upstream-context }\n' +
            '  - { remote: https://192.0.2.3/no-id.git }\n' +
            '  - { id: bad-remote-context, remote: 7 }\n'
        );

        const config = readProjectConfig(tempDir);

        // One entry per id, first position kept; the FIRST remote seen
        // fills a missing one and is never overridden. A map without an
        // id drops; a non-string remote drops while the id is kept.
        expect(config?.references).toEqual([
          { id: 'team-context', remote: 'https://192.0.2.1/team.git' },
          { id: 'upstream-context' },
          { id: 'bad-remote-context' },
        ]);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Some 'references' entries are invalid")
        );
      });

      it('omits the field when absent or empty and warns on non-arrays', () => {
        writeConfig('schema: spec-driven\n');
        expect(readProjectConfig(tempDir)?.references).toBeUndefined();

        writeConfig('schema: spec-driven\nreferences: not-an-array\n');
        expect(readProjectConfig(tempDir)?.references).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Invalid 'references' field")
        );
      });

      describe('project: prefix (store-project-namespace)', () => {
        it('indexes a project: prefixed entry alongside a bare store entry', () => {
          writeConfig('schema: spec-driven\nreferences:\n  - other-store\n  - project:elftia\n');

          const config = readProjectConfig(tempDir);

          expect(config?.references).toEqual([
            { id: 'other-store' },
            { id: 'elftia', type: 'project' },
          ]);
        });

        it('lets a store and a project of the same id both survive dedup', () => {
          writeConfig('schema: spec-driven\nreferences:\n  - elftia\n  - project:elftia\n');

          const config = readProjectConfig(tempDir);

          expect(config?.references).toEqual([
            { id: 'elftia' },
            { id: 'elftia', type: 'project' },
          ]);
        });

        it('drops an invalid project: id with a warning, keeping other valid entries', () => {
          writeConfig(
            'schema: spec-driven\nreferences:\n  - project:\n  - "project:BAD ID"\n  - other-store\n'
          );

          const config = readProjectConfig(tempDir);

          expect(config?.references).toEqual([{ id: 'other-store' }]);
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Some 'references' entries are invalid")
          );
        });

        it('accepts the object form type: project and preserves remote', () => {
          writeConfig(
            'schema: spec-driven\nreferences:\n' +
              '  - { id: elftia, remote: https://192.0.2.1/elftia.git, type: project }\n'
          );

          const config = readProjectConfig(tempDir);

          expect(config?.references).toEqual([
            { id: 'elftia', remote: 'https://192.0.2.1/elftia.git', type: 'project' },
          ]);
        });
      });
    });

    describe('context size limit enforcement', () => {
      it('should accept context under 50KB limit', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        const smallContext = 'a'.repeat(1000); // 1KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven\ncontext: "${smallContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(smallContext);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });

      it('should reject context over 50KB limit', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        const largeContext = 'a'.repeat(51 * 1024); // 51KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven\ncontext: "${largeContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config).toEqual({ schema: 'spec-driven' });
        expect(config?.context).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Context too large (51.0KB, limit: 50KB)')
        );
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Ignoring context field')
        );
      });

      it('should handle context exactly at 50KB limit', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        const exactContext = 'a'.repeat(50 * 1024); // Exactly 50KB
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven\ncontext: "${exactContext}"\n`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(exactContext);
        expect(consoleWarnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });

      it('should handle multi-byte UTF-8 characters in size calculation', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        // Unicode snowman is 3 bytes in UTF-8
        const contextWithUnicode = '☃'.repeat(18000); // ~54KB in UTF-8 (18000 * 3 bytes)
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  ${contextWithUnicode}
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Context too large')
        );
      });
    });

    describe('.yml/.yaml precedence', () => {
      it('should prefer .yaml when both exist', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          'schema: spec-driven\ncontext: from yaml\n'
        );
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'schema: custom-schema\ncontext: from yml\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.schema).toBe('spec-driven');
        expect(config?.context).toBe('from yaml');
      });

      it('should use .yml when .yaml does not exist', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yml'),
          'schema: custom-schema\ncontext: from yml\n'
        );

        const config = readProjectConfig(tempDir);

        expect(config?.schema).toBe('custom-schema');
        expect(config?.context).toBe('from yml');
      });

      it('should return null when neither .yaml nor .yml exist', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });

        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });

      it('should return null when openspec directory does not exist', () => {
        const config = readProjectConfig(tempDir);

        expect(config).toBeNull();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
      });
    });

    describe('multi-line and special characters', () => {
      it('should preserve multi-line context', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  Line 1: Tech stack
  Line 2: API conventions
  Line 3: Testing approach
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toBe(
          'Line 1: Tech stack\nLine 2: API conventions\nLine 3: Testing approach\n'
        );
      });

      it('should preserve special YAML characters in context', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
context: |
  Special chars: : @ # $ % & * [ ] { }
  Quotes: "double" 'single'
  Symbols: < > | \\ /
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.context).toContain('Special chars: : @ # $ % & * [ ] { }');
        expect(config?.context).toContain('"double"');
        expect(config?.context).toContain("'single'");
        expect(config?.context).toContain('Symbols: < > | \\ /');
      });

      it('should preserve special characters in rule strings', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, 'config.yaml'),
          `schema: spec-driven
rules:
  proposal:
    - "Use <template> tags in docs"
    - "Reference @mentions and #channels"
    - "Follow {variable} naming"
`
        );

        const config = readProjectConfig(tempDir);

        expect(config?.rules?.proposal).toEqual([
          'Use <template> tags in docs',
          'Reference @mentions and #channels',
          'Follow {variable} naming',
        ]);
      });
    });
  });

  describe('validateConfigRules', () => {
    it('should return no warnings for valid artifact IDs', () => {
      const rules = {
        proposal: ['Rule 1'],
        specs: ['Rule 2'],
        design: ['Rule 3'],
      };
      const validIds = new Set(['proposal', 'specs', 'design', 'tasks']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toEqual([]);
    });

    it('should warn about unknown artifact IDs', () => {
      const rules = {
        proposal: ['Rule 1'],
        testplan: ['Rule 2'], // Invalid
        documentation: ['Rule 3'], // Invalid
      };
      const validIds = new Set(['proposal', 'specs', 'design', 'tasks']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain('Unknown artifact ID in rules: "testplan"');
      expect(warnings[0]).toContain('Valid IDs for schema "spec-driven": design, proposal, specs, tasks');
      expect(warnings[1]).toContain('Unknown artifact ID in rules: "documentation"');
    });

    it('should return warnings for all unknown artifact IDs', () => {
      const rules = {
        invalid1: ['Rule 1'],
        invalid2: ['Rule 2'],
        invalid3: ['Rule 3'],
      };
      const validIds = new Set(['proposal', 'specs']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toHaveLength(3);
    });

    it('should handle empty rules object', () => {
      const rules = {};
      const validIds = new Set(['proposal', 'specs']);

      const warnings = validateConfigRules(rules, validIds, 'spec-driven');

      expect(warnings).toEqual([]);
    });
  });

  describe('suggestSchemas', () => {
    const availableSchemas = [
      { name: 'spec-driven', isBuiltIn: true },
      { name: 'custom-workflow', isBuiltIn: false },
      { name: 'team-process', isBuiltIn: false },
    ];

    it('should suggest close matches using fuzzy matching', () => {
      const message = suggestSchemas('spec-drven', availableSchemas); // Missing 'i'

      expect(message).toContain("Schema 'spec-drven' not found");
      expect(message).toContain('Did you mean one of these?');
      expect(message).toContain('spec-driven (built-in)');
    });

    it('should suggest custom-workflow for workflow typo', () => {
      const message = suggestSchemas('custom-workflo', availableSchemas);

      expect(message).toContain('Did you mean one of these?');
      expect(message).toContain('custom-workflow');
    });

    it('should list all available schemas', () => {
      const message = suggestSchemas('nonexistent', availableSchemas);

      expect(message).toContain('Available schemas:');
      expect(message).toContain('Built-in: spec-driven');
      expect(message).toContain('Project-local: custom-workflow, team-process');
    });

    it('should handle case when no project-local schemas exist', () => {
      const builtInOnly = [
        { name: 'spec-driven', isBuiltIn: true },
      ];
      const message = suggestSchemas('invalid', builtInOnly);

      expect(message).toContain('Built-in: spec-driven');
      expect(message).toContain('Project-local: (none found)');
    });

    it('should include fix instruction', () => {
      const message = suggestSchemas('wrong-schema', availableSchemas);

      expect(message).toContain(
        "Fix: Edit openspec/config.yaml and change 'schema: wrong-schema' to a valid schema name"
      );
    });

    it('should limit suggestions to top 3 matches', () => {
      const manySchemas = [
        { name: 'test-a', isBuiltIn: true },
        { name: 'test-b', isBuiltIn: true },
        { name: 'test-c', isBuiltIn: true },
        { name: 'test-d', isBuiltIn: true },
        { name: 'test-e', isBuiltIn: true },
      ];
      const message = suggestSchemas('test', manySchemas);

      // Should suggest at most 3
      const suggestionCount = (message.match(/test-/g) || []).length;
      expect(suggestionCount).toBeGreaterThanOrEqual(3);
      expect(suggestionCount).toBeLessThanOrEqual(3 + 5); // 3 in suggestions + 5 in "Available" list
    });

    it('should not suggest schemas with distance > 3', () => {
      const message = suggestSchemas('abcdefghijk', availableSchemas);

      // 'abcdefghijk' has large Levenshtein distance from all schemas
      expect(message).not.toContain('Did you mean');
      expect(message).toContain('Available schemas:');
    });
  });

  describe('projectId parsing', () => {
    it('exposes a valid projectId unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\nprojectId: 6f9c1e2a-3b44-4b7e-9d15-2f8a1c0e5d21\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        projectId: '6f9c1e2a-3b44-4b7e-9d15-2f8a1c0e5d21',
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('drops a non-string projectId with a warning', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\nprojectId: [not, a, string]\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid 'projectId' field")
      );
    });

    it('does not warn when projectId is absent', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('archive.timing parsing', () => {
    it('exposes a valid on-merge timing unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  timing: on-merge\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { timing: 'on-merge' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('exposes a valid in-ship timing unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  timing: in-ship\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { timing: 'in-ship' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('drops an invalid timing value with a warning, keeping the rest of the config', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  timing: sometimes\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: {},
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid 'archive.timing' field")
      );
    });

    it('drops a non-map archive value with a warning, keeping the rest of the config', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\narchive: banana\n');

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid 'archive' field"));
    });

    it('does not warn when the archive block is absent', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('archive.destination parsing', () => {
    it('exposes a valid in-repo destination unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: in-repo\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { destination: 'in-repo' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('exposes a valid external destination unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: external\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { destination: 'external' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('exposes a valid prune destination unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: prune\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { destination: 'prune' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('drops an invalid destination value with a warning, keeping a valid sibling timing', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  destination: elsewhere\n  timing: in-ship\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { timing: 'in-ship' },
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid 'archive.destination' field")
      );
    });

    it('drops a non-map archive value with a warning, keeping the rest of the config', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\narchive: banana\n');

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid 'archive' field"));
    });

    it('does not warn when destination is absent', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\narchive:\n  timing: on-merge\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        archive: { timing: 'on-merge' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveArchiveDestinationValue', () => {
    it('defaults to in-repo for null config', () => {
      expect(resolveArchiveDestinationValue(null)).toBe('in-repo');
    });

    it('defaults to in-repo for undefined config', () => {
      expect(resolveArchiveDestinationValue(undefined)).toBe('in-repo');
    });

    it('defaults to in-repo when the archive block is absent', () => {
      expect(resolveArchiveDestinationValue({ schema: 'spec-driven' })).toBe('in-repo');
    });

    it('defaults to in-repo when destination is absent from the archive block', () => {
      expect(
        resolveArchiveDestinationValue({ schema: 'spec-driven', archive: { timing: 'in-ship' } })
      ).toBe('in-repo');
    });

    it('honors an explicit external destination', () => {
      expect(
        resolveArchiveDestinationValue({
          schema: 'spec-driven',
          archive: { destination: 'external' },
        })
      ).toBe('external');
    });

    it('honors an explicit prune destination', () => {
      expect(
        resolveArchiveDestinationValue({
          schema: 'spec-driven',
          archive: { destination: 'prune' },
        })
      ).toBe('prune');
    });
  });

  describe('resolveArchiveTiming', () => {
    it('defaults to on-merge for null config', () => {
      expect(resolveArchiveTiming(null)).toBe('on-merge');
    });

    it('defaults to on-merge for undefined config', () => {
      expect(resolveArchiveTiming(undefined)).toBe('on-merge');
    });

    it('defaults to on-merge when the archive block is absent', () => {
      expect(resolveArchiveTiming({ schema: 'spec-driven' })).toBe('on-merge');
    });

    it('defaults to on-merge when timing is absent from the archive block', () => {
      expect(resolveArchiveTiming({ schema: 'spec-driven', archive: {} })).toBe('on-merge');
    });

    it('honors an explicit in-ship timing', () => {
      expect(
        resolveArchiveTiming({ schema: 'spec-driven', archive: { timing: 'in-ship' } })
      ).toBe('in-ship');
    });
  });

  describe('autopilot.gates parsing', () => {
    it('exposes a valid off policy unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\nautopilot:\n  gates: off\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        autopilot: { gates: 'off' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('exposes a valid on policy unchanged', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\nautopilot:\n  gates: on\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        autopilot: { gates: 'on' },
      });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('drops an invalid gates value with a warning, keeping the rest of the config', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\nautopilot:\n  gates: sometimes\n'
      );

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({
        schema: 'spec-driven',
        autopilot: {},
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid 'autopilot.gates' field")
      );
    });

    it('drops a non-map autopilot value with a warning, keeping the rest of the config', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\nautopilot: banana\n');

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Invalid 'autopilot' field")
      );
    });

    it('does not warn when the autopilot block is absent', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

      const config = readProjectConfig(tempDir);

      expect(config).toEqual({ schema: 'spec-driven' });
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveAutopilotGatePolicy', () => {
    it('defaults to gates on when no config and no flag', () => {
      expect(resolveAutopilotGatePolicy(null, false)).toEqual({
        effective: 'on',
        source: 'default',
      });
    });

    it('defaults to gates on when the autopilot block is absent', () => {
      expect(resolveAutopilotGatePolicy({ schema: 'spec-driven' }, false)).toEqual({
        effective: 'on',
        source: 'default',
      });
    });

    it('honors an explicit config default of off', () => {
      expect(
        resolveAutopilotGatePolicy({ schema: 'spec-driven', autopilot: { gates: 'off' } }, false)
      ).toEqual({ effective: 'off', source: 'config' });
    });

    it('honors an explicit config default of on', () => {
      expect(
        resolveAutopilotGatePolicy({ schema: 'spec-driven', autopilot: { gates: 'on' } }, false)
      ).toEqual({ effective: 'on', source: 'config' });
    });

    it('the run flag overrides an on config default', () => {
      expect(
        resolveAutopilotGatePolicy({ schema: 'spec-driven', autopilot: { gates: 'on' } }, true)
      ).toEqual({ effective: 'off', source: 'flag' });
    });

    it('the run flag overrides an absent config (same effective value, flag source)', () => {
      expect(resolveAutopilotGatePolicy(null, true)).toEqual({
        effective: 'off',
        source: 'flag',
      });
    });
  });

  describe('ensureProjectIdInConfig', () => {
    // Minting now locks under the project registry (MINOR-3). Give every
    // test in this block its own globalDataDir so the lock file never
    // touches the real machine registry.
    let globalDataDir: string;

    beforeEach(() => {
      globalDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-test-config-gdd-'));
    });

    afterEach(() => {
      fs.rmSync(globalDataDir, { recursive: true, force: true });
    });

    it('throws when no config file exists', async () => {
      await expect(ensureProjectIdInConfig(tempDir, { globalDataDir })).rejects.toThrow(/rasen init/);
    });

    it('mints and appends a projectId, preserving existing content and comments', async () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      const original = 'schema: spec-driven\n\n# a helpful comment\ncontext: |\n  Tech stack: TS\n';
      fs.writeFileSync(path.join(configDir, 'config.yaml'), original);

      const projectId = await ensureProjectIdInConfig(tempDir, { globalDataDir });

      expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
      const written = fs.readFileSync(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(written).toContain(original.trimEnd());
      expect(written).toContain(`projectId: ${projectId}`);
      expect(written).toContain('# a helpful comment');

      const config = readProjectConfig(tempDir);
      expect(config?.projectId).toBe(projectId);
    });

    it('is idempotent when a projectId already exists', async () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.yaml'),
        'schema: spec-driven\nprojectId: existing-id\n'
      );

      const first = await ensureProjectIdInConfig(tempDir, { globalDataDir });
      const second = await ensureProjectIdInConfig(tempDir, { globalDataDir });

      expect(first).toBe('existing-id');
      expect(second).toBe('existing-id');
    });

    it('honors config.yml', async () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yml'), 'schema: spec-driven\n');

      const projectId = await ensureProjectIdInConfig(tempDir, { globalDataDir });

      const written = fs.readFileSync(path.join(configDir, 'config.yml'), 'utf-8');
      expect(written).toContain(`projectId: ${projectId}`);
      expect(fs.existsSync(path.join(configDir, 'config.yaml'))).toBe(false);
    });

    it('reverts the append when post-write validation fails', async () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      const original = 'schema: spec-driven\n';
      const configPath = path.join(configDir, 'config.yaml');
      fs.writeFileSync(configPath, original);

      const writeFileSpy = vi
        .spyOn(fs.promises, 'writeFile')
        .mockImplementationOnce(async (target, content) => {
          // Simulate the append landing corrupted (fails the re-read validation).
          await fs.promises.writeFile(target as string, `${content}\n: not: valid: yaml: [`, 'utf-8');
        });

      await expect(ensureProjectIdInConfig(tempDir, { globalDataDir })).rejects.toThrow(/did not validate/);
      writeFileSpy.mockRestore();

      expect(fs.readFileSync(configPath, 'utf-8')).toBe(original);
    });

    it('serializes concurrent minting so two racing callers agree on one id (MINOR-3)', async () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.yaml'), 'schema: spec-driven\n');

      const [first, second] = await Promise.all([
        ensureProjectIdInConfig(tempDir, { globalDataDir }),
        ensureProjectIdInConfig(tempDir, { globalDataDir }),
      ]);

      expect(first).toBe(second);
      const config = readProjectConfig(tempDir);
      expect(config?.projectId).toBe(first);
      // Exactly one projectId line landed - no divergence, no duplication.
      const written = fs.readFileSync(path.join(configDir, 'config.yaml'), 'utf-8');
      expect(written.match(/^projectId:/gmu)?.length).toBe(1);
    });
  });

  describe('appendStoreReference', () => {
    it('appends a new id and preserves every other field', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        'schema: spec-driven\nquality-rules:\n  - Include rollback plan\nreferences:\n  - upstream-context\n'
      );

      const result = appendStoreReference(tempDir, 'team-context');

      expect(result).toEqual({ configPath, changed: true });
      const written = parseYaml(fs.readFileSync(configPath, 'utf-8'));
      expect(written.schema).toBe('spec-driven');
      expect(written['quality-rules']).toEqual(['Include rollback plan']);
      expect(written.references).toEqual(['upstream-context', 'team-context']);
    });

    it('is a no-op when the id is already present', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'config.yaml');
      const original = 'schema: spec-driven\nreferences:\n  - team-context\n';
      fs.writeFileSync(configPath, original);

      const result = appendStoreReference(tempDir, 'team-context');

      expect(result).toEqual({ configPath, changed: false });
      expect(fs.readFileSync(configPath, 'utf-8')).toBe(original);
    });

    it('creates a minimal config when none exists', () => {
      const result = appendStoreReference(tempDir, 'team-context');

      const configPath = path.join(tempDir, 'rasen', 'config.yaml');
      expect(result).toEqual({ configPath, changed: true });
      const written = parseYaml(fs.readFileSync(configPath, 'utf-8'));
      expect(written).toEqual({ references: ['team-context'] });
    });

    it('preserves a declared remote on an existing reference entry', () => {
      const configDir = path.join(tempDir, 'rasen');
      fs.mkdirSync(configDir, { recursive: true });
      const configPath = path.join(configDir, 'config.yaml');
      fs.writeFileSync(
        configPath,
        'schema: spec-driven\nreferences:\n  - id: upstream-context\n    remote: git@example.com:team/upstream.git\n'
      );

      appendStoreReference(tempDir, 'team-context');

      const written = parseYaml(fs.readFileSync(configPath, 'utf-8'));
      expect(written.references).toEqual([
        { id: 'upstream-context', remote: 'git@example.com:team/upstream.git' },
        'team-context',
      ]);
    });

    describe('project namespace (store-project-namespace)', () => {
      it('appends a project: prefixed entry when type is project', () => {
        const result = appendStoreReference(tempDir, 'elftia', { type: 'project' });

        const configPath = path.join(tempDir, 'rasen', 'config.yaml');
        expect(result).toEqual({ configPath, changed: true });
        const written = parseYaml(fs.readFileSync(configPath, 'utf-8'));
        expect(written.references).toEqual(['project:elftia']);
      });

      it('lets a store id and a project id of the same name coexist as distinct entries', () => {
        appendStoreReference(tempDir, 'elftia', { type: 'store' });
        const result = appendStoreReference(tempDir, 'elftia', { type: 'project' });

        expect(result.changed).toBe(true);
        const configPath = path.join(tempDir, 'rasen', 'config.yaml');
        const written = parseYaml(fs.readFileSync(configPath, 'utf-8'));
        expect(written.references).toEqual(['elftia', 'project:elftia']);
      });

      it('is a no-op when the (type, id) pair is already present', () => {
        appendStoreReference(tempDir, 'elftia', { type: 'project' });
        const result = appendStoreReference(tempDir, 'elftia', { type: 'project' });

        expect(result.changed).toBe(false);
      });

      it('round-trips a project-typed entry with a remote through the object form', () => {
        const configDir = path.join(tempDir, 'rasen');
        fs.mkdirSync(configDir, { recursive: true });
        const configPath = path.join(configDir, 'config.yaml');
        fs.writeFileSync(
          configPath,
          'schema: spec-driven\nreferences:\n  - { id: elftia, remote: https://192.0.2.1/elftia.git, type: project }\n'
        );

        appendStoreReference(tempDir, 'other-store');

        const written = parseYaml(fs.readFileSync(configPath, 'utf-8'));
        expect(written.references).toEqual([
          { id: 'elftia', remote: 'https://192.0.2.1/elftia.git', type: 'project' },
          'other-store',
        ]);
      });
    });
  });
});
