import { createHash } from 'node:crypto';

import type { WorkflowFileEntry } from './types.js';

export function sha256(bytes: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function computeWorkflowDigest(id: string, files: readonly WorkflowFileEntry[]): string {
  const preimage = {
    format: 'rasen-workflow-digest',
    version: 1,
    id,
    files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };
  return sha256(JSON.stringify(preimage));
}

