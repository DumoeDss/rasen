import type { WorkflowId } from '../core/profiles.js';
import type {
  NamedProfileError,
  NamedProfileMessageDescriptor,
} from '../core/named-profiles.js';
import type { RetentionMode } from '../core/retention.js';
import { getCliLocale } from '../core/cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

export interface WorkflowPromptMeta {
  name: string;
  description: string;
}

export interface ProfilePromptMessages {
  workflowPickerMessage: string;
  workflowPickerInstructions: string;
  currentSuffix: string;
  sourceUser: string;
  requiredBy: (workflow: string) => string;
  workflows: Record<WorkflowId, WorkflowPromptMeta>;
  /** Picker metadata for built-in experts, keyed by expert id (D1: a disjoint id space from `workflows`). */
  experts: Record<string, WorkflowPromptMeta>;
  workflowsGroupLabel: string;
  expertsGroupLabel: string;
  /** Prompt shown above the single retention radio. */
  retentionPickerMessage: string;
  /** Radio choice metadata (name + description) for each retention mode. */
  retention: Record<RetentionMode, WorkflowPromptMeta>;
}

export interface ProfileUiMessages {
  errorPrefix: string;
  invalidProfile: string;
  invalidProfileFile: string;
  invalidProfileName: string;
  profileNameReserved: (name: string) => string;
  profileAlreadyExists: (name: string) => string;
  profileNameRequired: string;
  noSavedProfiles: string;
  profileCommandCancelled: string;
  profileNamePrompt: string;
  selectProfileToUse: string;
  selectProfileToDelete: string;
  selectProfileToUpdate: string;
  profileSource: (builtIn: boolean) => string;
  workflowCount: (count: number) => string;
  usingProfile: (name: string) => string;
  profileNewRequiresTty: string;
  profileUpdateRequiresTty: string;
  profileCannotUpdate: (name: string) => string;
  updatingProfile: (name: string) => string;
  saveProfileChanges: (name: string) => string;
  profileUpdateCancelled: string;
  profileUpdateNoChanges: (name: string) => string;
  profileUpdated: (name: string) => string;
  profileUpdatedGuidance: (name: string) => string;
  newProfile: (name: string) => string;
  usesCurrentSettings: string;
  saveAndUseProfile: (name: string) => string;
  profileCreationCancelled: string;
  profileCreated: (name: string) => string;
  profilesHeading: string;
  invalidMarker: string;
  matchesCurrentSettings: string;
  builtInCannotDelete: (name: string) => string;
  deletionRequiresConfirmation: string;
  deleteProfile: (name: string) => string;
  profileDeletionCancelled: string;
  profileDeleted: (name: string) => string;
  profileImported: (name: string, count: number) => string;
  useImportedProfile: (name: string) => string;
  destinationExists: (path: string) => string;
  overwriteFile: (path: string) => string;
  profileExportCancelled: string;
  profileExported: (subject: string, path: string) => string;
  namedProfileSettings: (name: string) => string;
  currentProfileSettings: string;
  applyGuidance: string;
  interactiveRequired: string;
  currentSettingsHeading: string;
  workflowsLabel: string;
  workflowSummary: (count: number, profile: string) => string;
  workflowsExplanation: string;
  availableBuiltInsNote: (workflows: string[]) => string;
  configurePrompt: string;
  actions: Record<'workflows' | 'keep', WorkflowPromptMeta>;
  noConfigChanges: string;
  driftWarning: string;
  driftWarningOverride: string;
  driftWarningLocked: (name: string) => string;
  profileChangesHeading: string;
  applyToProject: string;
  updateOtherProjects: string;
  updateFailed: string;
  profileCancelled: string;
  diffProfile: (before: string, after: string) => string;
  diffWorkflows: (added: string[], removed: string[]) => string;
  diffRetention: (before: RetentionMode, after: RetentionMode) => string;
  /** Localized label for the retention row in the current-settings summary. */
  retentionLabel: string;
  /** The localized display label for one retention mode (current settings summary). */
  retentionSummary: (mode: RetentionMode) => string;
  /** The localized display label for one retention mode (profile list rows). */
  retentionMode: (mode: RetentionMode) => string;
  externalError: (code: string, fallback: string) => string;
}

export function getProfilePromptMessages(
  locale: CliLocale = getCliLocale()
): ProfilePromptMessages {
  const raw = getLocaleCatalog(locale).profile.prompt;
  return {
    ...raw,
    requiredBy: (workflow) => formatLocaleMessage(raw.requiredBy, { workflow }),
  };
}

export function getProfileUiMessages(locale: CliLocale = getCliLocale()): ProfileUiMessages {
  const raw = getLocaleCatalog(locale).profile.ui;
  const format = (
    template: string,
    values: Record<string, string | number>
  ): string => formatLocaleMessage(template, values);

  return {
    ...raw,
    profileNameReserved: (name) => format(raw.profileNameReserved, { name }),
    profileAlreadyExists: (name) => format(raw.profileAlreadyExists, { name }),
    profileSource: (builtIn) =>
      builtIn ? raw.profileSourceBuiltIn : raw.profileSourceSaved,
    workflowCount: (count) => format(raw.workflowCount, { count }),
    usingProfile: (name) => format(raw.usingProfile, { name }),
    profileCannotUpdate: (name) => format(raw.profileCannotUpdate, { name }),
    updatingProfile: (name) => format(raw.updatingProfile, { name }),
    saveProfileChanges: (name) => format(raw.saveProfileChanges, { name }),
    profileUpdateNoChanges: (name) => format(raw.profileUpdateNoChanges, { name }),
    profileUpdated: (name) => format(raw.profileUpdated, { name }),
    profileUpdatedGuidance: (name) => format(raw.profileUpdatedGuidance, { name }),
    driftWarningLocked: (name) => format(raw.driftWarningLocked, { name }),
    newProfile: (name) => format(raw.newProfile, { name }),
    saveAndUseProfile: (name) => format(raw.saveAndUseProfile, { name }),
    profileCreated: (name) => format(raw.profileCreated, { name }),
    builtInCannotDelete: (name) => format(raw.builtInCannotDelete, { name }),
    deleteProfile: (name) => format(raw.deleteProfile, { name }),
    profileDeleted: (name) => format(raw.profileDeleted, { name }),
    profileImported: (name, count) =>
      format(raw.profileImported, { name, count }),
    useImportedProfile: (name) => format(raw.useImportedProfile, { name }),
    destinationExists: (path) => format(raw.destinationExists, { path }),
    overwriteFile: (path) => format(raw.overwriteFile, { path }),
    profileExported: (subject, path) => format(raw.profileExported, { subject, path }),
    namedProfileSettings: (name) => format(raw.namedProfileSettings, { name }),
    workflowSummary: (count, profile) => format(raw.workflowSummary, { count, profile }),
    availableBuiltInsNote: (workflows) =>
      format(raw.availableBuiltInsNote, { workflows: workflows.join(', ') }),
    diffProfile: (before, after) => format(raw.diffProfile, { before, after }),
    diffRetention: (before, after) => format(raw.diffRetention, { before, after }),
    retentionSummary: (mode) => (raw.retentionModes as Record<string, string>)[mode] ?? mode,
    retentionMode: (mode) => (raw.retentionModes as Record<string, string>)[mode] ?? mode,
    diffWorkflows: (added, removed) => {
      if (added.length > 0 && removed.length > 0) {
        return format(raw.diffWorkflowsBoth, {
          added: added.join(', '),
          removed: removed.join(', '),
        });
      }
      if (added.length > 0) {
        return format(raw.diffWorkflowsAdded, { items: added.join(', ') });
      }
      if (removed.length > 0) {
        return format(raw.diffWorkflowsRemoved, { items: removed.join(', ') });
      }
      return raw.diffWorkflowsEmpty;
    },
    externalError: (code, fallback) => {
      if (locale === 'en') return fallback;
      const errors = getLocaleCatalog(locale).workflowLibrary.errors as Record<string, string>;
      return format(errors[code] ?? errors.workflow_command_error, { code });
    },
  };
}

export function formatNamedProfileError(
  error: NamedProfileError,
  locale: CliLocale = getCliLocale()
): string {
  return formatNamedProfileMessageDescriptor(error.messageDescriptor, error.message, locale);
}

export function formatNamedProfileMessageDescriptor(
  descriptor: NamedProfileMessageDescriptor | undefined,
  fallback: string,
  locale: CliLocale = getCliLocale()
): string {
  if (!descriptor) return fallback;
  const errors = getLocaleCatalog(locale).profile.errors as Record<string, string>;
  const template = errors[descriptor.key];
  if (!template) return fallback;
  return formatLocaleMessage(template, descriptor.values ?? {});
}
