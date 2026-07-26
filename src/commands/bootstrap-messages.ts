import { getCliLocale } from '../core/cli-locale.js';
import type {
  BootstrapEndState,
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
  'knowledgeBundleStep',
  'declarationHeading',
  'declarationWritten',
  'declarationAlreadyDurable',
  'declarationNamelessStore',
] as const;

export type BootstrapMessageKey = (typeof BOOTSTRAP_MESSAGE_KEYS)[number];

/**
 * Command and flag descriptions, authored in English ON PURPOSE.
 *
 * Commander help is localized by the `commandDescriptions` lookup keyed on the
 * English text (`cli/help-localization.ts`), so a description handed to
 * Commander already in Japanese would fail that lookup and fall back to the
 * registry's English. Keeping them here as named constants means the command
 * file still spells out no English of its own, and the completion registry and
 * the command cannot drift apart on the text the lookup is keyed by.
 */
export const BOOTSTRAP_DESCRIPTIONS = {
  command: 'Report what this machine still needs before this project works',
  check: 'Check mode: report from local information only, contacting no network',
  dryRun: 'Preview mode: additionally resolve remotes and the exact location each repository would be placed at',
  apply: 'Apply mode: register the current checkout, register present-unregistered Stores, obtain declared Stores from their remotes, prepare the knowledge location, and write the durable declaration',
  yes: 'Skip confirmation prompts for the project-declared Stores (apply mode only; does not obtain a Store\'s projects from a Store checkout)',
  json: 'Output as JSON',
  path: 'Location for one store or project, as <selector>=<dir>; repeatable',
  into: 'Parent directory a derived name would be placed under',
} as const;

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
  knowledgeBundleStep: string;
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
    knowledgeBundleStep: raw.knowledgeBundleStep,
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
