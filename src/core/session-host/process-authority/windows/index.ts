export {
  WINDOWS_PROCESS_AUTHORITY_DESCRIPTOR,
  WINDOWS_PROCESS_AUTHORITY_PROTOCOL_VERSION,
  WINDOWS_PROCESS_AUTHORITY_PROVIDER_ID,
  WINDOWS_PROCESS_AUTHORITY_REFERENCE_VERSION,
  createWindowsProcessAuthorityProviderManifest,
  type WindowsProcessAuthorityManifestPaths,
} from './contracts.js';
export {
  JOB_OBJECT_LIMIT_BREAKAWAY_OK,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
  WINDOWS_BOOT_IDENTITY_SOURCES,
  WINDOWS_EXPECTED_JOB_LIMIT_MASK,
  createWindowsPrivateAuthorityReference,
  decodeWindowsPrivateAuthorityReference,
  toWindowsPrivateAuthorityReferenceDiagnostic,
  type WindowsBootIdentitySource,
  type WindowsPrivateAuthorityReference,
  type WindowsPrivateAuthorityReferenceDiagnostic,
  type WindowsPrivateAuthorityReferenceInput,
} from './private-reference.js';
export {
  WINDOWS_MAX_EXIT_STATUS,
  WINDOWS_STILL_ACTIVE_SENTINEL,
  mapWindowsNativeControlOutcome,
  mapWindowsNativeObservation,
  type WindowsNativeInertPhase,
} from './outcomes.js';
export {
  classifyWindowsAuthorityRecovery,
  parseWindowsAuthorityIdentityProbe,
  type WindowsAuthorityIdentityProbe,
  type WindowsAuthorityTerminalRecord,
  type WindowsIdentityProbeStage,
  type WindowsRecoveryClassification,
} from './recovery.js';
export {
  WINDOWS_PUBLICATION_DURABILITY_BARRIER,
  WindowsAuthorityPublicationLedger,
  createWindowsAuthorityPublicationLedger,
  createWindowsAuthorityPublicationPublisher,
  type WindowsAuthorityPublicationLedgerOptions,
  type WindowsAuthorityPublicationLookup,
} from './publication-ledger.js';
export {
  createWindowsProcessAuthorityProviderBundle,
  createWindowsProcessAuthorityProviderBundleWithTransport,
  digestWindowsAuthorityLaunch,
  type WindowsAuthorityExpectedArtifactIdentity,
  type WindowsAuthorityNativePrepareRequest,
  type WindowsAuthorityNativeTransport,
  type WindowsAuthorityRuntimeOpener,
  type WindowsProcessAuthorityProductionOptions,
  type WindowsProcessAuthorityProviderBundle,
  type WindowsProcessAuthorityProviderBundleOptions,
} from './provider.js';
export {
  WINDOWS_PROCESS_AUTHORITY_ARTIFACT_SCHEMA,
  inspectWindowsProcessAuthorityArtifact,
  resolveWindowsProcessAuthorityArtifact,
  type WindowsProcessAuthorityArtifactInspection,
  type WindowsProcessAuthorityArtifactInspectionOptions,
  type WindowsProcessAuthorityArtifactManifest,
  type WindowsProcessAuthorityArtifactResolutionOptions,
  type WindowsProcessAuthorityResolvedArtifact,
} from './artifact-resolver.js';
export {
  WINDOWS_PROCESS_AUTHORITY_BUILD_IDENTITIES,
  type WindowsAuthorityMode,
  type WindowsProcessAuthorityBuildIdentity,
} from './build-authority.js';
