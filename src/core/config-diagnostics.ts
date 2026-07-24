export const CONFIG_DIAGNOSTIC_KEYS = [
  'deliveryRetired',
  'invalidGlobalJson',
  'projectParseFailed',
  'projectNotObject',
  'invalidReferences',
  'invalidReferenceEntries',
  'invalidReferenceRemotes',
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
  'invalidWorkflows',
  'invalidProfile',
  'invalidArchiveTiming',
  'invalidArchiveDestination',
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

export function reportConfigDiagnostic(
  diagnostic: ConfigDiagnostic,
  reporter?: ConfigDiagnosticReporter
): void {
  if (reporter) {
    reporter(diagnostic);
    return;
  }

  if (diagnostic.output === 'error') {
    console.error(diagnostic.fallback);
  } else {
    console.warn(diagnostic.fallback);
  }
}
