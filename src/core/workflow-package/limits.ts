export const WORKFLOW_PACKAGE_LIMITS = {
  maxPackageBytes: 16 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalContentBytes: 12 * 1024 * 1024,
  maxEntries: 256,
  maxWorkflows: 64,
  maxPathBytes: 240,
  maxJsonDepth: 32,
  maxJsonProperties: 4096,
} as const;

