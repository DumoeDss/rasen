import * as fs from 'node:fs';

interface ThresholdSchemeCleanupOps {
  closeSync: typeof fs.closeSync;
  rmSync: typeof fs.rmSync;
}

const defaultThresholdSchemeCleanupOps: ThresholdSchemeCleanupOps = {
  closeSync: fs.closeSync,
  rmSync: fs.rmSync,
};
let thresholdSchemeCleanupOps = defaultThresholdSchemeCleanupOps;

export function bestEffortCloseThresholdSchemeFile(fd: number): void {
  try {
    thresholdSchemeCleanupOps.closeSync(fd);
  } catch {
    // A completed mutation must not be reported as failed by lock cleanup.
  }
}

export function bestEffortRemoveThresholdSchemeFile(filePath: string): void {
  try {
    thresholdSchemeCleanupOps.rmSync(filePath, { force: true });
  } catch {
    // Cleanup debris is recoverable; cleanup must not replace an action result.
  }
}

/**
 * Package-private fault-injection seam. This module is intentionally absent
 * from src/core/index.ts and the package root export surface.
 */
export function setThresholdSchemeCleanupOpsForTesting(
  overrides?: Partial<ThresholdSchemeCleanupOps>
): () => void {
  thresholdSchemeCleanupOps = {
    ...defaultThresholdSchemeCleanupOps,
    ...overrides,
  };
  return () => {
    thresholdSchemeCleanupOps = defaultThresholdSchemeCleanupOps;
  };
}
