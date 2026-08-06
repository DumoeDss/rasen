import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  getGlobalDataDir,
  parseChangeInstanceSeed,
  parseProjectId,
  parseTargetLineId,
  verifyChangeInstanceId,
  verifyPlanningScopeId,
  writeStoreRegistryState,
} from '../../src/core/index.js';
import { snapshotDirectory } from '../helpers/fs-snapshot.js';
import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import { isolatedGitEnv } from '../helpers/store-git.js';
import { cleanupTempPath } from '../helpers/temp-cleanup.js';

const STORE_ID = 'team-store';
const PROJECT_ID = 'project-a';
const OTHER_PROJECT_ID = 'project-b';
const TARGET_LINE_ID = 'line-0.2';
const EXISTING_CHANGE = 'route-planning';

const VALID_DELTA_SPEC = `## ADDED Requirements

### Requirement: Routing SHALL stay scoped
The system SHALL keep one selected planning partition.

#### Scenario: Uses the selected partition
- **WHEN** planning content is requested
- **THEN** only the selected project partition is read
`;

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

describe('Store v2 planning-scope CLI journey', () => {
  let tempDir: string;
  let integrationRoot: string;
  let planningRoot: string;
  let executionRoot: string;
  let storeUid: string;
  let globalDataDir: string;
  let env: NodeJS.ProcessEnv;
  let selectedProjectHome: string;
  let selectedChangesDir: string;
  let existingChangeDir: string;
  let rootPlanningDir: string;
  let otherProjectHome: string;

  beforeEach(async () => {
    tempDir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-store-v2-journey-'))
    );
    env = {
      ...isolatedGitEnv(tempDir),
      XDG_DATA_HOME: path.join(tempDir, 'data'),
      XDG_CONFIG_HOME: path.join(tempDir, 'config'),
      OPEN_SPEC_INTERACTIVE: '0',
      RASEN_TELEMETRY: '0',
    };
    globalDataDir = getGlobalDataDir({ env });
    storeUid = randomUUID();
    integrationRoot = path.join(tempDir, 'store-integration');
    planningRoot = path.join(tempDir, 'store-planning-line');
    executionRoot = path.join(tempDir, 'project-execution');
    selectedProjectHome = path.join(
      planningRoot,
      'rasen',
      'projects',
      PROJECT_ID
    );
    selectedChangesDir = path.join(selectedProjectHome, 'changes');
    existingChangeDir = path.join(selectedChangesDir, EXISTING_CHANGE);
    rootPlanningDir = path.join(planningRoot, 'rasen', 'changes');
    otherProjectHome = path.join(
      planningRoot,
      'rasen',
      'projects',
      OTHER_PROJECT_ID
    );

    fs.mkdirSync(integrationRoot, { recursive: true });
    runGit(integrationRoot, ['init', '--initial-branch=main']);
    write(
      path.join(integrationRoot, '.rasen-store', 'store.yaml'),
      `version: 2\nuid: ${storeUid}\nid: ${STORE_ID}\nlayoutVersion: 2\n`
    );
    writeProjectCatalog(integrationRoot, PROJECT_ID);
    writeProjectCatalog(integrationRoot, OTHER_PROJECT_ID);
    write(
      path.join(
        integrationRoot,
        '.rasen-store',
        'target-lines',
        `${TARGET_LINE_ID}.yaml`
      ),
      [
        'version: 1',
        `id: ${TARGET_LINE_ID}`,
        'storeRef: refs/heads/release/0.2',
        'projects:',
        `  ${PROJECT_ID}:`,
        '    codeRef: refs/heads/release/0.2',
        `  ${OTHER_PROJECT_ID}:`,
        '    codeRef: refs/heads/release/0.2',
        '',
      ].join('\n')
    );
    write(
      path.join(
        integrationRoot,
        'rasen',
        'projects',
        PROJECT_ID,
        'config.yaml'
      ),
      `schema: spec-driven\nprojectId: ${PROJECT_ID}\n`
    );
    write(
      path.join(integrationRoot, 'rasen', 'changes', 'root-decoy', 'sentinel.txt'),
      'root planning must stay unchanged\n'
    );
    write(
      path.join(
        integrationRoot,
        'rasen',
        'projects',
        OTHER_PROJECT_ID,
        'changes',
        EXISTING_CHANGE,
        'auto-run.json'
      ),
      JSON.stringify({ pipeline: 'full-feature', completed: ['propose'] }, null, 2) + '\n'
    );
    write(path.join(integrationRoot, 'README.md'), '# Store fixture\n');
    runGit(integrationRoot, ['add', '.']);
    runGit(integrationRoot, ['commit', '-m', 'seed Store v2 planning fixture']);
    runGit(integrationRoot, [
      'worktree',
      'add',
      '-b',
      'planning-line-0-2',
      planningRoot,
    ]);
    planningRoot = fs.realpathSync.native(planningRoot);
    selectedProjectHome = path.join(planningRoot, 'rasen', 'projects', PROJECT_ID);
    selectedChangesDir = path.join(selectedProjectHome, 'changes');
    existingChangeDir = path.join(selectedChangesDir, EXISTING_CHANGE);
    rootPlanningDir = path.join(planningRoot, 'rasen', 'changes');
    otherProjectHome = path.join(planningRoot, 'rasen', 'projects', OTHER_PROJECT_ID);

    write(
      path.join(planningRoot, '.rasen', 'planning-line.json'),
      JSON.stringify(
        {
          version: 1,
          storeUid,
          storeId: STORE_ID,
          projectId: PROJECT_ID,
          targetLineId: TARGET_LINE_ID,
        },
        null,
        2
      ) + '\n'
    );
    writeV2Change(existingChangeDir, PROJECT_ID, '11'.repeat(16));
    write(
      path.join(existingChangeDir, 'auto-run.json'),
      JSON.stringify({ pipeline: 'full-feature', completed: ['propose'] }, null, 2) +
        '\n'
    );

    write(
      path.join(executionRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nprojectId: ${PROJECT_ID}\nstore:\n  uid: ${storeUid}\n  id: ${STORE_ID}\n`
    );
    write(
      path.join(executionRoot, '.rasen', 'planning-binding.json'),
      JSON.stringify(
        {
          version: 1,
          storeUid,
          storeId: STORE_ID,
          projectId: PROJECT_ID,
          targetLineId: TARGET_LINE_ID,
          planningWorktree: planningRoot,
          executionRoot,
        },
        null,
        2
      ) + '\n'
    );
    write(
      path.join(
        executionRoot,
        '.rasen',
        'changes',
        EXISTING_CHANGE,
        'ephemera',
        'auto-run.json'
      ),
      JSON.stringify({ pipeline: 'bug-fix', completed: ['propose', 'apply'] }, null, 2) +
        '\n'
    );

    await writeStoreRegistryState(
      {
        version: 2,
        stores: {
          [storeUid]: {
            id: STORE_ID,
            backend: { type: 'git', local_path: integrationRoot },
          },
        },
      },
      { globalDataDir }
    );
  });

  afterEach(() => {
    cleanupTempPath(tempDir);
  });

  function runGit(cwd: string, args: readonly string[]): void {
    execFileSync('git', ['-C', cwd, ...args], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
    });
  }

  function writeProjectCatalog(root: string, projectId: string): void {
    write(
      path.join(root, '.rasen-store', 'projects', `${projectId}.yaml`),
      [
        'version: 2',
        `projectId: ${projectId}`,
        `id: ${projectId}`,
        'roles:',
        '  planning: true',
        '  knowledge: false',
        'planningBinding:',
        '  state: bound',
        '  boundAt: 2026-08-06T00:00:00.000Z',
        '',
      ].join('\n')
    );
  }

  function writeV2Change(changeRoot: string, projectId: string, seedValue: string): void {
    const instanceSeed = parseChangeInstanceSeed(seedValue);
    const planningScopeId = derivePlanningScopeId({
      storeUid,
      projectId: parseProjectId(projectId),
      targetLineId: parseTargetLineId(TARGET_LINE_ID),
    });
    const instanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed });
    write(
      path.join(changeRoot, '.openspec.yaml'),
      [
        'schema: spec-driven',
        'created: 2026-08-06',
        'identity:',
        '  version: 2',
        `  instanceSeed: ${JSON.stringify(instanceSeed)}`,
        `  instanceId: ${JSON.stringify(instanceId)}`,
        `  storeUid: ${JSON.stringify(storeUid)}`,
        `  projectId: ${JSON.stringify(projectId)}`,
        `  targetLineId: ${JSON.stringify(TARGET_LINE_ID)}`,
        '',
      ].join('\n')
    );
    write(
      path.join(changeRoot, 'proposal.md'),
      '## Why\nRouting must stay scoped.\n\n## What Changes\n- Keep planning in one partition.\n'
    );
    write(path.join(changeRoot, 'tasks.md'), '- [x] Prove the selected partition.\n');
    write(path.join(changeRoot, 'specs', 'routing', 'spec.md'), VALID_DELTA_SPEC);
  }

  it('keeps every planning command and pipeline lookup on one partition', async () => {
    const selectors = [
      '--store',
      STORE_ID,
      '--project',
      PROJECT_ID,
      '--target-line',
      TARGET_LINE_ID,
    ];
    const followupSelection = {
      store: storeUid,
      project: PROJECT_ID,
      targetLine: TARGET_LINE_ID,
    };
    const rootPlanningBefore = snapshotDirectory(rootPlanningDir);
    const otherProjectBefore = snapshotDirectory(otherProjectHome);
    const integrationSelectedBefore = snapshotDirectory(
      path.join(integrationRoot, 'rasen', 'projects', PROJECT_ID)
    );
    const executionBefore = snapshotDirectory(executionRoot);

    const list = await runCLI(['list', '--json', ...selectors], { cwd: executionRoot, env });
    const show = await runCLI(
      ['show', EXISTING_CHANGE, '--json', ...selectors],
      { cwd: executionRoot, env }
    );
    const validate = await runCLI(
      ['validate', EXISTING_CHANGE, '--strict', '--json', ...selectors],
      { cwd: executionRoot, env }
    );
    const status = await runCLI(
      ['status', '--change', EXISTING_CHANGE, '--json', ...selectors],
      { cwd: executionRoot, env }
    );
    const instructions = await runCLI(
      ['instructions', 'apply', '--change', EXISTING_CHANGE, '--json', ...selectors],
      { cwd: executionRoot, env }
    );
    const context = await runCLI(['context', '--json', ...selectors], {
      cwd: executionRoot,
      env,
    });
    const pipeline = await runCLI(
      ['pipeline', 'resume', EXISTING_CHANGE, '--json', ...selectors],
      { cwd: executionRoot, env }
    );
    const created = await runCLI(
      [
        'new',
        'change',
        'journey-created',
        '--description',
        'Created in the selected planning partition.',
        '--json',
        ...selectors,
      ],
      { cwd: planningRoot, env }
    );
    const blockedFinalization = await runCLI(
      ['archive', EXISTING_CHANGE, '--json', '--yes', ...selectors],
      { cwd: executionRoot, env }
    );
    const blockedPlanningWork = await runCLI(
      ['work', 'migrate', '--json', '--yes', ...selectors],
      { cwd: planningRoot, env }
    );
    const blockedPlanningRetain = await runCLI(
      ['retain', 'prepare', EXISTING_CHANGE, '--json', ...selectors],
      { cwd: planningRoot, env }
    );
    const unrelatedCwd = path.join(tempDir, 'unrelated-cwd');
    fs.mkdirSync(unrelatedCwd);
    const blockedUnrelatedWork = await runCLI(
      ['work', 'migrate', '--json', '--yes', ...selectors],
      { cwd: unrelatedCwd, env }
    );
    const aggregateContext = await runCLI(
      ['context', '--store', STORE_ID, '--json'],
      { cwd: integrationRoot, env }
    );
    const aggregateContextHuman = await runCLI(
      ['context', '--store', STORE_ID],
      { cwd: integrationRoot, env }
    );
    const aggregateDoctor = await runCLI(
      ['doctor', '--store', STORE_ID, '--json'],
      { cwd: integrationRoot, env }
    );
    const aggregateDoctorHuman = await runCLI(
      ['doctor', '--store', STORE_ID],
      { cwd: integrationRoot, env }
    );

    for (const result of [
      list,
      show,
      validate,
      status,
      instructions,
      context,
      pipeline,
      created,
      aggregateContext,
      aggregateContextHuman,
      aggregateDoctor,
      aggregateDoctorHuman,
    ]) {
      expect(
        result.exitCode,
        `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
      ).toBe(0);
    }

    const listJson = parseJson(list);
    const showJson = parseJson(show);
    const validateJson = parseJson(validate);
    const statusJson = parseJson(status);
    const instructionsJson = parseJson(instructions);
    const contextJson = parseJson(context);
    const pipelineJson = parseJson(pipeline);
    const createdJson = parseJson(created);
    const aggregateContextJson = parseJson(aggregateContext);
    const aggregateDoctorJson = parseJson(aggregateDoctor);
    const blockedFinalizationJson = parseJson(blockedFinalization);
    const blockedPlanningWorkJson = parseJson(blockedPlanningWork);
    const blockedPlanningRetainJson = parseJson(blockedPlanningRetain);
    const blockedUnrelatedWorkJson = parseJson(blockedUnrelatedWork);
    const scopes = [
      listJson.root.scope,
      showJson.root.scope,
      validateJson.root.scope,
      statusJson.root.scope,
      instructionsJson.root.scope,
      contextJson.root.scope,
    ];

    expect(listJson.changes.map((change: { name: string }) => change.name)).toContain(
      EXISTING_CHANGE
    );
    expect(showJson).toMatchObject({ id: EXISTING_CHANGE });
    expect(validateJson.items).toContainEqual(
      expect.objectContaining({ id: EXISTING_CHANGE, valid: true })
    );
    expect(statusJson.changeRoot).toBe(existingChangeDir);
    expect(instructionsJson.changeRoot).toBe(existingChangeDir);
    expect(pipelineJson).toMatchObject({
      change: EXISTING_CHANGE,
      pipeline: 'bug-fix',
      hasRunState: true,
      completed: ['propose', 'apply'],
      next: 'verify',
      runStateDir: path.join(
        executionRoot,
        '.rasen',
        'changes',
        EXISTING_CHANGE,
        'ephemera'
      ),
    });
    expect(createdJson.change.path).toBe(
      path.join(selectedChangesDir, 'journey-created')
    );
    expect(aggregateContextJson.root.scope).toMatchObject({
      kind: 'store-aggregate',
      intent: 'store-read',
      ref: { mode: 'store-aggregate', storeUid },
      paths: { 'planning-checkout': integrationRoot },
    });
    expect(aggregateContextJson.root.scope.paths['active-changes']).toBeUndefined();
    expect(aggregateContextJson.root.scope.paths.specs).toBeUndefined();
    // Absent project paths are only half the contract: the payload must also
    // STATE that project authority is required, or an aggregate read is
    // indistinguishable from a healthy project context with no references.
    expect(aggregateContextJson.status).toContainEqual(
      expect.objectContaining({
        code: 'store_aggregate_scope',
        message: expect.stringContaining('project authority is required for project content'),
      })
    );
    expect(aggregateContextJson.members).toEqual([]);
    expect(aggregateContextHuman.stdout).toContain('Working context for team-store');
    expect(aggregateContextHuman.stdout).toContain(
      'project authority is required for project content'
    );
    expect(aggregateDoctorJson.root.scope).toMatchObject({
      kind: 'store-aggregate',
      intent: 'store-read',
    });
    expect(aggregateDoctorJson.project).toBeNull();
    expect(aggregateDoctorHuman.stdout).toContain('Store aggregate');
    expect(aggregateDoctorHuman.stdout).toContain('requires an explicit project scope');
    expect(blockedFinalization.exitCode).toBe(1);
    expect(blockedFinalizationJson).toMatchObject({
      archive: null,
      status: [{ code: 'store_v2_finalization_unavailable' }],
    });
    expect(blockedPlanningWork.exitCode).toBe(1);
    expect(blockedPlanningWorkJson).toMatchObject({
      changes: [],
      summary: null,
      status: [{ code: 'execution_authority_required' }],
    });
    expect(blockedPlanningRetain.exitCode).toBe(1);
    expect(blockedPlanningRetainJson).toMatchObject({
      ok: false,
      error: { code: 'retention_planning_root_mismatch' },
    });
    expect(blockedUnrelatedWork.exitCode).toBe(1);
    expect(blockedUnrelatedWorkJson).toMatchObject({
      changes: [],
      summary: null,
      status: [{ code: 'execution_authority_required' }],
    });
    expect(fs.existsSync(path.join(unrelatedCwd, '.rasen'))).toBe(false);

    for (const scope of scopes) {
      expect(scope).toMatchObject({
        kind: 'store-project',
        ref: {
          mode: 'store-project',
          storeUid,
          projectId: PROJECT_ID,
          targetLineId: TARGET_LINE_ID,
        },
        paths: {
          'planning-checkout': planningRoot,
          'execution-root': executionRoot,
          'active-changes': selectedChangesDir,
        },
        followupSelection,
      });
    }
    expect(createdJson.root.scope).toMatchObject({
      kind: 'store-project',
      source: 'explicit',
      ref: {
        mode: 'store-project',
        storeUid,
        projectId: PROJECT_ID,
        targetLineId: TARGET_LINE_ID,
      },
      paths: {
        'planning-checkout': planningRoot,
        'active-changes': selectedChangesDir,
      },
      followupSelection,
    });
    expect(createdJson.root.scope.paths['execution-root']).toBeUndefined();
    expect(createdJson.root.scope.notices).toContainEqual(
      expect.objectContaining({ code: 'execution_authority_unavailable' })
    );

    const createdMetadata = parseYaml(
      fs.readFileSync(createdJson.change.metadataPath, 'utf8')
    ) as {
      identity: {
        instanceSeed: string;
        instanceId: string;
        storeUid: string;
        projectId: string;
        targetLineId: string;
      };
    };
    const planningScopeId = verifyPlanningScopeId(
      createdJson.root.scope.ref.planningScopeId,
      {
        storeUid,
        projectId: PROJECT_ID,
        targetLineId: TARGET_LINE_ID,
      }
    );
    expect(
      verifyChangeInstanceId(createdMetadata.identity.instanceId, {
        planningScopeId,
        instanceSeed: createdMetadata.identity.instanceSeed,
      })
    ).toBe(createdMetadata.identity.instanceId);
    expect(createdMetadata.identity).toMatchObject({
      storeUid,
      projectId: PROJECT_ID,
      targetLineId: TARGET_LINE_ID,
    });
    expect(fs.readFileSync(path.join(existingChangeDir, 'auto-run.json'), 'utf8')).toContain(
      'full-feature'
    );

    expect(snapshotDirectory(rootPlanningDir)).toEqual(rootPlanningBefore);
    expect(snapshotDirectory(otherProjectHome)).toEqual(otherProjectBefore);
    expect(
      snapshotDirectory(path.join(integrationRoot, 'rasen', 'projects', PROJECT_ID))
    ).toEqual(integrationSelectedBefore);
    expect(snapshotDirectory(executionRoot)).toEqual(executionBefore);
    expect(
      fs.existsSync(path.join(selectedChangesDir, 'journey-created', '.openspec.yaml'))
    ).toBe(true);
    expect(
      fs.readdirSync(selectedChangesDir).filter((name) =>
        name.includes('.rasen-stage.') || name.endsWith('.create.lock')
      )
    ).toEqual([]);
  }, 120_000);
});
