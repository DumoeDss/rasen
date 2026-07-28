/**
 * M5 — Recoverable backup debris reported as degraded, not empty.
 *
 * A killed mutation renames the previous record directory to
 * `.rasen-learned-skill-backup-*`. Until the next mutation runs
 * `sweepMutationDebris`, the catalog reads as empty (because the backup
 * directory's name doesn't match the manifest id inside, and the leading dot
 * makes `isOsJunkEntryName` skip it silently). The fix: detect backup
 * directories BEFORE the junk filter, collect them, and report the Store as
 * degraded/unavailable — never as a member with an empty catalog.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  readStoreCatalog,
  serializeManifest,
  digestContent,
} from '../../../src/core/learned-skills/catalog.js';
import { LEARNED_SKILL_BACKUP_PREFIX } from '../../../src/core/learned-skills/constants.js';
import {
  resolveLearnedSkillExecutionContext,
  resolveEffectiveLearnedSkillPlan,
} from '../../../src/core/learned-skills/index.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { registerStore } from '../../../src/core/store/registry.js';
import { writeStoreProjectRecord } from '../../../src/core/store/project-records.js';
import type { ResolvedStore } from '../../../src/core/learned-skills/stores.js';

const ID = 'typescript-cli-routing';
const KEY = 'typescript-cli-routing-key';

function canonicalContent(id: string): string {
  return `---\nname: ${id}\n---\n\nUse the stable route.\n`;
}

describe('M5 — recoverable backup debris reported as degraded, not empty', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-m5-')));
    globalDataDir = path.join(tempDir, 'data');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function healthyRoot(root: string): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    return fs.realpathSync.native(root);
  }

  /**
   * Creates a `.rasen-learned-skill-backup-<id>-<suffix>` directory inside the
   * catalog dir, containing a valid manifest whose id does NOT match the backup
   * directory's name (simulating a killed mid-swap rename).
   */
  function writeBackupDebris(
    catalogDir: string,
    ownerUid: string,
    ownerId: string
  ): string {
    // The backup directory name has a DIFFERENT id than the manifest inside —
    // that's what makes it debris: the rename was mid-swap.
    const backupDirName = `${LEARNED_SKILL_BACKUP_PREFIX}${ID}-killed-mid-swap`;
    const backupDir = path.join(catalogDir, backupDirName);
    fs.mkdirSync(backupDir, { recursive: true });
    const body = canonicalContent(ID);
    const manifest = {
      version: 2 as const,
      scope: 'store' as const,
      owner: { type: 'store' as const, uid: ownerUid, id: ownerId },
      id: ID,
      knowledgeKey: KEY,
      status: 'active' as const,
      generatedBy: 'rasen-learned-skill',
      contentDigest: digestContent(body),
      description: 'Route TypeScript CLI diagnostics.',
      applicability: { mode: 'all' as const, markers: ['package.json'] },
      evidence: [],
      sources: [],
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    };
    fs.writeFileSync(path.join(backupDir, 'learned-skill.yaml'), serializeManifest(manifest));
    fs.writeFileSync(path.join(backupDir, 'SKILL.md'), body);
    return backupDirName;
  }

  // ---------------------------------------------------------------------------
  // Unit: readStoreCatalog
  // ---------------------------------------------------------------------------

  describe('readStoreCatalog', () => {
    it('reports recoverable backup directories and excludes them from records', () => {
      const catalogDir = path.join(tempDir, 'store', 'rasen', 'learned-skills');
      fs.mkdirSync(catalogDir, { recursive: true });
      const ownerUid = mintStoreUid();
      const backupName = writeBackupDebris(catalogDir, ownerUid, 'team');

      const store: ResolvedStore = {
        root: path.join(tempDir, 'store'),
        dir: catalogDir,
        owner: { type: 'store', uid: ownerUid, id: 'team' },
        projectId: undefined,
        lockPath: path.join(tempDir, 'store.lock'),
      };

      const result = readStoreCatalog(store, 'store');
      expect(result.records).toEqual([]);
      expect(result.recoverableBackups).toEqual([backupName]);
    });

    it('clean catalog has empty recoverableBackups (regression protection)', () => {
      const catalogDir = path.join(tempDir, 'store', 'rasen', 'learned-skills');
      fs.mkdirSync(catalogDir, { recursive: true });
      // No backup dirs, no records — just an empty catalog.
      const ownerUid = mintStoreUid();
      const store: ResolvedStore = {
        root: path.join(tempDir, 'store'),
        dir: catalogDir,
        owner: { type: 'store', uid: ownerUid, id: 'team' },
        projectId: undefined,
        lockPath: path.join(tempDir, 'store.lock'),
      };

      const result = readStoreCatalog(store, 'store');
      expect(result.records).toEqual([]);
      expect(result.recoverableBackups).toEqual([]);
    });

    it('does NOT report staging dirs as recoverable backups', () => {
      const catalogDir = path.join(tempDir, 'store', 'rasen', 'learned-skills');
      fs.mkdirSync(catalogDir, { recursive: true });
      // A staging dir — partial new record, NOT recoverable data.
      const stagingName = '.rasen-learned-skill-staging-new-record-attempt';
      fs.mkdirSync(path.join(catalogDir, stagingName), { recursive: true });
      const ownerUid = mintStoreUid();

      const store: ResolvedStore = {
        root: path.join(tempDir, 'store'),
        dir: catalogDir,
        owner: { type: 'store', uid: ownerUid, id: 'team' },
        projectId: undefined,
        lockPath: path.join(tempDir, 'store.lock'),
      };

      const result = readStoreCatalog(store, 'store');
      expect(result.records).toEqual([]);
      // Staging dirs are silently skipped (isOsJunkEntryName catches them), NOT
      // reported as recoverable backups.
      expect(result.recoverableBackups).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: effective resolution treats the Store as degraded
  // ---------------------------------------------------------------------------

  describe('effective resolution', () => {
    it('reports a Store with a recoverable backup as unavailable, not as an empty member', async () => {
      // Set up a Store.
      const storeRoot = healthyRoot(path.join(tempDir, 'team-store'));
      const storeUid = mintStoreUid();
      await writeStoreMetadataState(storeRoot, { version: 2, uid: storeUid, id: 'team' });
      await registerStore({ id: 'team', localPath: storeRoot, globalDataDir });

      // Set up a project that is a member of the Store.
      const projectRoot = healthyRoot(path.join(tempDir, 'project'));
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
      const home = await resolveProjectHome(projectRoot, { globalDataDir });
      const projectId = home!.projectId;
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\n`
      );
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId,
        roles: { planning: true, knowledge: true },
      });

      // Instead of a regular record, put backup debris in the Store's catalog.
      const catalogDir = path.join(storeRoot, 'rasen', 'learned-skills');
      writeBackupDebris(catalogDir, storeUid, 'team');

      const execution = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'mixed',
        globalDataDir,
        sessionContext: null,
      });
      const plan = await resolveEffectiveLearnedSkillPlan({ execution, previousStores: [] });

      // The Store with the recoverable backup is NOT reported as a member.
      const teamFact = plan.stores.find((s) => s.store.id === 'team');
      expect(teamFact).toBeDefined();
      expect(teamFact!.status).toBe('unavailable');
      // The diagnostic explains the recoverable backup.
      expect(teamFact!.diagnostic).toBeDefined();
      expect(teamFact!.diagnostic).toContain('recoverable backup');

      // The overall status is degraded, not clean.
      expect(plan.status).toBe('degraded');
    });

    it('does NOT destructively reconcile when a backup is present', async () => {
      // Same setup as above, but additionally verify no generated files are
      // removed — the effective path must defer cleanup, not destroy content.
      const storeRoot = healthyRoot(path.join(tempDir, 'team-store'));
      const storeUid = mintStoreUid();
      await writeStoreMetadataState(storeRoot, { version: 2, uid: storeUid, id: 'team' });
      await registerStore({ id: 'team', localPath: storeRoot, globalDataDir });

      const projectRoot = healthyRoot(path.join(tempDir, 'project'));
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
      const home = await resolveProjectHome(projectRoot, { globalDataDir });
      const projectId = home!.projectId;
      fs.writeFileSync(
        path.join(projectRoot, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\n`
      );
      await writeStoreProjectRecord(storeRoot, {
        version: 1,
        projectId,
        roles: { planning: true, knowledge: true },
      });

      // Place backup debris in the Store's catalog.
      const catalogDir = path.join(storeRoot, 'rasen', 'learned-skills');
      const backupDirName = writeBackupDebris(catalogDir, storeUid, 'team');
      const backupDir = path.join(catalogDir, backupDirName);
      const backupContent = fs.readFileSync(path.join(backupDir, 'SKILL.md'), 'utf-8');

      // Run the effective resolution.
      const execution = await resolveLearnedSkillExecutionContext({
        launchDirectory: projectRoot,
        requestedScope: 'mixed',
        globalDataDir,
        sessionContext: null,
      });
      await resolveEffectiveLearnedSkillPlan({ execution, previousStores: [] });

      // The backup directory and its content survive untouched — no destructive
      // reconcile happened on the strength of the catalog appearing "empty".
      expect(fs.existsSync(backupDir)).toBe(true);
      expect(fs.readFileSync(path.join(backupDir, 'SKILL.md'), 'utf-8')).toBe(backupContent);
    });
  });
});
