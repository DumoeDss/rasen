import { getCliLocale } from '../core/cli-locale.js';
import type {
  BootstrapEndState,
  BootstrapBundleImportAction,
  BootstrapBundleImportOutcome,
  BootstrapLocationDemand,
  BootstrapLocationRefusal,
  BootstrapMembershipState,
  BootstrapMode,
  BootstrapProblemKind,
  BootstrapProjectAction,
  BootstrapProjectPresence,
  BootstrapStoreAction,
  BootstrapStoreClass,
} from '../core/store/bootstrap.js';
import type { StoreUnavailableReason } from '../core/store/identity.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

/**
 * Localized message surface for `rasen bootstrap`. Every string the command or
 * the core report module would otherwise spell out in English comes from here.
 *
 * Two things deliberately do NOT: the reason phrases, which are child A's
 * existing `pipeline.messages.storeReason*` vocabulary and are read through
 * rather than re-coined, and store diagnostics, which travel as data exactly as
 * every other Store surface passes them through.
 */
export const BOOTSTRAP_MESSAGE_KEYS = [
  'headingProject',
  'headingStore',
  'modeCheck',
  'modePreview',
  'modeApply',
  'stateLine',
  'stateComplete',
  'stateDegraded',
  'stateBlocked',
  'modeRequired',
  'modeRequiredCheck',
  'modeRequiredPreview',
  'modeRequiredApply',
  'modeConflict',
  'yesRequiresApply',
  'pathFormat',
  'reportsOnly',
  'nothingMissing',
  'storesHeading',
  'storeRow',
  'classVerified',
  'classPresentUnregistered',
  'classAbsentWithRemote',
  'classAbsentWithoutRemote',
  'classUnresolvable',
  'reasonLine',
  'remoteLine',
  'membershipLine',
  'membershipConfirmed',
  'membershipNotRecorded',
  'membershipUnverifiable',
  'repairHeading',
  'repairLine',
  'repairSupplyPath',
  'locationUsable',
  'locationRefused',
  'locationRefusedNotEmpty',
  'locationRefusedExistingCheckout',
  'locationRefusedUnreadable',
  'locationRequired',
  'locationRequiredNoLocation',
  'locationRequiredNoSafeName',
  'projectsHeading',
  'projectRow',
  'presencePresent',
  'presenceObtainable',
  'presenceUnlocatable',
  'presenceUnknown',
  'problemsHeading',
  'problemDeclarationMalformed',
  'problemStoreIdentityMismatch',
  'problemProjectIdentityMissing',
  'problemNotAStoreCheckout',
  'problemUnreadableState',
  'detailLine',
  'reportFailed',
  'confirmRegisterStore',
  'confirmUpgradeDeclaration',
  'actionLine',
  'actionRegistered',
  'actionObtained',
  'actionAlreadyRegistered',
  'actionDeclined',
  'actionObtainFailed',
  'actionNotActed',
  'projectActionLine',
  'projectActionObtained',
  'projectActionNotSelected',
  'projectActionObtainFailed',
  'projectActionAlreadyPresent',
  'confirmObtainStore',
  'selectProjectsPrompt',
  'knowledgeHeading',
  'knowledgePrepared',
  'knowledgeAlreadyHydrated',
  'bundleImportsHeading',
  'bundleRow',
  'bundleSourceProjectConfig',
  'bundleSourceStoreRecord',
  'bundleSourceLine',
  'bundleTrustLine',
  'bundleTrustProjectConfig',
  'bundleTrustStoreOnly',
  'bundleLocatorLine',
  'bundleLocatorInvalid',
  'bundlePathLine',
  'bundleAvailabilityLine',
  'bundleAvailabilityUsable',
  'bundleAvailabilityMissing',
  'bundleAvailabilityUnreadable',
  'bundleAvailabilityUnsafe',
  'bundleAvailabilityProjectUnavailable',
  'bundleOutcomeLine',
  'bundleOutcomeUnconfirmed',
  'bundleOutcomeUnavailable',
  'bundleOutcomeRefused',
  'bundleOutcomeImported',
  'bundleOutcomeAlreadyPresent',
  'bundlePlanLine',
  'bundleIdentityLine',
  'bundleBaseCommitLine',
  'bundleValueUnavailable',
  'bundleAddedLine',
  'bundleAlreadyPresentLine',
  'bundleConflictLine',
  'bundleConflictKnowledgeKeyLine',
  'bundleConflictBundleLine',
  'bundleConflictLocalManagedLine',
  'bundleConflictLocalOccupiedLine',
  'bundleConflictContent',
  'bundleConflictLifecycle',
  'bundleConflictOccupied',
  'bundleWarningLine',
  'bundleWarningBaseCommit',
  'bundleWarningBaseCommitUnavailable',
  'bundleWarningCleanupDeferred',
  'bundleRefusalLine',
  'bundleRefusalInvalid',
  'bundleRefusalProjectNotFound',
  'bundleRefusalProjectUnavailable',
  'bundleRefusalProjectMismatch',
  'bundleRefusalRecordId',
  'bundleRefusalCatalogUnavailable',
  'bundleRefusalCatalogDrift',
  'bundleRefusalConflict',
  'bundleRefusalLock',
  'bundleRefusalTransaction',
  'bundleRefusalRollback',
  'bundleRefusalGeneric',
  'bundleRefusalDetailsHeading',
  'bundleRefusalDetailLine',
  'bundleRefusalIssuesHeading',
  'bundleRefusalIssueLine',
  'bundleChangedLine',
  'bundleChangedYes',
  'bundleChangedNo',
  'bundleChangedUnknown',
  'bundleRetainedLine',
  'bundleRepairRestore',
  'bundleRepairEditDeclaration',
  'bundleRepairPermissions',
  'bundleRepairObtainProject',
  'bundleRepairImportInvalid',
  'bundleRepairImportProjectNotFound',
  'bundleRepairImportProjectUnavailable',
  'bundleRepairImportProjectMismatch',
  'bundleRepairImportRecordId',
  'bundleRepairImportCatalogUnavailable',
  'bundleRepairImportCatalogDrift',
  'bundleRepairImportConflict',
  'bundleRepairImportLock',
  'bundleRepairImportTransaction',
  'bundleRepairImportRollback',
  'bundleRepairImportGeneric',
  'confirmImportBundle',
  'declarationHeading',
  'declarationWritten',
  'declarationAlreadyDurable',
  'declarationNamelessStore',
] as const;

export type BootstrapMessageKey = (typeof BOOTSTRAP_MESSAGE_KEYS)[number];

export interface BootstrapMessages {
  headingProject: (path: string, mode: string) => string;
  headingStore: (store: string, path: string, mode: string) => string;
  mode: (mode: BootstrapMode) => string;
  stateLine: (state: string) => string;
  state: (state: BootstrapEndState) => string;
  modeRequired: string;
  modeRequiredCheck: string;
  modeRequiredPreview: string;
  modeRequiredApply: string;
  modeConflict: string;
  yesRequiresApply: string;
  pathFormat: (value: string) => string;
  reportsOnly: string;
  nothingMissing: string;
  storesHeading: string;
  storeRow: (store: string, state: string) => string;
  storeClass: (value: BootstrapStoreClass) => string;
  reasonLine: (reason: string) => string;
  reason: (reason: StoreUnavailableReason) => string;
  remoteLine: (remote: string) => string;
  membershipLine: (state: string) => string;
  membership: (state: BootstrapMembershipState) => string;
  repairHeading: string;
  repairLine: (value: string) => string;
  repairSupplyPath: (selector: string) => string;
  locationUsable: (path: string) => string;
  locationRefused: (path: string, reason: string) => string;
  locationRefusal: (value: BootstrapLocationRefusal) => string;
  locationRequired: (reason: string) => string;
  locationDemand: (value: BootstrapLocationDemand) => string;
  projectsHeading: string;
  projectRow: (project: string, state: string) => string;
  presence: (value: BootstrapProjectPresence) => string;
  problemsHeading: string;
  problem: (kind: BootstrapProblemKind, path: string) => string;
  detailLine: (detail: string) => string;
  reportFailed: (detail: string) => string;
  confirmRegisterStore: (selector: string, path: string) => string;
  confirmUpgradeDeclaration: (path: string) => string;
  confirmObtainStore: (selector: string, path: string) => string;
  actionLine: (action: string) => string;
  action: (action: BootstrapStoreAction) => string;
  projectActionLine: (action: string) => string;
  projectAction: (action: BootstrapProjectAction) => string;
  selectProjectsPrompt: string;
  knowledgeHeading: string;
  knowledgePrepared: (root: string) => string;
  knowledgeAlreadyHydrated: (root: string) => string;
  bundleImportsHeading: string;
  bundleRow: (project: string, actionKey: string) => string;
  bundleSource: (source: BootstrapBundleImportAction['sources'][number]) => string;
  bundleSourceLine: (source: string) => string;
  bundleTrustLine: (trust: string) => string;
  bundleTrust: (trust: BootstrapBundleImportAction['trust']) => string;
  bundleLocatorLine: (locator: string) => string;
  bundleLocatorInvalid: string;
  bundlePathLine: (path: string) => string;
  bundleAvailabilityLine: (availability: string) => string;
  bundleAvailability: (availability: BootstrapBundleImportAction['availability']) => string;
  bundleOutcomeLine: (outcome: string) => string;
  bundleOutcome: (outcome: BootstrapBundleImportOutcome) => string;
  bundlePlanLine: (added: number, present: number, conflicts: number) => string;
  bundleIdentityLine: (bundleId: string) => string;
  bundleBaseCommitLine: (commit: string | null) => string;
  bundleAddedLine: (
    record: NonNullable<BootstrapBundleImportAction['added']>[number]
  ) => string;
  bundleAlreadyPresentLine: (
    record: NonNullable<BootstrapBundleImportAction['alreadyPresent']>[number]
  ) => string;
  bundleConflictLine: (id: string, reason: string) => string;
  bundleConflictKnowledgeKeyLine: (knowledgeKey: string) => string;
  bundleConflictBundleLine: (digest: string, status: string) => string;
  bundleConflictLocalLine: (
    local: NonNullable<BootstrapBundleImportAction['conflicts']>[number]['local']
  ) => string;
  bundleConflictReason: (
    reason: NonNullable<BootstrapBundleImportAction['conflicts']>[number]['reason']
  ) => string;
  bundleWarningLine: (warning: string) => string;
  bundleWarning: (
    warning: NonNullable<BootstrapBundleImportAction['warnings']>[number]
  ) => string;
  bundleRefusalLine: (refusal: string) => string;
  bundleRefusal: (code: string) => string;
  bundleRefusalDetailsHeading: string;
  bundleRefusalDetailLine: (key: string, value: string) => string;
  bundleRefusalIssuesHeading: string;
  bundleRefusalIssueLine: (
    recordId: string | undefined,
    field: string | undefined,
    reason: string
  ) => string;
  bundleChangedLine: (changed: string) => string;
  bundleChanged: (changed: boolean | 'unknown') => string;
  bundleRetainedLine: (path: string) => string;
  bundleRepair: (repair: BootstrapBundleImportAction['repair'][number]) => string;
  confirmImportBundle: (project: string, path: string, trust: string) => string;
  declarationHeading: string;
  declarationWritten: (path: string) => string;
  declarationAlreadyDurable: string;
  declarationNamelessStore: string;
}

export function getBootstrapMessages(locale: CliLocale = getCliLocale()): BootstrapMessages {
  const catalog = getLocaleCatalog(locale);
  const raw = catalog.bootstrap;
  const reasons = catalog.pipeline.messages as Record<string, string>;
  const format = (template: string, values: Record<string, string | number>): string =>
    formatLocaleMessage(template, values);

  return {
    headingProject: (path, mode) => format(raw.headingProject, { path, mode }),
    headingStore: (store, path, mode) => format(raw.headingStore, { store, path, mode }),
    mode: (mode) => {
      if (mode === 'check') return raw.modeCheck;
      if (mode === 'preview') return raw.modePreview;
      return raw.modeApply;
    },
    stateLine: (state) => format(raw.stateLine, { state }),
    state: (state) => {
      if (state === 'complete') return raw.stateComplete;
      return state === 'degraded' ? raw.stateDegraded : raw.stateBlocked;
    },
    modeRequired: raw.modeRequired,
    modeRequiredCheck: raw.modeRequiredCheck,
    modeRequiredPreview: raw.modeRequiredPreview,
    modeRequiredApply: raw.modeRequiredApply,
    modeConflict: raw.modeConflict,
    yesRequiresApply: raw.yesRequiresApply,
    pathFormat: (value) => format(raw.pathFormat, { value }),
    reportsOnly: raw.reportsOnly,
    nothingMissing: raw.nothingMissing,
    storesHeading: raw.storesHeading,
    storeRow: (store, state) => format(raw.storeRow, { store, state }),
    storeClass: (value) => {
      switch (value) {
        case 'verified':
          return raw.classVerified;
        case 'present-unregistered':
          return raw.classPresentUnregistered;
        case 'absent-with-remote':
          return raw.classAbsentWithRemote;
        case 'absent-without-remote':
          return raw.classAbsentWithoutRemote;
        case 'unresolvable':
          return raw.classUnresolvable;
      }
    },
    reasonLine: (reason) => format(raw.reasonLine, { reason }),
    reason: (reason) => reasons[REASON_KEYS[reason]] ?? reason,
    remoteLine: (remote) => format(raw.remoteLine, { remote }),
    membershipLine: (state) => format(raw.membershipLine, { state }),
    membership: (state) => {
      if (state === 'confirmed') return raw.membershipConfirmed;
      return state === 'not-recorded' ? raw.membershipNotRecorded : raw.membershipUnverifiable;
    },
    repairHeading: raw.repairHeading,
    repairLine: (value) => format(raw.repairLine, { value }),
    repairSupplyPath: (selector) => format(raw.repairSupplyPath, { selector }),
    locationUsable: (path) => format(raw.locationUsable, { path }),
    locationRefused: (path, reason) => format(raw.locationRefused, { path, reason }),
    locationRefusal: (value) => {
      switch (value) {
        case 'not-empty':
          return raw.locationRefusedNotEmpty;
        case 'existing-checkout':
          return raw.locationRefusedExistingCheckout;
        case 'unreadable':
          return raw.locationRefusedUnreadable;
      }
    },
    locationRequired: (reason) => format(raw.locationRequired, { reason }),
    locationDemand: (value) =>
      value === 'no-location-supplied'
        ? raw.locationRequiredNoLocation
        : raw.locationRequiredNoSafeName,
    projectsHeading: raw.projectsHeading,
    projectRow: (project, state) => format(raw.projectRow, { project, state }),
    presence: (value) => {
      switch (value) {
        case 'present':
          return raw.presencePresent;
        case 'obtainable':
          return raw.presenceObtainable;
        case 'unlocatable':
          return raw.presenceUnlocatable;
        case 'unknown':
          return raw.presenceUnknown;
      }
    },
    problemsHeading: raw.problemsHeading,
    problem: (kind, path) => {
      switch (kind) {
        case 'declaration-malformed':
          return format(raw.problemDeclarationMalformed, { path });
        case 'store-identity-mismatch':
          return format(raw.problemStoreIdentityMismatch, { path });
        case 'project-identity-missing':
          return format(raw.problemProjectIdentityMissing, { path });
        case 'not-a-store-checkout':
          return format(raw.problemNotAStoreCheckout, { path });
        case 'unreadable-state':
          return format(raw.problemUnreadableState, { path });
      }
    },
    detailLine: (detail) => format(raw.detailLine, { detail }),
    reportFailed: (detail) => format(raw.reportFailed, { detail }),
    confirmRegisterStore: (selector, storePath) =>
      format(raw.confirmRegisterStore, { selector, path: storePath }),
    confirmUpgradeDeclaration: (configPath) =>
      format(raw.confirmUpgradeDeclaration, { path: configPath }),
    confirmObtainStore: (selector, targetPath) =>
      format(raw.confirmObtainStore, { selector, path: targetPath }),
    actionLine: (action) => format(raw.actionLine, { action }),
    action: (value) => {
      switch (value) {
        case 'registered':
          return raw.actionRegistered;
        case 'obtained':
          return raw.actionObtained;
        case 'already-registered':
          return raw.actionAlreadyRegistered;
        case 'declined':
          return raw.actionDeclined;
        case 'obtain-failed':
          return raw.actionObtainFailed;
        case 'not-acted':
          return raw.actionNotActed;
      }
    },
    projectActionLine: (action) => format(raw.projectActionLine, { action }),
    projectAction: (value) => {
      switch (value) {
        case 'obtained':
          return raw.projectActionObtained;
        case 'not-selected':
          return raw.projectActionNotSelected;
        case 'obtain-failed':
          return raw.projectActionObtainFailed;
        case 'already-present':
          return raw.projectActionAlreadyPresent;
      }
    },
    selectProjectsPrompt: raw.selectProjectsPrompt,
    knowledgeHeading: raw.knowledgeHeading,
    knowledgePrepared: (root) => format(raw.knowledgePrepared, { root }),
    knowledgeAlreadyHydrated: (root) => format(raw.knowledgeAlreadyHydrated, { root }),
    bundleImportsHeading: raw.bundleImportsHeading,
    bundleRow: (project, actionKey) => format(raw.bundleRow, { project, actionKey }),
    bundleSource: (source) =>
      source.kind === 'project-config'
        ? format(raw.bundleSourceProjectConfig, { path: source.declarationPath })
        : format(raw.bundleSourceStoreRecord, {
            store: source.storeUid ?? source.storeId,
            path: source.declarationPath,
          }),
    bundleSourceLine: (source) => format(raw.bundleSourceLine, { source }),
    bundleTrustLine: (trust) => format(raw.bundleTrustLine, { trust }),
    bundleTrust: (trust) =>
      trust === 'project-config'
        ? raw.bundleTrustProjectConfig
        : raw.bundleTrustStoreOnly,
    bundleLocatorLine: (locator) => format(raw.bundleLocatorLine, { locator }),
    bundleLocatorInvalid: raw.bundleLocatorInvalid,
    bundlePathLine: (bundlePath) => format(raw.bundlePathLine, { path: bundlePath }),
    bundleAvailabilityLine: (availability) =>
      format(raw.bundleAvailabilityLine, { availability }),
    bundleAvailability: (availability) => {
      switch (availability) {
        case 'usable':
          return raw.bundleAvailabilityUsable;
        case 'missing':
          return raw.bundleAvailabilityMissing;
        case 'unreadable':
          return raw.bundleAvailabilityUnreadable;
        case 'unsafe':
          return raw.bundleAvailabilityUnsafe;
        case 'project-unavailable':
          return raw.bundleAvailabilityProjectUnavailable;
      }
    },
    bundleOutcomeLine: (outcome) => format(raw.bundleOutcomeLine, { outcome }),
    bundleOutcome: (outcome) => {
      switch (outcome) {
        case 'unconfirmed':
          return raw.bundleOutcomeUnconfirmed;
        case 'unavailable':
          return raw.bundleOutcomeUnavailable;
        case 'refused':
          return raw.bundleOutcomeRefused;
        case 'imported':
          return raw.bundleOutcomeImported;
        case 'already-present':
          return raw.bundleOutcomeAlreadyPresent;
      }
    },
    bundlePlanLine: (added, present, conflicts) =>
      format(raw.bundlePlanLine, { added, present, conflicts }),
    bundleIdentityLine: (bundleId) => format(raw.bundleIdentityLine, { bundleId }),
    bundleBaseCommitLine: (commit) =>
      format(raw.bundleBaseCommitLine, {
        commit: commit ?? raw.bundleValueUnavailable,
      }),
    bundleAddedLine: (record) =>
      format(raw.bundleAddedLine, {
        id: record.id,
        knowledgeKey: record.knowledgeKey,
        status: record.status,
        digest: record.contentDigest,
      }),
    bundleAlreadyPresentLine: (record) =>
      format(raw.bundleAlreadyPresentLine, {
        id: record.id,
        knowledgeKey: record.knowledgeKey,
        status: record.status,
        digest: record.contentDigest,
      }),
    bundleConflictLine: (id, reason) => format(raw.bundleConflictLine, { id, reason }),
    bundleConflictKnowledgeKeyLine: (knowledgeKey) =>
      format(raw.bundleConflictKnowledgeKeyLine, { knowledgeKey }),
    bundleConflictBundleLine: (digest, status) =>
      format(raw.bundleConflictBundleLine, { digest, status }),
    bundleConflictLocalLine: (local) =>
      local.kind === 'managed'
        ? format(raw.bundleConflictLocalManagedLine, {
            digest: local.contentDigest,
            status: local.status,
          })
        : format(raw.bundleConflictLocalOccupiedLine, {
            description: local.description,
          }),
    bundleConflictReason: (reason) => {
      if (reason === 'content-differs') return raw.bundleConflictContent;
      return reason === 'lifecycle-differs'
        ? raw.bundleConflictLifecycle
        : raw.bundleConflictOccupied;
    },
    bundleWarningLine: (warning) => format(raw.bundleWarningLine, { warning }),
    bundleWarning: (warning) => {
      const commit = warning.baseProjectCommit ?? raw.bundleValueUnavailable;
      if (warning.code === 'base_project_commit_provenance') {
        return format(raw.bundleWarningBaseCommit, { commit });
      }
      return warning.code === 'base_project_commit_unavailable'
        ? raw.bundleWarningBaseCommitUnavailable
        : format(raw.bundleWarningCleanupDeferred, { commit });
    },
    bundleRefusalLine: (refusal) => format(raw.bundleRefusalLine, { refusal }),
    bundleRefusal: (code) => {
      const refusalByCode: Record<string, string> = {
        knowledge_bundle_import_bundle_invalid: raw.bundleRefusalInvalid,
        knowledge_bundle_import_project_not_found: raw.bundleRefusalProjectNotFound,
        knowledge_bundle_import_project_unavailable: raw.bundleRefusalProjectUnavailable,
        knowledge_bundle_import_project_mismatch: raw.bundleRefusalProjectMismatch,
        knowledge_bundle_import_record_id_invalid: raw.bundleRefusalRecordId,
        knowledge_bundle_import_record_id_collision: raw.bundleRefusalRecordId,
        knowledge_bundle_import_catalog_unavailable: raw.bundleRefusalCatalogUnavailable,
        knowledge_bundle_import_catalog_drift: raw.bundleRefusalCatalogDrift,
        knowledge_bundle_import_conflict: raw.bundleRefusalConflict,
        knowledge_bundle_import_lock_failed: raw.bundleRefusalLock,
        knowledge_bundle_import_transaction_failed: raw.bundleRefusalTransaction,
        knowledge_bundle_import_rollback_failed: raw.bundleRefusalRollback,
      };
      return refusalByCode[code] ?? raw.bundleRefusalGeneric;
    },
    bundleRefusalDetailsHeading: raw.bundleRefusalDetailsHeading,
    bundleRefusalDetailLine: (key, value) =>
      format(raw.bundleRefusalDetailLine, { key, value }),
    bundleRefusalIssuesHeading: raw.bundleRefusalIssuesHeading,
    bundleRefusalIssueLine: (recordId, field, reason) =>
      format(raw.bundleRefusalIssueLine, {
        record: recordId ?? raw.bundleValueUnavailable,
        field: field ?? raw.bundleValueUnavailable,
        reason,
      }),
    bundleChangedLine: (changed) => format(raw.bundleChangedLine, { changed }),
    bundleChanged: (changed) =>
      changed === 'unknown'
        ? raw.bundleChangedUnknown
        : changed
          ? raw.bundleChangedYes
          : raw.bundleChangedNo,
    bundleRetainedLine: (retainedPath) =>
      format(raw.bundleRetainedLine, { path: retainedPath }),
    bundleRepair: (repair) => {
      switch (repair.kind) {
        case 'restore-file':
          return format(raw.bundleRepairRestore, { path: repair.path });
        case 'edit-declaration':
          return format(raw.bundleRepairEditDeclaration, { path: repair.path });
        case 'repair-permissions':
          return format(raw.bundleRepairPermissions, { path: repair.path });
        case 'obtain-project':
          return format(raw.bundleRepairObtainProject, { project: repair.projectId });
        case 'repair-import': {
          const repairByCode: Record<string, string> = {
            knowledge_bundle_import_bundle_invalid: raw.bundleRepairImportInvalid,
            knowledge_bundle_import_project_not_found:
              raw.bundleRepairImportProjectNotFound,
            knowledge_bundle_import_project_unavailable:
              raw.bundleRepairImportProjectUnavailable,
            knowledge_bundle_import_project_mismatch:
              raw.bundleRepairImportProjectMismatch,
            knowledge_bundle_import_record_id_invalid:
              raw.bundleRepairImportRecordId,
            knowledge_bundle_import_record_id_collision:
              raw.bundleRepairImportRecordId,
            knowledge_bundle_import_catalog_unavailable:
              raw.bundleRepairImportCatalogUnavailable,
            knowledge_bundle_import_catalog_drift:
              raw.bundleRepairImportCatalogDrift,
            knowledge_bundle_import_conflict: raw.bundleRepairImportConflict,
            knowledge_bundle_import_lock_failed: raw.bundleRepairImportLock,
            knowledge_bundle_import_transaction_failed:
              raw.bundleRepairImportTransaction,
            knowledge_bundle_import_rollback_failed:
              raw.bundleRepairImportRollback,
          };
          return format(
            repairByCode[repair.code] ?? raw.bundleRepairImportGeneric,
            { path: repair.bundlePath }
          );
        }
      }
    },
    confirmImportBundle: (project, bundlePath, trust) =>
      format(raw.confirmImportBundle, { project, path: bundlePath, trust }),
    declarationHeading: raw.declarationHeading,
    declarationWritten: (configPath) => format(raw.declarationWritten, { path: configPath }),
    declarationAlreadyDurable: raw.declarationAlreadyDurable,
    declarationNamelessStore: raw.declarationNamelessStore,
  };
}

/** Child A's reason vocabulary, reused rather than re-coined. */
const REASON_KEYS: Record<StoreUnavailableReason, string> = {
  'not-registered': 'storeReasonNotRegistered',
  'metadata-missing': 'storeReasonMetadataMissing',
  'uid-mismatch': 'storeReasonUidMismatch',
  'root-unhealthy': 'storeReasonRootUnhealthy',
  'alias-ambiguous': 'storeReasonAliasAmbiguous',
  'pointer-malformed': 'storeReasonPointerMalformed',
};
