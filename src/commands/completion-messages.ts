import { getCliLocale } from '../core/cli-locale.js';
import type { InstallerMessageDescriptor } from '../core/completions/factory.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

export interface CompletionUiMessages {
  unsupportedShell: (shell: string, supported: string) => string;
  autoDetectFailed: string;
  usage: (operation: string) => string;
  currentlySupported: (supported: string) => string;
  installing: (shell: string) => string;
  installedTo: (path: string) => string;
  backupCreated: (path: string) => string;
  configuredAutomatically: (path: string) => string;
  restartShell: (command: string) => string;
  installFailed: (detail: string) => string;
  fishConfiguration: string;
  shellConfiguration: (shell: string) => string;
  removeConfiguration: (path: string) => string;
  uninstallCancelled: string;
  uninstalling: (shell: string) => string;
  uninstallFailed: (detail: string) => string;
}

export function getCompletionUiMessages(
  locale: CliLocale = getCliLocale()
): CompletionUiMessages {
  const raw = getLocaleCatalog(locale).completion.ui;

  return {
    ...raw,
    unsupportedShell: (shell, supported) =>
      formatLocaleMessage(raw.unsupportedShell, { shell, supported }),
    usage: (operation) => formatLocaleMessage(raw.usage, { operation }),
    currentlySupported: (supported) =>
      formatLocaleMessage(raw.currentlySupported, { supported }),
    installing: (shell) => formatLocaleMessage(raw.installing, { shell }),
    installedTo: (path) => formatLocaleMessage(raw.installedTo, { path }),
    backupCreated: (path) => formatLocaleMessage(raw.backupCreated, { path }),
    configuredAutomatically: (path) =>
      formatLocaleMessage(raw.configuredAutomatically, { path }),
    restartShell: (command) => formatLocaleMessage(raw.restartShell, { command }),
    installFailed: (detail) => formatLocaleMessage(raw.installFailed, { detail }),
    shellConfiguration: (shell) =>
      formatLocaleMessage(raw.shellConfiguration, { shell }),
    removeConfiguration: (path) =>
      formatLocaleMessage(raw.removeConfiguration, { path }),
    uninstalling: (shell) => formatLocaleMessage(raw.uninstalling, { shell }),
    uninstallFailed: (detail) => formatLocaleMessage(raw.uninstallFailed, { detail }),
  };
}

export function formatInstallerMessage(
  descriptor: InstallerMessageDescriptor | undefined,
  fallback: string,
  locale: CliLocale = getCliLocale()
): string {
  if (!descriptor) return fallback;
  const messages = getLocaleCatalog(locale).completion.installerMessages as Record<string, string>;
  const template = messages[descriptor.key];
  if (!template) return fallback;
  return formatLocaleMessage(template, descriptor.values ?? {});
}
