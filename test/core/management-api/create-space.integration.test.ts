import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { createSpaceCreator } from '../../../src/core/management-api/create-space.js';
import { handleStoreIssueProjections } from '../../../src/core/management-api/stores.js';
import { handleSpaces } from '../../../src/core/management-api/spaces.js';
import {
  getGlobalDataDir,
  readStoreMetadataState,
  registerStore,
} from '../../../src/core/index.js';
import { registerProject } from '../../../src/core/project-registry.js';
import { readStorePointer, updateProjectConfigKey } from '../../../src/core/project-config.js';
import { FileSystemUtils } from '../../../src/utils/file-system.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const realCliEntry = path.resolve(__dirname, '..', '..', '..', 'dist', 'cli', 'index.js');

/**
 * End-to-end guard for design D4's non-interactive-init assumption: the bridge
 * spawns the real CLI `init` in a temp dir and returns a BOUNDED result — never
 * a hang. The key property is that a non-TTY subprocess is answered promptly,
 * not blocked on an interactive prompt. Two host outcomes are both acceptable:
 *  - a host with a detectable agent tool → 201 and the project appears in the
 *    spaces listing (the normal case for a machine running `rasen ui`);
 *  - a toolless host (e.g. CI) → `init` refuses non-interactively and the bridge
 *    passes that refusal through verbatim as a 422 (design D4's own mitigation),
 *    NOT a 504 timeout.
 * Requires `node build.js` first (dist/cli/index.js). On a Windows EBUSY/timeout
 * flake, isolate-rerun before calling it a regression.
 */
describe('createSpaceCreator against the real CLI (integration, slow)', () => {
  let dataHome: string;
  let target: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    dataHome = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-create-space-int-home-')));
    target = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-create-space-int-proj-')));

    originalEnv = { ...process.env };
    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = dataHome;
    process.env.XDG_DATA_HOME = dataHome;
    // Keep the subprocess from doing network work at exit.
    process.env.RASEN_TELEMETRY = '0';
  });

  afterEach(async () => {
    process.env = originalEnv;
    await cleanupTempPathAsync(dataHome);
    await cleanupTempPathAsync(target);
  });

  it('spawns real non-interactive `init` and returns a bounded result (201, or a verbatim 422 on a toolless host — never a hang)', async () => {
    if (!fs.existsSync(realCliEntry)) {
      throw new Error(`Build the CLI first (node build.js): missing ${realCliEntry}`);
    }

    const create = createSpaceCreator({ cliEntryOverride: realCliEntry, timeoutMs: 60_000 });
    const result = await create({ op: 'create-project', path: target });

    // The subprocess was answered promptly, not blocked on a prompt then killed.
    expect(result.status, JSON.stringify(result)).not.toBe(504);

    if (result.ok) {
      // Host with a detectable tool: the project was created and listed.
      expect(result.status).toBe(201);
      expect(result.response.operation).toBe('init');
      expect(result.response.space.type).toBe('project');
      expect(FileSystemUtils.canonicalizeExistingPath(result.response.space.root)).toBe(
        FileSystemUtils.canonicalizeExistingPath(target)
      );
      expect(fs.existsSync(path.join(target, 'rasen'))).toBe(true);
    } else {
      // Toolless host: init refuses non-interactively; the bridge passes the
      // CLI's own message through as a 422 (D4's mitigation), not a fabricated
      // success and not a timeout.
      expect(result.status).toBe(422);
      expect(result.code).toBe('cli_error');
      expect(result.cliExitCode).toBeGreaterThan(0);
    }
  }, 90_000);

  it('creates a real layout-v2 Store whose empty Issue projection is readable', async () => {
    if (!fs.existsSync(realCliEntry)) {
      throw new Error(`Build the CLI first (node build.js): missing ${realCliEntry}`);
    }

    const storeId = 'fresh-issue-store';
    const storeRoot = path.join(dataHome, storeId);
    const create = createSpaceCreator({ cliEntryOverride: realCliEntry, timeoutMs: 60_000 });

    const result = await create({ op: 'create-store', parent: dataHome, id: storeId });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(201);
    expect(result.response.operation).toBe('store-setup');
    expect(result.response.space.type).toBe('store');
    expect(FileSystemUtils.canonicalizeExistingPath(result.response.space.root)).toBe(
      FileSystemUtils.canonicalizeExistingPath(storeRoot)
    );

    const metadata = await readStoreMetadataState(storeRoot);
    expect(metadata).toMatchObject({ version: 2, id: storeId, layoutVersion: 2 });
    expect(metadata.uid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    const issueRead = await handleStoreIssueProjections(
      { storeUid: metadata.uid!, storeId, root: storeRoot },
      {}
    );
    expect(issueRead.ok, JSON.stringify(issueRead)).toBe(true);
    if (!issueRead.ok) {
      expect(issueRead.code).not.toBe('issue_scope_required');
      return;
    }
    expect(issueRead.status).toBe(200);
    expect(issueRead.response.issues).toEqual([]);
  }, 120_000);

  it('establishes and replays real membership once without changing the Project planning Store', async () => {
    if (!fs.existsSync(realCliEntry)) {
      throw new Error(`Build the CLI first (node build.js): missing ${realCliEntry}`);
    }

    const globalDataDir = getGlobalDataDir({ env: process.env });
    const projectId = '8A8B8C8D-1111-4222-8333-444455556666';
    // Matches the reported Project shape: the machine Project registry owns a
    // stable identity, while the checkout basename contains dots and is not a
    // valid Store/project-namespace display id.
    const projectRoot = path.join(dataHome, 'rasen-2.0-test');
    const storeRoot = path.join(dataHome, 'membership-team');
    createOpenSpecRoot(projectRoot);
    updateProjectConfigKey(projectRoot, 'projectId', projectId);
    createOpenSpecRoot(storeRoot);
    await registerProject({ projectRoot, projectId, mode: 'in-repo' }, { globalDataDir });
    await registerStore({ id: 'membership-team', localPath: storeRoot, globalDataDir });
    const planningBefore = readStorePointer(projectRoot);
    const create = createSpaceCreator({ cliEntryOverride: realCliEntry, timeoutMs: 60_000 });
    const request = { op: 'add-project-to-store', projectId, storeId: 'membership-team' };

    const first = await create(request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await create(request);

    for (const result of [first, second]) {
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (!result.ok) continue;
      expect(result.status).toBe(200);
      expect(result.response.operation).toBe('store-add-project');
      expect(result.response.space.type).toBe('store');
      if (result.response.space.type === 'store') {
        expect(
          result.response.space.members.filter(
            (member) => member.projectId.toLowerCase() === projectId.toLowerCase()
          )
        ).toHaveLength(1);
      }
    }

    const fresh = await handleSpaces();
    const store = fresh.spaces.find(
      (space) => space.type === 'store' && space.id === 'membership-team'
    );
    expect(store?.type).toBe('store');
    if (store?.type === 'store') {
      expect(
        store.members.filter((member) => member.projectId.toLowerCase() === projectId.toLowerCase())
      ).toHaveLength(1);
    }
    expect(readStorePointer(projectRoot)).toEqual(planningBefore);
    expect(
      fs.readFileSync(path.join(projectRoot, '.rasen-store', 'store.yaml'), 'utf-8')
    ).toContain(`id: ${projectId.toLowerCase()}`);
  }, 120_000);
});
