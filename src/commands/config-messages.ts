import type { ConfigKeyDefinition } from '../core/config-keys.js';
import { getCliLocale } from '../core/cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

export { formatConfigDiagnostic, createConfigDiagnosticReporter } from '../core/config-diagnostic-locale.js';

export interface ConfigEditorMessages {
  unsetValue: string;
  source: Record<'default' | 'global' | 'store' | 'project' | 'env-override', string>;
  environmentOverrideNote: string;
  workflowsDescription: string;
  workflowsDisabled: string;
  pinnedSpacesDescription: string;
  pinnedSpacesDisabled: string;
  projectRequired: string;
  scopePrompt: (key: string) => string;
  projectScope: string;
  globalScope: string;
  thresholdPrompt: (key: string) => string;
  errorPrefix: string;
  invalidConfiguration: (detail: string) => string;
  setValue: (key: string, value: string) => string;
  exit: string;
  heading: string;
  outsideProject: string;
  selectKey: string;
  manageWorkflows: string;
  effectiveHelp: string;
}

export interface ConfigCommandMessages {
  invalidScope: (scope: string) => string;
  projectNotFound: (workspace: string) => string;
  projectInitGuidance: string;
  profileSettingsHeading: string;
  explicitSource: string;
  defaultSource: string;
  fromFullProfile: string;
  fromCoreProfile: string;
  noneValue: string;
  invalidKey: (key: string, detail: string) => string;
  retiredKey: (key: string) => string;
  listKeysGuidance: (command: string) => string;
  allowUnknownGuidance: string;
  errorWithDetail: (detail: string) => string;
  invalidConfiguration: (detail: string) => string;
  setValue: (key: string, value: string) => string;
  unsetValue: (key: string) => string;
  keyNotSet: (key: string) => string;
  resetGlobalOnly: string;
  resetProjectGuidance: (workspace: string) => string;
  resetAllRequired: string;
  resetUsage: string;
  resetPrompt: string;
  resetCancelled: string;
  resetComplete: string;
  editGlobalOnly: string;
  editProjectGuidance: (workspace: string) => string;
  noEditor: string;
  editorGuidance: string;
  editorExample: string;
  editorExited: (code: number | null) => string;
  configFileNotFound: (path: string) => string;
  invalidJson: (path: string) => string;
  unableToValidate: (detail: string) => string;
}

export function configDescription(
  definition: ConfigKeyDefinition,
  locale: CliLocale = getCliLocale()
): string {
  const descriptions = getLocaleCatalog(locale).config.descriptions as Record<string, string>;
  return descriptions[definition.key] ?? definition.description;
}

export function configGroup(group: string, locale: CliLocale = getCliLocale()): string {
  const groups = getLocaleCatalog(locale).config.groups as Record<string, string>;
  return groups[group] ?? group;
}

export function getConfigEditorMessages(
  locale: CliLocale = getCliLocale()
): ConfigEditorMessages {
  const raw = getLocaleCatalog(locale).config.editor;

  return {
    ...raw,
    scopePrompt: (key) => formatLocaleMessage(raw.scopePrompt, { key }),
    thresholdPrompt: (key) => formatLocaleMessage(raw.thresholdPrompt, { key }),
    invalidConfiguration: (detail) =>
      formatLocaleMessage(raw.invalidConfiguration, { detail }),
    setValue: (key, value) => formatLocaleMessage(raw.setValue, { key, value }),
  };
}

export function getConfigCommandMessages(
  locale: CliLocale = getCliLocale()
): ConfigCommandMessages {
  const raw = getLocaleCatalog(locale).config.command;
  const format = (
    template: string,
    values: Record<string, string | number>
  ): string => formatLocaleMessage(template, values);

  return {
    ...raw,
    invalidScope: (scope) => format(raw.invalidScope, { scope }),
    projectNotFound: (workspace) => format(raw.projectNotFound, { workspace }),
    invalidKey: (key, detail) => format(raw.invalidKey, { key, detail }),
    retiredKey: (key) => format(raw.retiredKey, { key }),
    listKeysGuidance: (command) => format(raw.listKeysGuidance, { command }),
    errorWithDetail: (detail) => format(raw.errorWithDetail, { detail }),
    invalidConfiguration: (detail) => format(raw.invalidConfiguration, { detail }),
    setValue: (key, value) => format(raw.setValue, { key, value }),
    unsetValue: (key) => format(raw.unsetValue, { key }),
    keyNotSet: (key) => format(raw.keyNotSet, { key }),
    resetProjectGuidance: (workspace) => format(raw.resetProjectGuidance, { workspace }),
    editProjectGuidance: (workspace) => format(raw.editProjectGuidance, { workspace }),
    editorExited: (code) => format(raw.editorExited, { code: code ?? 'unknown' }),
    configFileNotFound: (path) => format(raw.configFileNotFound, { path }),
    invalidJson: (path) => format(raw.invalidJson, { path }),
    unableToValidate: (detail) => format(raw.unableToValidate, { detail }),
  };
}
