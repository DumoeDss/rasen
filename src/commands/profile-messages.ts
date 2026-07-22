import type { WorkflowId } from '../core/profiles.js';
import type {
  NamedProfileError,
  NamedProfileMessageDescriptor,
} from '../core/named-profiles.js';
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
  profileSource: (builtIn: boolean) => string;
  workflowCount: (count: number) => string;
  usingProfile: (name: string) => string;
  profileNewRequiresTty: string;
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
  configurePrompt: string;
  actions: Record<'workflows' | 'keep', WorkflowPromptMeta>;
  noConfigChanges: string;
  driftWarning: string;
  profileChangesHeading: string;
  applyToProject: string;
  updateOtherProjects: string;
  updateFailed: string;
  profileCancelled: string;
  diffProfile: (before: string, after: string) => string;
  diffWorkflows: (added: string[], removed: string[]) => string;
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
    diffProfile: (before, after) => format(raw.diffProfile, { before, after }),
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
