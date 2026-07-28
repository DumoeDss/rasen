import { parentPort, workerData } from 'node:worker_threads';
import { runAudit, type RunAuditOptions } from './audit.js';

interface WorkerInput {
  target: string;
  options: RunAuditOptions;
}

const input = workerData as WorkerInput;

runAudit(input.target, input.options).then(
  (result) => parentPort?.postMessage({ ok: true, result }),
  (error) =>
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
    })
);
