export const CONFIG_DIAGNOSTIC_KEYS = [
  'deliveryRetired',
  'invalidGlobalJson',
  'projectParseFailed',
  'projectNotObject',
  'invalidReferences',
  'invalidReferenceEntries',
  'invalidReferenceRemotes',
  'invalidStoreMemberships',
  'invalidStoreMembershipEntries',
  'storeMembershipsWithoutIdentity',
  'invalidSchema',
  'contextTooLarge',
  'ignoringContext',
  'invalidContext',
  'emptyArtifactRules',
  'invalidArtifactRules',
  'invalidRules',
  'emptyQualityRules',
  'invalidQualityRules',
  'invalidStore',
  'invalidProjectId',
  'invalidKnowledgeBundle',
  'invalidWorkflows',
  'invalidProfile',
  'invalidTools',
  'invalidToolsEntries',
  'invalidUpdate',
  'invalidUpdatePin',
  'invalidArchiveTiming',
  'invalidArchiveDestination',
  'deprecatedArchiveDestination',
  'invalidArchive',
  'invalidAutopilotGates',
  'invalidAutopilotSelection',
  'invalidAutopilot',
  'invalidHandoffThreshold',
  'invalidHandoff',
  'expertSelectionMigration',
  'newBuiltInWorkflowsAvailable',
  'skillVersionMismatch',
  'profileLockShadowedByOverride',
  'profileLockCustom',
  'profileLockUnresolvable',
  'userWideProfileUnresolvable',
] as const;

export type ConfigDiagnosticKey = (typeof CONFIG_DIAGNOSTIC_KEYS)[number];

/**
 * A locale-neutral config diagnostic. `fallback` preserves the established
 * English output for programmatic callers that do not provide a reporter.
 */
export interface ConfigDiagnostic {
  key: ConfigDiagnosticKey;
  values?: Record<string, string | number>;
  fallback: string;
  output: 'error' | 'warn';
}

export type ConfigDiagnosticReporter = (diagnostic: ConfigDiagnostic) => void;

/**
 * Per-process set of warning keys already emitted on the default (no-reporter)
 * path. A warning the user has already seen should not repeat within the same
 * command — `readProjectConfig` is called multiple times per invocation and
 * each call re-parses and re-warns. Errors remain loud (the set is scoped to
 * `output: 'warn'` only). A reporter, when provided, always receives the
 * diagnostic regardless of the set (explicit reporters collect every event).
 */
const emittedWarnings = new Set<ConfigDiagnosticKey>();

/**
 * Resets the per-process warning dedup set. Test-only: the set is otherwise
 * process-scoped so a single CLI invocation suppresses repeats.
 */
export function _resetConfigDiagnosticDedup(): void {
  emittedWarnings.clear();
}

export function reportConfigDiagnostic(
  diagnostic: ConfigDiagnostic,
  reporter?: ConfigDiagnosticReporter
): void {
  if (reporter) {
    reporter(diagnostic);
    return;
  }

  if (diagnostic.output === 'warn') {
    if (emittedWarnings.has(diagnostic.key)) return;
    emittedWarnings.add(diagnostic.key);
  }

  if (diagnostic.output === 'error') {
    console.error(diagnostic.fallback);
  } else {
    console.warn(diagnostic.fallback);
  }
}
