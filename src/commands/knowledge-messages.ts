import { getCliLocale } from '../core/cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

/**
 * Localized message surface for the `rasen knowledge` command group. Rasen-owned
 * framing (descriptions, prompts, result labels, path errors) is localized;
 * core block detail is passed through as data.
 */
export interface KnowledgeMessages {
  commandDescription: string;
  applyDescription: string;
  listDescription: string;
  showDescription: string;
  retireDescription: string;
  projectSelectorDescription: string;
  storeSelectorDescription: string;
  runStateDirDescription: string;
  contextSummary: (owner: string, planningRoot: string) => string;
  candidatePathRequired: string;
  candidatePathMustBeAbsolute: (path: string) => string;
  candidateNotFound: (path: string) => string;
  candidateNotFile: (path: string) => string;
  candidateTooLarge: (size: number, maximum: number) => string;
  candidateInvalid: (detail: string) => string;
  approveGlobalNotForProject: string;
  consentScopeMismatch: string;
  codifyRequired: (retention: string) => string;
  projectRequired: string;
  plan: (summary: string) => string;
  planTarget: (target: string) => string;
  planKnowledgeKey: (knowledgeKey: string) => string;
  planSources: (sources: string) => string;
  planSourcesNone: string;
  blocked: (message: string) => string;
  blockedNext: (command: string) => string;
  globalApprovalPrompt: (id: string) => string;
  globalApprovalRequiredNonInteractive: (id: string) => string;
  globalApprovalDeclined: string;
  storeApprovalPrompt: (id: string, store: string) => string;
  storeApprovalRequiredNonInteractive: (id: string, store: string) => string;
  storeApprovalDeclined: string;
  storeApprovalSelectorMismatch: (selector: string, store: string) => string;
  storeRootNotice: (root: string) => string;
  commitReminderHeading: string;
  commitReminderFile: (path: string) => string;
  commitReminderNothingStaged: string;
  created: (scope: string, id: string) => string;
  rewritten: (scope: string, id: string) => string;
  retired: (scope: string, id: string) => string;
  renamed: (id: string) => string;
  noop: (id: string) => string;
  listHeading: string;
  listEmpty: string;
  listRow: (marker: string, id: string, scope: string, status: string, description: string) => string;
  provenanceSummary: (count: number, projects: number) => string;
  unreadableHeading: string;
  unreadableRow: (id: string, scope: string, reason: string) => string;
  unreadableNext: string;
  showUnreadable: (id: string, scope: string, reason: string) => string;
  showNotFound: (id: string, scope: string) => string;
  showApplicability: (mode: string, markers: string) => string;
  retireConfirm: (scope: string, id: string) => string;
  retireRequiresConfirmation: string;
  retireCancelled: string;
  cancelled: string;
  effectiveDescription: string;
  migrateDescription: string;
  dryRunDescription: string;
  bundleDescription: string;
  bundleExportDescription: string;
  bundleDestinationDescription: string;
  bundleStoreDestinationDescription: string;
  bundleJsonDescription: string;
  bundleExportSucceeded: (project: string, records: number, destination: string) => string;
  bundleStoreExportSucceeded: (store: string, destination: string) => string;
  bundleStoreCommitFile: (file: string) => string;
  bundleExportWarningBaseCommit: string;
  bundleExportWarningStagingCleanup: string;
  bundleError: (message: string) => string;
  bundleRepair: (repair: string) => string;
  bundleProjectNotFound: (selector: string) => string;
  bundleProjectRepair: string;
  bundleDestinationOccupied: (destination: string) => string;
  bundleDestinationRepair: string;
  bundleRecordUnreadable: (record: string, reason: string) => string;
  bundleRecordRepair: (record: string, project: string) => string;
  bundleMachinePath: (record: string, field: string) => string;
  bundleMachinePathRepair: (record: string) => string;
  bundleSchemaInvalid: (detail: string) => string;
  bundleSchemaRepair: string;
  bundleWriteFailed: (destination: string, reason: string) => string;
  bundleWriteRepair: string;
  bundleStoreUnavailable: (selector: string, reason: string) => string;
  bundleStoreOverlap: (destination: string, store: string) => string;
  bundleStoreOverlapRepair: string;
  bundleStoreWriteFailed: (destination: string, reason: string) => string;
  bundleStoreWriteFailedAfterExport: (
    destination: string,
    reason: string,
    userDestination: string
  ) => string;
  bundleStoreWriteRepair: string;
  bundleStoreWritePartialRepair: string;
  effectiveHeading: (project: string, status: string) => string;
  effectiveRoots: (canonical: string, evaluation: string) => string;
  effectiveEmpty: string;
  effectiveRow: (id: string, scope: string, sources: string) => string;
  effectiveStoreRow: (store: string, status: string, relevance: string) => string;
  effectiveConflict: (id: string, kind: string, sources: string) => string;
  effectiveUnavailable: (store: string, detail: string) => string;
  migrateCatalogHeading: string;
  migrateCatalogNothing: string;
  migrateCatalogPlan: (moves: number, target: string) => string;
  migrateCatalogApplied: (moved: number, target: string, deduplicated: number) => string;
  migrateCatalogConflict: (id: string, locations: string) => string;
  migrateCatalogFailed: (id: string, reason: string) => string;
  migrateLedgerHeading: string;
  migrateLedgerNothing: string;
  migrateLedgerPlan: (entries: number) => string;
  migrateLedgerApplied: (entries: number) => string;
  migrateLedgerBlocked: (reason: string) => string;
  migrateDryRunNotice: string;
}

export function getKnowledgeMessages(locale: CliLocale = getCliLocale()): KnowledgeMessages {
  const raw = getLocaleCatalog(locale).knowledge;
  const format = (template: string, values: Record<string, string | number>): string =>
    formatLocaleMessage(template, values);
  return {
    commandDescription: raw.commandDescription,
    applyDescription: raw.applyDescription,
    listDescription: raw.listDescription,
    showDescription: raw.showDescription,
    retireDescription: raw.retireDescription,
    projectSelectorDescription: raw.projectSelectorDescription,
    storeSelectorDescription: raw.storeSelectorDescription,
    runStateDirDescription: raw.runStateDirDescription,
    contextSummary: (owner, planningRoot) =>
      format(raw.contextSummary, { owner, planningRoot }),
    candidatePathRequired: raw.candidatePathRequired,
    candidatePathMustBeAbsolute: (path) => format(raw.candidatePathMustBeAbsolute, { path }),
    candidateNotFound: (path) => format(raw.candidateNotFound, { path }),
    candidateNotFile: (path) => format(raw.candidateNotFile, { path }),
    candidateTooLarge: (size, maximum) => format(raw.candidateTooLarge, { size, maximum }),
    candidateInvalid: (detail) => format(raw.candidateInvalid, { detail }),
    approveGlobalNotForProject: raw.approveGlobalNotForProject,
    consentScopeMismatch: raw.consentScopeMismatch,
    codifyRequired: (retention) => format(raw.codifyRequired, { retention }),
    projectRequired: raw.projectRequired,
    plan: (summary) => format(raw.plan, { summary }),
    planTarget: (target) => format(raw.planTarget, { target }),
    planKnowledgeKey: (knowledgeKey) => format(raw.planKnowledgeKey, { knowledgeKey }),
    planSources: (sources) => format(raw.planSources, { sources }),
    planSourcesNone: raw.planSourcesNone,
    blocked: (message) => format(raw.blocked, { message }),
    blockedNext: (command) => format(raw.blockedNext, { command }),
    globalApprovalPrompt: (id) => format(raw.globalApprovalPrompt, { id }),
    globalApprovalRequiredNonInteractive: (id) =>
      format(raw.globalApprovalRequiredNonInteractive, { id }),
    globalApprovalDeclined: raw.globalApprovalDeclined,
    storeApprovalPrompt: (id, store) => format(raw.storeApprovalPrompt, { id, store }),
    storeApprovalRequiredNonInteractive: (id, store) =>
      format(raw.storeApprovalRequiredNonInteractive, { id, store }),
    storeApprovalDeclined: raw.storeApprovalDeclined,
    storeApprovalSelectorMismatch: (selector, store) =>
      format(raw.storeApprovalSelectorMismatch, { selector, store }),
    storeRootNotice: (root) => format(raw.storeRootNotice, { root }),
    commitReminderHeading: raw.commitReminderHeading,
    commitReminderFile: (path) => format(raw.commitReminderFile, { path }),
    commitReminderNothingStaged: raw.commitReminderNothingStaged,
    created: (scope, id) => format(raw.created, { scope, id }),
    rewritten: (scope, id) => format(raw.rewritten, { scope, id }),
    retired: (scope, id) => format(raw.retired, { scope, id }),
    renamed: (id) => format(raw.renamed, { id }),
    noop: (id) => format(raw.noop, { id }),
    listHeading: raw.listHeading,
    listEmpty: raw.listEmpty,
    listRow: (marker, id, scope, status, description) =>
      format(raw.listRow, { marker, id, scope, status, description }),
    provenanceSummary: (count, projects) => format(raw.provenanceSummary, { count, projects }),
    unreadableHeading: raw.unreadableHeading,
    unreadableRow: (id, scope, reason) => format(raw.unreadableRow, { id, scope, reason }),
    unreadableNext: raw.unreadableNext,
    showUnreadable: (id, scope, reason) => format(raw.showUnreadable, { id, scope, reason }),
    showNotFound: (id, scope) => format(raw.showNotFound, { id, scope }),
    showApplicability: (mode, markers) => format(raw.showApplicability, { mode, markers }),
    retireConfirm: (scope, id) => format(raw.retireConfirm, { scope, id }),
    retireRequiresConfirmation: raw.retireRequiresConfirmation,
    retireCancelled: raw.retireCancelled,
    cancelled: raw.cancelled,
    effectiveDescription: raw.effectiveDescription,
    migrateDescription: raw.migrateDescription,
    dryRunDescription: raw.dryRunDescription,
    bundleDescription: raw.bundleDescription,
    bundleExportDescription: raw.bundleExportDescription,
    bundleDestinationDescription: raw.bundleDestinationDescription,
    bundleStoreDestinationDescription: raw.bundleStoreDestinationDescription,
    bundleJsonDescription: raw.bundleJsonDescription,
    bundleExportSucceeded: (project, records, destination) =>
      format(raw.bundleExportSucceeded, { project, records, destination }),
    bundleStoreExportSucceeded: (store, destination) =>
      format(raw.bundleStoreExportSucceeded, { store, destination }),
    bundleStoreCommitFile: (file) => format(raw.bundleStoreCommitFile, { file }),
    bundleExportWarningBaseCommit: raw.bundleExportWarningBaseCommit,
    bundleExportWarningStagingCleanup: raw.bundleExportWarningStagingCleanup,
    bundleError: (message) => format(raw.bundleError, { message }),
    bundleRepair: (repair) => format(raw.bundleRepair, { repair }),
    bundleProjectNotFound: (selector) => format(raw.bundleProjectNotFound, { selector }),
    bundleProjectRepair: raw.bundleProjectRepair,
    bundleDestinationOccupied: (destination) =>
      format(raw.bundleDestinationOccupied, { destination }),
    bundleDestinationRepair: raw.bundleDestinationRepair,
    bundleRecordUnreadable: (record, reason) =>
      format(raw.bundleRecordUnreadable, { record, reason }),
    bundleRecordRepair: (record, project) =>
      format(raw.bundleRecordRepair, { record, project }),
    bundleMachinePath: (record, field) => format(raw.bundleMachinePath, { record, field }),
    bundleMachinePathRepair: (record) => format(raw.bundleMachinePathRepair, { record }),
    bundleSchemaInvalid: (detail) => format(raw.bundleSchemaInvalid, { detail }),
    bundleSchemaRepair: raw.bundleSchemaRepair,
    bundleWriteFailed: (destination, reason) =>
      format(raw.bundleWriteFailed, { destination, reason }),
    bundleWriteRepair: raw.bundleWriteRepair,
    bundleStoreUnavailable: (selector, reason) =>
      format(raw.bundleStoreUnavailable, { selector, reason }),
    bundleStoreOverlap: (destination, store) =>
      format(raw.bundleStoreOverlap, { destination, store }),
    bundleStoreOverlapRepair: raw.bundleStoreOverlapRepair,
    bundleStoreWriteFailed: (destination, reason) =>
      format(raw.bundleStoreWriteFailed, { destination, reason }),
    bundleStoreWriteFailedAfterExport: (destination, reason, userDestination) =>
      format(raw.bundleStoreWriteFailedAfterExport, {
        destination,
        reason,
        userDestination,
      }),
    bundleStoreWriteRepair: raw.bundleStoreWriteRepair,
    bundleStoreWritePartialRepair: raw.bundleStoreWritePartialRepair,
    effectiveHeading: (project, status) => format(raw.effectiveHeading, { project, status }),
    effectiveRoots: (canonical, evaluation) =>
      format(raw.effectiveRoots, { canonical, evaluation }),
    effectiveEmpty: raw.effectiveEmpty,
    effectiveRow: (id, scope, sources) => format(raw.effectiveRow, { id, scope, sources }),
    effectiveStoreRow: (store, status, relevance) =>
      format(raw.effectiveStoreRow, { store, status, relevance }),
    effectiveConflict: (id, kind, sources) => format(raw.effectiveConflict, { id, kind, sources }),
    effectiveUnavailable: (store, detail) => format(raw.effectiveUnavailable, { store, detail }),
    migrateCatalogHeading: raw.migrateCatalogHeading,
    migrateCatalogNothing: raw.migrateCatalogNothing,
    migrateCatalogPlan: (moves, target) => format(raw.migrateCatalogPlan, { moves, target }),
    migrateCatalogApplied: (moved, target, deduplicated) =>
      format(raw.migrateCatalogApplied, { moved, target, deduplicated }),
    migrateCatalogConflict: (id, locations) =>
      format(raw.migrateCatalogConflict, { id, locations }),
    migrateCatalogFailed: (id, reason) => format(raw.migrateCatalogFailed, { id, reason }),
    migrateLedgerHeading: raw.migrateLedgerHeading,
    migrateLedgerNothing: raw.migrateLedgerNothing,
    migrateLedgerPlan: (entries) => format(raw.migrateLedgerPlan, { entries }),
    migrateLedgerApplied: (entries) => format(raw.migrateLedgerApplied, { entries }),
    migrateLedgerBlocked: (reason) => format(raw.migrateLedgerBlocked, { reason }),
    migrateDryRunNotice: raw.migrateDryRunNotice,
  };
}
