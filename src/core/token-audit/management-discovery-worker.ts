import { parentPort, workerData } from 'node:worker_threads';
import {
  discoverAuditSessions,
  type AuditManagementOptions,
} from './management.js';

const input = workerData as { limit: number | undefined; options: AuditManagementOptions };

try {
  parentPort?.postMessage({
    ok: true,
    result: discoverAuditSessions(input.limit, input.options),
  });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) },
  });
}
