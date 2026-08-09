import * as path from 'node:path';

import {
  collectSuccessfulCiEvidence,
  readJsonBounded,
  recordCiFailureHistory,
  seedPendingCiEvidence,
} from './protocol.mjs';

function option(name, required = true) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    if (!required) return undefined;
    throw new Error(`Missing required ${name}`);
  }
  return process.argv[index + 1];
}

const workDir = path.resolve(option('--work-dir'));
if (process.argv.includes('--seed-pending')) {
  const evidence = seedPendingCiEvidence(workDir);
  process.stdout.write(
    `${JSON.stringify({
      schema: evidence.schema,
      state: evidence.state,
      deliverySha: evidence.deliverySha,
    })}\n`
  );
} else {
  const workflowRuns = readJsonBounded(path.resolve(option('--workflow-runs')));
  const jobs = readJsonBounded(path.resolve(option('--jobs')));
  const input = {
    workflowRuns: Array.isArray(workflowRuns)
      ? workflowRuns
      : workflowRuns.workflow_runs,
    jobs: Array.isArray(jobs) ? jobs : jobs.jobs,
    deliveryScope: option('--delivery-scope'),
    platformEvidence: option('--platform-evidence'),
  };
  if (!Array.isArray(input.workflowRuns) || !Array.isArray(input.jobs)) {
    throw new Error('GitHub evidence snapshots require workflow_runs and jobs arrays');
  }
  try {
    const evidence = collectSuccessfulCiEvidence(workDir, input);
    process.stdout.write(
      `${JSON.stringify({
        schema: evidence.schema,
        state: evidence.state,
        deliverySha: evidence.deliverySha,
        workflowUrl: evidence.workflow.url,
        jobs: evidence.jobs.map((job) => job.name),
      })}\n`
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'ci_evidence_rejected';
    recordCiFailureHistory(workDir, input, reason);
    throw error;
  }
}
