import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  checkoutsMatch,
  resolveFrozenExecutionBinding,
} from '../../../src/core/pipeline-registry/execution-binding.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';
import type { RuntimeContext } from '../../../src/core/session-runtime-context.js';

const FROZEN_PROJECT = 'frozen-project-id';

describe('frozen-resume execution binding', () => {
  let tempDir: string;
  let dataDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-exec-binding-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    originalEnv = { ...process.env };
    process.env.RASEN_HOME = dataDir;
    process.env.XDG_CONFIG_HOME = path.join(tempDir, 'config');
    delete process.env.XDG_DATA_HOME;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await cleanupTempPathAsync(tempDir);
  });

  function makeCheckout(name: string, projectId: string): string {
    const root = path.join(tempDir, name);
    fs.mkdirSync(path.join(root, 'rasen'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${projectId}\n`
    );
    return root;
  }

  function sessionContextFor(projectId: string, root: string): RuntimeContext {
    return {
      version: 1,
      sessionId: 'session-1',
      planning: { type: 'store', id: 'team-store', root: path.join(tempDir, 'store') },
      execution: { kind: 'project', projectId, root },
    };
  }

  it('reports "unrecorded" for a run frozen before execution bindings existed', async () => {
    const result = await resolveFrozenExecutionBinding({
      frozen: undefined,
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(result).toEqual({ ok: true, kind: 'unrecorded' });
  });

  it('passes a planning-only frozen run straight through', async () => {
    const result = await resolveFrozenExecutionBinding({
      frozen: { kind: 'planning-only' },
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(result).toEqual({ ok: true, kind: 'planning-only' });
  });

  it('locates the frozen project through the session s recorded checkout', async () => {
    const checkout = makeCheckout('checkout-a', FROZEN_PROJECT);
    const result = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: FROZEN_PROJECT },
      sessionContext: sessionContextFor(FROZEN_PROJECT, checkout),
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(result).toEqual({
      ok: true,
      kind: 'project',
      projectId: FROZEN_PROJECT,
      root: checkout,
      source: 'session-context',
    });
  });

  it('fails closed when the session executes in a different project', async () => {
    const wrong = makeCheckout('checkout-wrong', 'someone-else');
    const result = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: FROZEN_PROJECT },
      sessionContext: sessionContextFor('someone-else', wrong),
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'project_binding_mismatch',
      frozenProjectId: FROZEN_PROJECT,
      foundProjectId: 'someone-else',
      checkout: wrong,
    });
  });

  it('never falls back to another clone of the frozen project on a mismatch', async () => {
    const wrong = makeCheckout('checkout-wrong-2', 'someone-else');
    // A perfectly good clone of the frozen project IS registered and would be
    // an easy answer. Choosing it is exactly what must not happen.
    const decoy = makeCheckout('decoy-clone', FROZEN_PROJECT);
    createOpenSpecRoot(decoy);
    await registerProject(
      { projectRoot: decoy, projectId: FROZEN_PROJECT, mode: 'in-repo' },
      { globalDataDir: dataDir }
    );

    const result = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: FROZEN_PROJECT },
      sessionContext: sessionContextFor('someone-else', wrong),
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('decoy-clone');
  });

  it('fails closed when a planning-only session is asked to resume a project run', async () => {
    const result = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: FROZEN_PROJECT },
      sessionContext: {
        version: 1,
        sessionId: 'session-2',
        planning: { type: 'store', id: 'team-store', root: path.join(tempDir, 'store') },
        execution: { kind: 'planning-only' },
      },
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(result).toMatchObject({ ok: false, code: 'project_binding_mismatch' });
  });

  it('lets an explicit selector cross-check but never retarget', async () => {
    const checkout = makeCheckout('checkout-b', FROZEN_PROJECT);

    // Agreeing selector: accepted, and the run still resolves through the
    // session's checkout.
    await expect(
      resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: FROZEN_PROJECT },
        sessionContext: sessionContextFor(FROZEN_PROJECT, checkout),
        explicitProjectId: FROZEN_PROJECT,
        cwd: tempDir,
        globalDataDir: dataDir,
      })
    ).resolves.toMatchObject({ ok: true, projectId: FROZEN_PROJECT, root: checkout });

    // Disagreeing selector: reported, and the run is NOT retargeted.
    const conflict = await resolveFrozenExecutionBinding({
      frozen: { kind: 'project', projectId: FROZEN_PROJECT },
      sessionContext: sessionContextFor(FROZEN_PROJECT, checkout),
      explicitProjectId: 'other-project',
      cwd: tempDir,
      globalDataDir: dataDir,
    });
    expect(conflict).toMatchObject({
      ok: false,
      code: 'project_binding_selector_conflict',
      frozenProjectId: FROZEN_PROJECT,
      foundProjectId: 'other-project',
    });
  });

  describe('without a session context', () => {
    it('uses the current directory only when its OWN identity matches', async () => {
      const cwd = makeCheckout('cwd-match', FROZEN_PROJECT);
      const result = await resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: FROZEN_PROJECT },
        cwd,
        globalDataDir: dataDir,
      });
      expect(result).toMatchObject({ ok: true, root: cwd, source: 'cwd' });
    });

    it('uses a single registered checkout when the current directory does not match', async () => {
      const cwd = makeCheckout('cwd-other', 'unrelated');
      const only = makeCheckout('only-clone', FROZEN_PROJECT);
      createOpenSpecRoot(only);
      await registerProject(
        { projectRoot: only, projectId: FROZEN_PROJECT, mode: 'in-repo' },
        { globalDataDir: dataDir }
      );

      const result = await resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: FROZEN_PROJECT },
        cwd,
        globalDataDir: dataDir,
      });
      expect(result).toMatchObject({ ok: true, source: 'registry' });
      if (result.ok && result.kind === 'project') {
        expect(FileSystemUtils.canonicalizeExistingPath(result.root)).toBe(
          FileSystemUtils.canonicalizeExistingPath(only)
        );
      }
    });

    it('reports ambiguity and lists EVERY candidate when several clones match', async () => {
      const cwd = makeCheckout('cwd-neutral', 'unrelated');
      const cloneA = makeCheckout('clone-a', FROZEN_PROJECT);
      const cloneB = makeCheckout('clone-b', FROZEN_PROJECT);
      createOpenSpecRoot(cloneA);
      createOpenSpecRoot(cloneB);
      await registerProject(
        { projectRoot: cloneA, projectId: FROZEN_PROJECT, mode: 'in-repo' },
        { globalDataDir: dataDir }
      );
      await registerProject(
        { projectRoot: cloneB, projectId: FROZEN_PROJECT, mode: 'in-repo' },
        { globalDataDir: dataDir }
      );

      const result = await resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: FROZEN_PROJECT },
        cwd,
        globalDataDir: dataDir,
      });
      expect(result).toMatchObject({ ok: false, code: 'project_binding_ambiguous' });
      if (!result.ok) {
        expect(result.candidates).toHaveLength(2);
        const canonical = (result.candidates ?? []).map((candidate) =>
          FileSystemUtils.canonicalizeExistingPath(candidate)
        );
        expect(canonical).toContain(FileSystemUtils.canonicalizeExistingPath(cloneA));
        expect(canonical).toContain(FileSystemUtils.canonicalizeExistingPath(cloneB));
      }
    });

    it('reports a missing binding when no checkout of the frozen project exists here', async () => {
      const cwd = makeCheckout('cwd-none', 'unrelated');
      const result = await resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: FROZEN_PROJECT },
        cwd,
        globalDataDir: dataDir,
      });
      expect(result).toMatchObject({
        ok: false,
        code: 'project_binding_missing',
        frozenProjectId: FROZEN_PROJECT,
      });
    });
  });

  describe('canonical comparison', () => {
    it('treats a separator-form difference as the same checkout', () => {
      const root = path.join(tempDir, 'sep-form');
      fs.mkdirSync(root, { recursive: true });
      const variant = root.split(path.sep).join(path.posix.sep);
      expect(checkoutsMatch(root, variant)).toBe(true);
    });

    it.skipIf(process.platform !== 'win32')(
      'treats a drive-letter case difference as the same checkout',
      () => {
        const root = path.join(tempDir, 'case-form');
        fs.mkdirSync(root, { recursive: true });
        expect(checkoutsMatch(root, root.toUpperCase())).toBe(true);
      }
    );
  });

  describe('project identity canonical comparison (M3)', () => {
    const UUID_LOWER = '3c0f0a3e-9e2b-4a0e-8c2f-6d5b1f0a7e11';
    const UUID_UPPER = '3C0F0A3E-9E2B-4A0E-8C2F-6D5B1F0A7E11';

    it('recognizes a case-differing UUID in the session context as the same project', async () => {
      const checkout = makeCheckout('checkout-case', UUID_LOWER);
      // Frozen as uppercase, session carries lowercase — pre-fix, the raw ===
      // comparison reported a mismatch.
      const result = await resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: UUID_UPPER },
        sessionContext: sessionContextFor(UUID_LOWER, checkout),
        cwd: tempDir,
        globalDataDir: dataDir,
      });
      expect(result).toEqual({
        ok: true,
        kind: 'project',
        projectId: UUID_UPPER,
        root: checkout,
        source: 'session-context',
      });
    });

    it('recognizes a case-differing UUID in the cwd checkout as the same project', async () => {
      const checkout = makeCheckout('cwd-case', UUID_LOWER);
      const result = await resolveFrozenExecutionBinding({
        frozen: { kind: 'project', projectId: UUID_UPPER },
        cwd: checkout,
        globalDataDir: dataDir,
      });
      expect(result).toMatchObject({
        ok: true,
        kind: 'project',
        projectId: UUID_UPPER,
        root: checkout,
        source: 'cwd',
      });
    });
  });
});
