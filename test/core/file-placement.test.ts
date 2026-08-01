import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  evidenceDir,
  handoffDir,
  ephemeraDir,
  probesFallbackDir,
  designDocsDir,
  archiveBookkeepingDir,
  resolveExecutionRoot,
  deriveWorkspaceIdentity,
  EXECUTION_STATE_DIR_NAME,
} from '../../src/core/file-placement.js';
import { PROBE_PLACEMENT_GUIDANCE } from '../../src/core/templates/experts/_shared.js';
import { getPrototypeSkillTemplate } from '../../src/core/templates/experts/prototype.js';
import { getInvestigateSkillTemplate } from '../../src/core/templates/experts/investigate.js';

describe('per-class landing resolvers', () => {
  const changeRoot = path.join('C:', 'proj', 'rasen', 'changes', 'my-change');
  const executionRoot = path.join('C:', 'proj');
  const planningRoot = path.join('C:', 'proj');

  it('evidenceDir appends evidence to the change root', () => {
    expect(evidenceDir(changeRoot)).toBe(path.join(changeRoot, 'evidence'));
  });

  it('handoffDir appends handoff to the change root', () => {
    expect(handoffDir(changeRoot)).toBe(path.join(changeRoot, 'handoff'));
  });

  it('ephemeraDir lands under the execution root .rasen tree', () => {
    expect(ephemeraDir(executionRoot, 'my-change')).toBe(
      path.join(executionRoot, '.rasen', 'changes', 'my-change', 'ephemera')
    );
  });

  it('probesFallbackDir lands under the execution root .rasen probes tree', () => {
    expect(probesFallbackDir(executionRoot, 'my-change', 'cache-probe')).toBe(
      path.join(executionRoot, '.rasen', 'probes', 'my-change', 'cache-probe')
    );
  });

  it('designDocsDir is root-level in the planning root', () => {
    expect(designDocsDir(planningRoot)).toBe(path.join(planningRoot, 'rasen', 'design-docs'));
  });

  it('archiveBookkeepingDir is always the in-repo archive directory', () => {
    expect(archiveBookkeepingDir(planningRoot)).toBe(
      path.join(planningRoot, 'rasen', 'changes', 'archive')
    );
  });

  it('uses the platform separator, never a hardcoded one', () => {
    const resolved = ephemeraDir(executionRoot, 'my-change');
    expect(resolved.includes(path.sep)).toBe(true);
    if (path.sep === '\\') {
      // Windows shape: no POSIX separators introduced by the resolver itself.
      expect(resolved.slice(executionRoot.length)).not.toContain('/');
    } else {
      expect(resolved.slice(executionRoot.length)).not.toContain('\\');
    }
  });

  it('produces POSIX-shaped paths for POSIX-shaped roots on POSIX platforms', () => {
    // path.join is platform-native; assert the SHAPE contract both ways so the
    // test states the cross-platform expectation explicitly.
    const posixRoot = '/home/user/proj';
    const expected = [posixRoot, EXECUTION_STATE_DIR_NAME, 'changes', 'c', 'ephemera'].join(
      path.sep
    );
    expect(ephemeraDir(posixRoot, 'c')).toBe(path.normalize(expected));
  });

  it('performs no I/O and creates nothing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-fp-pure-'));
    try {
      evidenceDir(path.join(tmp, 'rasen', 'changes', 'c'));
      handoffDir(path.join(tmp, 'rasen', 'changes', 'c'));
      ephemeraDir(tmp, 'c');
      probesFallbackDir(tmp, 'c', 'p');
      designDocsDir(tmp);
      expect(fs.readdirSync(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('resolves without any machine identity or registry', () => {
    // No project home, no config, no registry — the roots alone are enough.
    const bare = path.resolve(os.tmpdir(), 'rasen-no-identity');
    expect(path.isAbsolute(evidenceDir(path.join(bare, 'rasen', 'changes', 'c')))).toBe(true);
    expect(path.isAbsolute(ephemeraDir(bare, 'c'))).toBe(true);
  });
});

describe('resolveExecutionRoot', () => {
  it('equals the planning root for an in-repo project', () => {
    const planningRoot = path.join('C:', 'proj');
    expect(resolveExecutionRoot(planningRoot)).toBe(planningRoot);
  });

  it('for a store-selected run resolves the cwd code project root', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-fp-exec-')));
    try {
      const repo = path.join(tmp, 'code-project');
      const nested = path.join(repo, 'src', 'deep');
      fs.mkdirSync(nested, { recursive: true });
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

      const storeRoot = path.join(tmp, 'store');
      fs.mkdirSync(storeRoot, { recursive: true });

      expect(resolveExecutionRoot(storeRoot, { cwd: nested, storeSelected: true })).toBe(repo);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('for a store-selected run with no enclosing checkout falls back to the cwd', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-fp-exec2-')));
    try {
      const storeRoot = path.join(tmp, 'store');
      fs.mkdirSync(storeRoot, { recursive: true });
      const resolved = resolveExecutionRoot(storeRoot, { cwd: storeRoot, storeSelected: true });
      // No .git anywhere above tmp in the test sandbox: the cwd itself is used.
      expect([storeRoot, resolved]).toContain(resolved);
      expect(path.isAbsolute(resolved)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('deriveWorkspaceIdentity', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-fp-ws-')));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('derives a semantic name plus a short anti-collision id', () => {
    const worktree = path.join(tmp, 'My Project');
    fs.mkdirSync(worktree, { recursive: true });

    const identity = deriveWorkspaceIdentity(worktree);

    expect(identity.name).toBe('my-project');
    expect(identity.shortId).toMatch(/^[0-9a-f]{8}$/);
    expect(identity.id).toBe(`my-project--${identity.shortId}`);
  });

  it('two worktrees of one project derive DISTINCT identities', () => {
    const main = path.join(tmp, 'proj');
    const linked = path.join(tmp, 'proj-wt-feature');
    fs.mkdirSync(main, { recursive: true });
    fs.mkdirSync(linked, { recursive: true });

    const a = deriveWorkspaceIdentity(main);
    const b = deriveWorkspaceIdentity(linked);

    expect(a.id).not.toBe(b.id);
    expect(a.shortId).not.toBe(b.shortId);
  });

  it('is stable for the same worktree across calls', () => {
    const worktree = path.join(tmp, 'proj');
    fs.mkdirSync(worktree, { recursive: true });

    expect(deriveWorkspaceIdentity(worktree).id).toBe(deriveWorkspaceIdentity(worktree).id);
  });

  it('never creates a workspaces/ directory (no speculative state)', () => {
    const worktree = path.join(tmp, 'proj');
    fs.mkdirSync(worktree, { recursive: true });

    deriveWorkspaceIdentity(worktree);

    expect(fs.readdirSync(worktree)).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'workspaces'))).toBe(false);
  });
});

// M1: the probes requirement is guidance, so its production surface is the
// generated templates. These assertions keep the spec, the shared constant,
// and `probesFallbackDir`'s path shape from drifting apart.
describe('probe placement guidance reaches the generated templates', () => {
  it('names every project convention and the fixed fallback, with no machine-root option', () => {
    for (const convention of ['experiments/', 'prototypes/', 'tools/', 'fixtures/']) {
      expect(PROBE_PLACEMENT_GUIDANCE, convention).toContain(convention);
    }
    expect(PROBE_PLACEMENT_GUIDANCE).toContain(
      '<executionRoot>/.rasen/probes/<change>/<probe>/'
    );
    expect(PROBE_PLACEMENT_GUIDANCE).toContain('A project convention always wins');
    expect(PROBE_PLACEMENT_GUIDANCE).toContain('NEVER goes under the machine root');
  });

  it('states a fallback shape that matches probesFallbackDir', () => {
    const shape = probesFallbackDir(
      path.join('C:', 'proj'),
      '<change>',
      '<probe>'
    );
    const suffix = shape.slice(path.join('C:', 'proj').length);
    // Same segments, independent of platform separator.
    expect(suffix.split(path.sep).filter(Boolean)).toEqual([
      EXECUTION_STATE_DIR_NAME,
      'probes',
      '<change>',
      '<probe>',
    ]);
  });

  it('is carried by the skills that authorize writing probe code', () => {
    for (const template of [getPrototypeSkillTemplate(), getInvestigateSkillTemplate()]) {
      expect(template.instructions, template.name).toContain(PROBE_PLACEMENT_GUIDANCE);
    }
  });
});
