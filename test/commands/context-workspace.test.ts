/**
 * `store-planning-worktree-bindings` tasks 9.1-9.6 — the `rasen context`
 * workspace projection.
 *
 * This is the audit surface for the pair, and it is INERT: it reports
 * locators, it confers no mutation authority, and producing it writes nothing
 * under either Git repository or the machine data directory.
 *
 * It lives beside `context.test.ts` rather than inside it because that file's
 * fixture is a legacy-flat Store registered through `createOpenSpecRoot`, and
 * a workspace pair exists only in layout v2 with a real Git repository on both
 * sides.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'redesign-routing';
const CONTEXT_TIMEOUT_MS = 60_000;

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

function expectOk(result: RunCLIResult): RunCLIResult {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(0);
  return result;
}

/** Every file under `root`, excluding `.git`, as content-addressed entries. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      out[path.relative(root, absolute).split(path.sep).join('/')] = fs
        .readFileSync(absolute)
        .toString('base64');
    }
  };
  walk(root);
  return out;
}

describe('rasen context — the workspace pair projection', () => {
  let f: StoreWorkspaceFixture;
  let planningWorktree: string;
  let executionWorktree: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-context-workspace-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    planningWorktree = f.beside('store-planning-redesign');
    executionWorktree = f.beside('app-a-redesign');
  });

  afterEach(() => {
    f.cleanup();
  });

  function run(argv: readonly string[], cwd = f.storeRoot): Promise<RunCLIResult> {
    return runCLI([...argv], { cwd, env: f.env });
  }

  function contextArgv(extra: readonly string[] = []): readonly string[] {
    return [
      'context',
      '--store',
      f.storeId,
      '--project',
      PROJECT,
      '--target-line',
      LINE,
      ...extra,
    ];
  }

  async function prepareChange(
    changeId: string,
    planningName: string,
    executionName: string
  ): Promise<void> {
    const planned = parseJson(
      expectOk(
        await run([
          'store',
          'workspace',
          'plan',
          '--store',
          f.storeId,
          '--project',
          PROJECT,
          '--target-line',
          LINE,
          '--change',
          changeId,
          '--planning-worktree',
          f.beside(planningName),
          '--execution-worktree',
          f.beside(executionName),
          '--json',
        ])
      )
    );
    expectOk(
      await run(['store', 'workspace', 'apply', '--apply-plan', planned.planId, '--json'])
    );
  }

  async function prepare(): Promise<void> {
    await prepareChange(CHANGE, 'store-planning-redesign', 'app-a-redesign');
  }

  it(
    'states that no workspace is prepared, in both forms',
    async () => {
      const json = parseJson(expectOk(await run(contextArgv(['--json']))));
      const human = expectOk(await run(contextArgv()));

      expect(json.workspace.bindingState).toBe('unbound');
      expect(json.workspace.prepared).toBe(false);
      // Absent facts are ABSENT, not null and not inferred.
      expect(json.workspace.planning).toBeUndefined();
      expect(json.workspace.execution).toBeUndefined();
      expect(json.workspace.changeInstanceId).toBeUndefined();
      expect(json.workspace.workspacePairId).toBeUndefined();
      expect(json.workspace.storeUid).toBe(f.storeUid);
      expect(json.workspace.projectId).toBe(PROJECT);
      expect(json.workspace.targetLineId).toBe(LINE);

      expect(human.stdout).toContain('Planning workspace');
      expect(human.stdout).toContain('Binding state: unbound');
      expect(human.stdout).toContain('No workspace is prepared for project app-a');
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'reports a prepared pair with both roots, refs, HEADs, and instance ids in both forms',
    async () => {
      await prepare();

      const json = parseJson(expectOk(await run(contextArgv(['--json']))));
      const human = expectOk(await run(contextArgv()));

      expect(json.workspace.bindingState).toBe('prepared');
      expect(json.workspace.prepared).toBe(true);
      expect(json.workspace.changeId).toBe(CHANGE);
      expect(json.workspace.planning.root).toBe(planningWorktree);
      expect(json.workspace.execution.root).toBe(executionWorktree);
      expect(json.workspace.planning.exists).toBe(true);
      expect(json.workspace.planning.ref).toBe(
        `refs/heads/change/${LINE}/${PROJECT}/${CHANGE}`
      );
      expect(json.workspace.planning.headOid).toBe(
        f.refOid(f.storeRoot, 'refs/heads/release/0.2')
      );
      // A prepared-but-unbound pair has no Change instance and no pair id.
      expect(json.workspace.changeInstanceId).toBeUndefined();
      expect(json.workspace.workspacePairId).toBeUndefined();

      // The human form states the same facts.
      for (const fact of [
        json.workspace.planning.root,
        json.workspace.execution.root,
        json.workspace.planning.worktreeInstanceId,
        json.workspace.execution.worktreeInstanceId,
        json.workspace.planning.ref,
        json.workspace.planning.headOid,
        json.workspace.targetLineId,
        json.workspace.changeId,
      ]) {
        expect(human.stdout, String(fact)).toContain(String(fact));
      }
      expect(human.stdout).toContain('Store planning worktree:');
      expect(human.stdout).toContain('Project execution worktree:');
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'reports drift with the disagreeing values and repairs nothing',
    async () => {
      await prepare();
      const indexDir = path.join(f.globalDataDir, 'planning-workspaces', 'index');
      const indexBefore = snapshot(indexDir);
      // The user removed the execution worktree directory.
      fs.rmSync(executionWorktree, { recursive: true, force: true });

      const json = parseJson(expectOk(await run(contextArgv(['--json']))));
      const human = expectOk(await run(contextArgv()));

      expect(json.workspace.bindingState).toBe('drifted');
      expect(json.workspace.execution.exists).toBe(false);
      const finding = json.workspace.findings.find(
        (entry: { code: string }) => entry.code === 'workspace_worktree_absent'
      );
      expect(finding.severity).toBe('error');
      expect(finding.message).toContain(executionWorktree);
      expect(human.stdout).toContain('Binding state: drifted');
      expect(human.stdout).toContain(`${executionWorktree} (missing)`);
      // Nothing was rewritten to make the report consistent.
      expect(snapshot(indexDir)).toEqual(indexBefore);
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'reports the pair of the worktree it is standing in when a scope holds several',
    async () => {
      // Several prepared Changes in one scope is a DESIGNED state — the index
      // file is a per-scope document with one entry per Change alias, and a
      // concurrent preparation of a second Change in the same scope is
      // explicitly reasoned about. Picking the alphabetically-first entry
      // reported a different Change than the worktree the command ran in, with
      // a complete, plausible payload and no finding to say so.
      await prepareChange('add-billing', 'store-planning-billing', 'app-a-billing');
      await prepareChange('zebra-fix', 'store-planning-zebra', 'app-a-zebra');

      const json = parseJson(
        expectOk(await run(contextArgv(['--json']), f.beside('app-a-zebra')))
      );

      expect(json.workspace.changeId).toBe('zebra-fix');
      expect(json.workspace.execution.root).toBe(f.beside('app-a-zebra'));
      expect(json.workspace.planning.root).toBe(f.beside('store-planning-zebra'));
      expect(json.workspace.bindingState).toBe('prepared');

      // And from the OTHER pair's planning worktree, the other pair.
      const fromBilling = parseJson(
        expectOk(await run(contextArgv(['--json']), f.beside('store-planning-billing')))
      );
      expect(fromBilling.workspace.changeId).toBe('add-billing');
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'reports NO pair, and names every candidate, when the location decides nothing',
    async () => {
      await prepareChange('add-billing', 'store-planning-billing', 'app-a-billing');
      await prepareChange('zebra-fix', 'store-planning-zebra', 'app-a-zebra');

      // Run from the Store integration checkout, which is inside neither pair.
      const json = parseJson(expectOk(await run(contextArgv(['--json']), f.storeRoot)));
      const human = expectOk(await run(contextArgv(), f.storeRoot));

      // Absent facts are ABSENT rather than guessed.
      expect(json.workspace.changeId).toBeUndefined();
      expect(json.workspace.planning).toBeUndefined();
      expect(json.workspace.execution).toBeUndefined();
      expect(json.workspace.prepared).toBe(false);
      const finding = json.workspace.findings.find(
        (entry: { code: string }) => entry.code === 'workspace_binding_ambiguous'
      );
      expect(finding).toBeDefined();
      expect(finding.message).toContain('add-billing');
      expect(finding.message).toContain('zebra-fix');
      expect(finding.message).toContain('--change');

      // The HUMAN form must not contradict itself. `prepared: false` here means
      // "none was named", not "none exists", and a reader takes the first
      // sentence as the answer — so a scope with two prepared pairs may never
      // print that it has none.
      expect(human.stdout).not.toContain('No workspace is prepared');
      expect(human.stdout).toContain('has 2 prepared workspaces');
      expect(human.stdout).toContain('add-billing');
      expect(human.stdout).toContain('zebra-fix');
      expect(human.stdout).toContain('--change');
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'still says so, in both forms, when the scope genuinely has no workspace',
    async () => {
      // The other half: gating the sentence on the Module's own finding must
      // not silence it where it is true. `#### Scenario: A scope with no
      // prepared workspace` requires the payload to say so explicitly.
      const json = parseJson(expectOk(await run(contextArgv(['--json']), f.storeRoot)));
      const human = expectOk(await run(contextArgv(), f.storeRoot));

      expect(json.workspace.prepared).toBe(false);
      expect(
        json.workspace.findings.map((entry: { code: string }) => entry.code)
      ).toContain('workspace_not_prepared');
      expect(human.stdout).toContain('No workspace is prepared for project app-a');
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'reports no workspace for a Store aggregate scope, which cannot have one',
    async () => {
      await prepare();
      const json = parseJson(
        expectOk(await run(['context', '--store', f.storeId, '--json']))
      );
      // An aggregate address is not a project partition, so there is no pair to
      // report — and none is inferred from the one that exists in the Store.
      expect(json.workspace).toBeUndefined();
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'is inert: producing the report writes nothing anywhere',
    async () => {
      await prepare();
      const before = {
        store: snapshot(f.storeRoot),
        code: snapshot(f.projectRoot(PROJECT)),
        planning: snapshot(planningWorktree),
        execution: snapshot(executionWorktree),
        machine: snapshot(path.join(f.globalDataDir, 'planning-workspaces')),
      };

      expectOk(await run(contextArgv(['--json'])));
      expectOk(await run(contextArgv()));
      // ...and from inside the execution worktree, which is where an agent
      // would most plausibly run it.
      expectOk(await run(['context', '--json'], executionWorktree));

      expect(snapshot(f.storeRoot)).toEqual(before.store);
      expect(snapshot(f.projectRoot(PROJECT))).toEqual(before.code);
      expect(snapshot(planningWorktree)).toEqual(before.planning);
      expect(snapshot(executionWorktree)).toEqual(before.execution);
      expect(snapshot(path.join(f.globalDataDir, 'planning-workspaces'))).toEqual(
        before.machine
      );
      // Neither repository's index gained anything either.
      expect(f.git(f.storeRoot, ['diff', '--cached', '--name-only'])).toBe('');
      expect(f.git(f.projectRoot(PROJECT), ['diff', '--cached', '--name-only'])).toBe('');
    },
    CONTEXT_TIMEOUT_MS
  );

  it(
    'replaying the payload confers no authority: it names paths and nothing else',
    async () => {
      await prepare();
      const json = parseJson(expectOk(await run(contextArgv(['--json']))));

      // Everything in the projection is a locator or a state name. There is no
      // token, no plan id, and no capability of any kind to replay.
      expect(Object.keys(json.workspace).sort()).toEqual(
        [
          'bindingState',
          'changeId',
          'execution',
          'findings',
          'planning',
          'prepared',
          'projectId',
          'storeUid',
          'targetLineId',
        ].sort()
      );
      expect(JSON.stringify(json.workspace)).not.toContain('token');
    },
    CONTEXT_TIMEOUT_MS
  );
});
