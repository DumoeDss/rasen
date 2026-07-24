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
  candidatePathRequired: string;
  candidatePathMustBeAbsolute: (path: string) => string;
  candidateNotFound: (path: string) => string;
  candidateNotFile: (path: string) => string;
  candidateTooLarge: (size: number, maximum: number) => string;
  candidateInvalid: (detail: string) => string;
  approveGlobalNotForProject: string;
  codifyRequired: (retention: string) => string;
  projectRequired: string;
  plan: (summary: string) => string;
  blocked: (message: string) => string;
  globalApprovalPrompt: (id: string) => string;
  globalApprovalRequiredNonInteractive: (id: string) => string;
  globalApprovalDeclined: string;
  created: (scope: string, id: string) => string;
  rewritten: (scope: string, id: string) => string;
  retired: (scope: string, id: string) => string;
  renamed: (id: string) => string;
  noop: (id: string) => string;
  listHeading: string;
  listEmpty: string;
  listRow: (marker: string, id: string, scope: string, status: string, description: string) => string;
  provenanceSummary: (count: number, projects: number) => string;
  showNotFound: (id: string, scope: string) => string;
  showApplicability: (mode: string, markers: string) => string;
  retireConfirm: (scope: string, id: string) => string;
  retireRequiresConfirmation: string;
  retireCancelled: string;
  cancelled: string;
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
    candidatePathRequired: raw.candidatePathRequired,
    candidatePathMustBeAbsolute: (path) => format(raw.candidatePathMustBeAbsolute, { path }),
    candidateNotFound: (path) => format(raw.candidateNotFound, { path }),
    candidateNotFile: (path) => format(raw.candidateNotFile, { path }),
    candidateTooLarge: (size, maximum) => format(raw.candidateTooLarge, { size, maximum }),
    candidateInvalid: (detail) => format(raw.candidateInvalid, { detail }),
    approveGlobalNotForProject: raw.approveGlobalNotForProject,
    codifyRequired: (retention) => format(raw.codifyRequired, { retention }),
    projectRequired: raw.projectRequired,
    plan: (summary) => format(raw.plan, { summary }),
    blocked: (message) => format(raw.blocked, { message }),
    globalApprovalPrompt: (id) => format(raw.globalApprovalPrompt, { id }),
    globalApprovalRequiredNonInteractive: (id) =>
      format(raw.globalApprovalRequiredNonInteractive, { id }),
    globalApprovalDeclined: raw.globalApprovalDeclined,
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
    showNotFound: (id, scope) => format(raw.showNotFound, { id, scope }),
    showApplicability: (mode, markers) => format(raw.showApplicability, { mode, markers }),
    retireConfirm: (scope, id) => format(raw.retireConfirm, { scope, id }),
    retireRequiresConfirmation: raw.retireRequiresConfirmation,
    retireCancelled: raw.retireCancelled,
    cancelled: raw.cancelled,
  };
}
