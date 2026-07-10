import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

describe('top-level show command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-show-command-tmp');
  const changesDir = path.join(testDir, 'rasen', 'changes');
  const specsDir = path.join(testDir, 'rasen', 'specs');
  const openspecBin = path.join(projectRoot, 'bin', 'rasen.js');


  beforeEach(async () => {
    await fs.mkdir(changesDir, { recursive: true });
    await fs.mkdir(specsDir, { recursive: true });

    const changeContent = `# Change: Demo\n\n## Why\nBecause reasons.\n\n## What Changes\n- **auth:** Add requirement\n`;
    await fs.mkdir(path.join(changesDir, 'demo'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'demo', 'proposal.md'), changeContent, 'utf-8');

    const specContent = `## Purpose\nAuth spec.\n\n## Requirements\n\n### Requirement: User Authentication\nText\n`;
    await fs.mkdir(path.join(specsDir, 'auth'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'auth', 'spec.md'), specContent, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('prints hint and non-zero exit when no args and non-interactive', () => {
    const originalCwd = process.cwd();
    const originalEnv = { ...process.env };
    try {
      process.chdir(testDir);
      process.env.OPEN_SPEC_INTERACTIVE = '0';
      let err: any;
      try {
        execSync(`node ${openspecBin} show`, { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).not.toBe(0);
      const stderr = err.stderr.toString();
      expect(stderr).toContain('Nothing to show.');
      expect(stderr).toContain('rasen show <item>');
      expect(stderr).toContain('rasen show <item> --type change');
      expect(stderr).toContain('rasen show <item> --type spec');
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
    }
  });

  it('auto-detects change id and supports --json', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      const output = execSync(`node ${openspecBin} show demo --json`, { encoding: 'utf-8' });
      const json = JSON.parse(output);
      expect(json.id).toBe('demo');
      expect(Array.isArray(json.deltas)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('auto-detects spec id and supports spec-only flags', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      const output = execSync(`node ${openspecBin} show auth --json --requirements`, { encoding: 'utf-8' });
      const json = JSON.parse(output);
      expect(json.id).toBe('auth');
      expect(Array.isArray(json.requirements)).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('handles ambiguity and suggests --type', async () => {
    // create matching spec and change named 'foo'
    await fs.mkdir(path.join(changesDir, 'foo'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'foo', 'proposal.md'), '# Change: Foo\n\n## Why\n\n## What Changes\n', 'utf-8');
    await fs.mkdir(path.join(specsDir, 'foo'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'foo', 'spec.md'), '## Purpose\n\n## Requirements\n\n### Requirement: R\nX', 'utf-8');

    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      let err: any;
      try {
        execSync(`node ${openspecBin} show foo`, { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).not.toBe(0);
      const stderr = err.stderr.toString();
      expect(stderr).toContain('Ambiguous item');
      expect(stderr).toContain('--type change|spec');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('prints nearest matches when not found', () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(testDir);
      let err: any;
      try {
        execSync(`node ${openspecBin} show unknown-item`, { encoding: 'utf-8' });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).not.toBe(0);
      const stderr = err.stderr.toString();
      expect(stderr).toContain("Unknown item 'unknown-item'");
      expect(stderr).toContain('Did you mean:');
    } finally {
      process.chdir(originalCwd);
    }
  });

  // Migrated from the deleted test/commands/spec.test.ts (noun-form `rasen
  // spec show`): SpecCommand.show is surviving logic, delegated to by this
  // verb-first command, so its JSON-filter flags and error paths still need
  // coverage — just invoked as `rasen show <id> --type spec ...`.
  describe('spec-only filters (delegates to SpecCommand.show)', () => {
    beforeEach(async () => {
      const twoRequirementSpec = `## Purpose
This is a test specification for the authentication system.

## Requirements

### Requirement: User Authentication
The system SHALL provide secure user authentication

#### Scenario: Successful login
- **WHEN** a user with valid credentials submits the login form
- **THEN** they are authenticated

### Requirement: Password Reset
The system SHALL allow users to reset their password

#### Scenario: Reset via email
- **WHEN** a user with a registered email requests a password reset
- **THEN** they receive a reset link
`;
      await fs.writeFile(path.join(specsDir, 'auth', 'spec.md'), twoRequirementSpec, 'utf-8');
    });

    it('excludes scenarios with --no-scenarios (JSON only)', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        const output = execSync(`node ${openspecBin} show auth --type spec --json --no-scenarios`, { encoding: 'utf-8' });
        const json = JSON.parse(output);
        expect(json.requirements).toHaveLength(2);
        expect(json.requirements.every((r: any) => Array.isArray(r.scenarios) && r.scenarios.length === 0)).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('shows a specific requirement with -r/--requirement (JSON only)', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        const output = execSync(`node ${openspecBin} show auth --type spec --json -r 1`, { encoding: 'utf-8' });
        const json = JSON.parse(output);
        expect(json.requirements).toHaveLength(1);
        expect(json.requirements[0].text).toContain('The system SHALL provide secure user authentication');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('rejects --requirements and --requirement used together', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        let err: any;
        let stdout = '';
        try {
          stdout = execSync(`node ${openspecBin} show auth --type spec --json --requirements -r 1`, { encoding: 'utf-8' });
        } catch (e: any) {
          err = e;
          stdout = e.stdout?.toString() ?? '';
        }
        expect(err).toBeDefined();
        expect(err.status).not.toBe(0);
        const json = JSON.parse(stdout);
        expect(json.status[0].message).toContain('Options --requirements and --requirement cannot be used together');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('reports a not-found error for a missing spec', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        let err: any;
        try {
          execSync(`node ${openspecBin} show nonexistent-spec --type spec`, { encoding: 'utf-8' });
        } catch (e) { err = e; }
        expect(err).toBeDefined();
        expect(err.status).not.toBe(0);
        expect(err.stderr.toString()).toContain("Spec 'nonexistent-spec' not found");
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});


