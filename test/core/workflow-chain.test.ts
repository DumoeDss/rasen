import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  WORKFLOW_CHAIN,
  MAIN_LINE,
  chainNodeIds,
  resolveNextSteps,
  formatNextWorkflowHint,
  resolveInstalledWorkflowIds,
} from '../../src/core/workflow-chain.js';
import { BUILT_IN_WORKFLOW_IDS, CORE_WORKFLOW_IDS } from '../../src/core/workflow-registry/builtins.js';
import { ALL_WORKFLOWS } from '../../src/core/profiles.js';
import { saveGlobalConfig } from '../../src/core/global-config.js';

const FULL_SET: readonly string[] = ALL_WORKFLOWS;
const CORE_SET: readonly string[] = CORE_WORKFLOW_IDS;

describe('workflow-chain', () => {
  describe('table shape (typo guard)', () => {
    it('every node id referenced by the table is a current built-in workflow id', () => {
      for (const id of chainNodeIds()) {
        expect(BUILT_IN_WORKFLOW_IDS as readonly string[]).toContain(id);
      }
    });

    it('MAIN_LINE only names current built-in workflow ids, in delivery order', () => {
      expect([...MAIN_LINE]).toEqual(['propose', 'apply', 'verify', 'ship-command', 'archive']);
      for (const id of MAIN_LINE) {
        expect(BUILT_IN_WORKFLOW_IDS as readonly string[]).toContain(id);
      }
    });

    it('is static data (no functions on the table itself)', () => {
      for (const edges of Object.values(WORKFLOW_CHAIN)) {
        for (const edge of edges ?? []) {
          expect(typeof edge.when).toBe('string');
          expect(typeof edge.to).toBe('string');
          expect(typeof edge.reasonKey).toBe('string');
        }
      }
    });
  });

  describe('resolveNextSteps: apply', () => {
    it('all_done under the full install resolves to verify (direct successor installed)', () => {
      const result = resolveNextSteps('apply', 'all_done', FULL_SET);
      expect(result).toEqual([{ workflow: 'verify', reason: expect.any(String) }]);
    });

    it('all_done under a core install skips verify and ship-command, landing on archive', () => {
      const result = resolveNextSteps('apply', 'all_done', CORE_SET);
      expect(result).toEqual([{ workflow: 'archive', reason: expect.any(String) }]);
      expect(result[0].reason).toMatch(/verify/i);
    });

    it('blocked under the full install routes to continue', () => {
      const result = resolveNextSteps('apply', 'blocked', FULL_SET);
      expect(result).toEqual([{ workflow: 'continue', reason: expect.any(String) }]);
    });

    it('blocked under a core install (no continue) falls back to the nearest installed authoring step', () => {
      const result = resolveNextSteps('apply', 'blocked', CORE_SET);
      expect(result).toEqual([{ workflow: 'propose', reason: expect.any(String) }]);
    });

    it('ready has no chain edge and is not queried by resolveNextSteps (caller returns [] directly)', () => {
      // apply's `ready` state has no matching WORKFLOW_CHAIN edge at all.
      const result = resolveNextSteps('apply', 'ready' as never, FULL_SET);
      expect(result).toEqual([]);
    });

    it('drops the step entirely when nothing downstream is installed (empty tail)', () => {
      const result = resolveNextSteps('apply', 'all_done', ['apply']);
      expect(result).toEqual([]);
    });
  });

  describe('resolveNextSteps: propose (status surface)', () => {
    it('artifacts-complete resolves to apply', () => {
      const result = resolveNextSteps('propose', 'artifacts-complete', CORE_SET);
      expect(result).toEqual([{ workflow: 'apply', reason: expect.any(String) }]);
    });

    it('artifacts-pending has no forward step', () => {
      const result = resolveNextSteps('propose', 'artifacts-pending', FULL_SET);
      expect(result).toEqual([]);
    });
  });

  describe('resolveNextSteps: unknown workflow id', () => {
    it('returns an empty array rather than throwing', () => {
      expect(resolveNextSteps('not-a-real-workflow', 'entry' as never, FULL_SET)).toEqual([]);
    });
  });

  describe('formatNextWorkflowHint', () => {
    it('strips the -command suffix from the displayed workflow id', () => {
      const hint = formatNextWorkflowHint({ workflow: 'ship-command', reason: 'because reasons' }, 'en');
      expect(hint).toContain('ship');
      expect(hint).not.toContain('ship-command');
      expect(hint.startsWith('Next:')).toBe(true);
    });
  });
});

describe('resolveInstalledWorkflowIds (design D5 regression guard)', () => {
  let configTempDir: string;
  let dataTempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    configTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-chain-config-'));
    dataTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-workflow-chain-data-'));
    // Same isolation convention as profile-sync-drift.test.ts: never delete
    // RASEN_HOME (the global vitest safety net sets it and it outranks
    // XDG), redirect both axes via XDG so this test never touches the
    // developer's real ~/.rasen.
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = configTempDir;
    process.env.XDG_DATA_HOME = dataTempDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(configTempDir, { recursive: true, force: true });
    fs.rmSync(dataTempDir, { recursive: true, force: true });
  });

  it('a core profile installed set includes apply/archive and excludes verify/ship-command', () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'core' });

    const ids = resolveInstalledWorkflowIds();

    expect(ids).toContain('apply');
    expect(ids).toContain('archive');
    expect(ids).not.toContain('verify');
    expect(ids).not.toContain('ship-command');
  });

  it('a full profile installed set includes verify and ship-command', () => {
    saveGlobalConfig({ featureFlags: {}, profile: 'full' });

    const ids = resolveInstalledWorkflowIds();

    expect(ids).toContain('verify');
    expect(ids).toContain('ship-command');
  });

  it('is sourced from the profile/config resolver, not the workflow artifact ledger', () => {
    // Regression guard for the review-Blocker constraint (design D5): the
    // ledger only ever records `source === 'user'` entries and never
    // contains built-in chain workflows, so if this helper were ever fed
    // from the ledger instead, a fresh (empty) machine home would report
    // every built-in workflow as uninstalled - including under the `full`
    // profile, where everything should be installed.
    saveGlobalConfig({ featureFlags: {}, profile: 'full' });

    const ids = resolveInstalledWorkflowIds();

    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(expect.arrayContaining([...ALL_WORKFLOWS]));
  });
});
