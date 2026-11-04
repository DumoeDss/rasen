import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';

const argv = process.argv.slice(2);
const mode = process.env.RASEN_FINALIZATION_FIXTURE_MODE ?? 'delegate';
const isApply = argv.includes('--apply-plan');
const isSave = argv.includes('--save-plan');
const phase = isApply ? 'apply' : isSave ? 'save' : 'inspect';
const controlledFailure = /^(hang|garbage|nonzero)-(inspect|save|apply)$/u.exec(mode);
const mergeProtocolFailure = /^merge-plus-failure-(inspect|save)$/u.exec(mode);

if (process.env.RASEN_FINALIZATION_PHASE_LOG) {
  fs.appendFileSync(process.env.RASEN_FINALIZATION_PHASE_LOG, `${phase}\n`, 'utf8');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function mutateAfterInspection() {
  if (phase !== 'inspect') return;
  if (mode === 'drift-identity-after-inspect') {
    const identityPath = requireEnv('RASEN_FINALIZATION_IDENTITY_PATH');
    const indexPath = requireEnv('RASEN_FINALIZATION_INDEX_PATH');
    const changeId = requireEnv('RASEN_FINALIZATION_CHANGE_ID');
    const nextSeed = requireEnv('RASEN_FINALIZATION_NEXT_INSTANCE_SEED');
    const nextInstance = requireEnv('RASEN_FINALIZATION_NEXT_CHANGE_INSTANCE');
    const nextPair = requireEnv('RASEN_FINALIZATION_NEXT_WORKSPACE_PAIR');
    const identity = fs
      .readFileSync(identityPath, 'utf8')
      .replace(/^\s*instanceSeed:.*$/mu, `  instanceSeed: ${JSON.stringify(nextSeed)}`)
      .replace(/^\s*instanceId:.*$/mu, `  instanceId: ${JSON.stringify(nextInstance)}`);
    fs.writeFileSync(identityPath, identity, 'utf8');

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const entry = index.entries.find(candidate => candidate.changeId === changeId);
    if (!entry) throw new Error(`workspace index entry for ${changeId} is required`);
    entry.changeInstanceId = nextInstance;
    entry.workspacePairId = nextPair;
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    return;
  }
  if (mode === 'drift-merge-after-inspect') {
    fs.writeFileSync(
      requireEnv('RASEN_FINALIZATION_SHIP_LOG_PATH'),
      '# Ship Log\n\n**Mode:** pr\n**PR:** https://example.com/pull/148\n',
      'utf8'
    );
    return;
  }
  if (mode === 'drift-ephemera-after-inspect') {
    fs.writeFileSync(
      requireEnv('RASEN_FINALIZATION_EPHEMERA_FILE'),
      'created after finalization inspection\n',
      'utf8'
    );
  }
}

function writeSyntheticPreview() {
  const changeInstanceId = process.env.RASEN_FINALIZATION_CHANGE_INSTANCE;
  if (!changeInstanceId) {
    throw new Error('RASEN_FINALIZATION_CHANGE_INSTANCE is required');
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        archive: {
          finalizationPlan: { changeInstanceId, blockers: [] },
          previewPrecondition: isSave
            ? argv[argv.indexOf('--finalization-preview-precondition') + 1]
            : `finalization-preview-v1:${'a'.repeat(64)}`,
          ...(isSave ? { planToken: 'archive-v1:fixture:exact-token' } : {}),
        },
      },
      null,
      2
    )}\n`
  );
}

function syntheticPrecondition() {
  return isSave
    ? argv[argv.indexOf('--finalization-preview-precondition') + 1]
    : `finalization-preview-v1:${'a'.repeat(64)}`;
}

function writeSoleMergePreview(independentFailure) {
  const changeInstanceId = requireEnv('RASEN_FINALIZATION_CHANGE_INSTANCE');
  const payload = {
    archive: {
      finalizationPlan: {
        changeInstanceId,
        blockers: [
          {
            code: 'finalization_record_invalid',
            message: 'archive: A recorded PR delivery requires explicit merge confirmation.',
            archiveBlocker: {
              code: 'archive_merge_confirmation_required',
              operation: 'timing',
              path: process.cwd(),
              message: 'A recorded PR delivery requires explicit merge confirmation.',
            },
          },
        ],
      },
      previewPrecondition: syntheticPrecondition(),
      ...(isSave ? { planToken: 'archive-v1:fixture:exact-token' } : {}),
    },
    ...(independentFailure
      ? {
          status: [
            {
              severity: 'error',
              code: `fixture_${phase}_independent_failure`,
              message: `The fixture ${phase} reported an independent failure.`,
            },
          ],
        }
      : {}),
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  // Exit 1 is the production blocked-preview status. The independent status
  // entry above must still win over sole-merge admission.
  process.exitCode = 1;
}

function writeSyntheticComplete() {
  const changeInstanceId = requireEnv('RASEN_FINALIZATION_CHANGE_INSTANCE');
  process.stdout.write(
    `${JSON.stringify({
      archive: {
        finalization: {
          status: 'complete',
          blockers: [],
          outcome: 'abandoned',
          changeId: 'fixture-change',
          changeInstanceId,
          workspacePairId: 'wp_fixture',
          storeUid: 'fixture-store',
          projectId: 'fixture-project',
          targetLineId: 'fixture-line',
          publishedEntry: process.cwd(),
          specSyncApplied: false,
          specSyncActionCount: 0,
          provenCommit: null,
          codeRef: null,
        },
      },
    })}\n`
  );
}

if (mergeProtocolFailure !== null) {
  if (phase === 'apply') {
    writeSyntheticComplete();
  } else {
    writeSoleMergePreview(mergeProtocolFailure[1] === phase);
  }
} else if (controlledFailure !== null && controlledFailure[2] !== phase) {
  writeSyntheticPreview();
} else if (mode === `hang-${phase}`) {
  setInterval(() => undefined, 1_000);
} else if (mode === `garbage-${phase}`) {
  process.stdout.write(`unreadable ${phase} output\n`);
} else if (mode === `nonzero-${phase}`) {
  process.stdout.write(
    `${JSON.stringify({
      archive: null,
      status: [
        {
          severity: 'error',
          code: `fixture_${phase}_failed`,
          message: `The fixture ${phase} failed.`,
        },
      ],
    })}\n`
  );
  process.exitCode = 1;
} else if (isApply && (mode === 'abort-required' || mode === 'manual-only')) {
  const token = argv[argv.indexOf('--apply-plan') + 1] ?? 'missing-token';
  const blockers = [
    {
      code: 'finalization_record_invalid',
      message: 'association: the recorded carrier is not safe to mutate.',
      archiveBlocker: {
        code: 'archive_journal_ownership_mismatch',
        operation: 'association',
        path: process.env.RASEN_FINALIZATION_INDEX_PATH ?? '(fixture-index)',
        message: 'the recorded carrier is not safe to mutate.',
      },
    },
    {
      code: 'finalization_record_invalid',
      message: 'A typed reconciliation issue remains visible.',
      specReconciliationIssue: {
        code: 'spec_modified_scenarios_missing',
        source: 'specs/alpha/spec.md',
        capability: 'alpha',
        requirement: 'Second Rule',
        missingScenarios: ['Scenario B'],
        message: 'A typed reconciliation issue remains visible.',
      },
    },
  ];
  const finalization =
    mode === 'abort-required'
      ? {
          status: 'abort-required',
          blockers,
          abortCommand: `rasen archive --abort-plan ${token} --yes`,
        }
      : {
          status: 'blocked',
          blockers,
          manualRecoveryAction: {
            kind: 'manual-recovery-required',
            guidance: 'Preserve the verified journal and inspect ownership manually.',
          },
        };
  process.stdout.write(
    `${JSON.stringify({ archive: { mode: 'apply', finalization } }, null, 2)}\n`
  );
  process.exitCode = 1;
} else {
  if (isApply && mode === 'malformed-index') {
    const indexPath = process.env.RASEN_FINALIZATION_INDEX_PATH;
    if (!indexPath) throw new Error('RASEN_FINALIZATION_INDEX_PATH is required');
    const document = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    document.entries.push({
      version: 1,
      planningScopeId: 'malformed-unrelated-scope',
      changeId: 'malformed-unrelated-change',
      planning: {},
      execution: {},
    });
    fs.writeFileSync(indexPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }
  const realCli = process.env.RASEN_FINALIZATION_REAL_CLI;
  if (!realCli) throw new Error('RASEN_FINALIZATION_REAL_CLI is required');
  const delegated = spawnSync(process.execPath, [realCli, ...argv], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (delegated.stdout) process.stdout.write(delegated.stdout);
  if (delegated.stderr) process.stderr.write(delegated.stderr);
  if (delegated.error) throw delegated.error;
  mutateAfterInspection();
  process.exitCode = delegated.status ?? 1;
}
