import { getCliLocale } from '../core/cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

export interface WorkflowUiMessages {
  errorPrefix: string;
  cancelled: string;
  source: (source: 'built-in' | 'user') => string;
  unused: string;
  invalid: string;
  warningPrefix: string;
  skillLabel: string;
  commandLabel: string;
  digestLabel: string;
  requiresWorkflowsLabel: string;
  requiresSkillsLabel: string;
  knownUsageLabel: string;
  none: string;
  createdDraft: (path: string) => string;
  workflowValid: string;
  workflowInvalid: string;
  diagnostic: (severity: string, code: string, path?: string) => string;
  imported: (items: string) => string;
  alreadyInstalled: (items: string) => string;
  replaceDestination: (path: string) => string;
  exported: (id: string, path: string) => string;
  deletionRequiresYes: string;
  deleteWorkflow: (id: string) => string;
  deleted: (id: string) => string;
  forcedDeleteWarning: (id: string, referrers: string[]) => string;
  projectConsumerWarning: string;
  taskGroupHeading: string;
  driverGroupHeading: string;
  expertGroupHeading: string;
  internalGroupHeading: string;
  kindLabel: string;
  error: (code: string, fallback: string) => string;
}

export function getWorkflowUiMessages(
  locale: CliLocale = getCliLocale()
): WorkflowUiMessages {
  const catalog = getLocaleCatalog(locale).workflowLibrary;
  const raw = catalog.ui;
  const errors = catalog.errors as Record<string, string>;
  const format = (template: string, values: Record<string, string | number>): string =>
    formatLocaleMessage(template, values);

  return {
    ...raw,
    source: (source) => source === 'built-in' ? raw.sourceBuiltIn : raw.sourceUser,
    createdDraft: (path) => format(raw.createdDraft, { path }),
    diagnostic: (severity, code, path) => format(raw.diagnostic, {
      severity: severity === 'warning' ? raw.severityWarning : raw.severityError,
      code,
      path: path ?? '-',
    }),
    imported: (items) => format(raw.imported, { items }),
    alreadyInstalled: (items) => format(raw.alreadyInstalled, { items }),
    replaceDestination: (path) => format(raw.replaceDestination, { path }),
    exported: (id, path) => format(raw.exported, { id, path }),
    deleteWorkflow: (id) => format(raw.deleteWorkflow, { id }),
    deleted: (id) => format(raw.deleted, { id }),
    forcedDeleteWarning: (id, referrers) => format(raw.forcedDeleteWarning, { id, referrers: referrers.join(', ') }),
    error: (code, fallback) => {
      if (locale === 'en') return fallback;
      const template = errors[code] ?? errors.workflow_command_error;
      return format(template, { code });
    },
  };
}
