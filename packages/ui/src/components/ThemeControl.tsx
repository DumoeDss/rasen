import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { WireConfigEntry } from '../api/types.js';
import {
  activateTheme,
  clearThemeWarning,
  EDITORIAL_THEME,
  getThemeSnapshot,
  refreshThemeCatalog,
  subscribeTheme,
} from '../theme/runtime.js';
import { useT } from '../i18n/store.js';

const MAX_THEME_BYTES = 256 * 1024;

function errorKey(code: string): string {
  const known: Record<string, string> = {
    payload_too_large: 'theme.error.size',
    invalid_json: 'theme.error.format',
    invalid_theme: 'theme.error.schema',
    unsupported_version: 'theme.error.version',
    unknown_token: 'theme.error.token',
    unknown_effect: 'theme.error.effect',
    invalid_identifier: 'theme.error.identifier',
    identifier_conflict: 'theme.error.conflict',
    persistence_failed: 'theme.error.persistence',
    theme_unavailable: 'theme.error.unavailable',
    theme_service_failed: 'theme.error.service',
  };
  return known[code] ?? 'theme.error.generic';
}

export function ThemeControl({
  entry,
  spaceSelector,
  onEntryUpdated,
}: {
  entry: WireConfigEntry;
  spaceSelector: string;
  onEntryUpdated: (entry: WireConfigEntry) => void;
}) {
  const t = useT();
  const [, rerender] = useState(0);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);

  useEffect(() => subscribeTheme(() => rerender((value) => value + 1)), []);
  useEffect(() => {
    void refreshThemeCatalog().catch(() => setErrorCode('theme_service_failed'));
  }, []);

  const { catalog, activeTheme, warningCode } = getThemeSnapshot();
  const configured = typeof entry.value === 'string' ? entry.value : 'editorial';
  const unavailable = !catalog.some((theme) => theme.id === configured);
  const configuredTheme = catalog.find((theme) => theme.id === configured);
  const configuredDescription =
    configuredTheme?.id === 'editorial'
      ? t('theme.editorial.description')
      : configuredTheme?.id === 'crt'
        ? t('theme.crt.description')
        : configuredTheme?.description;

  async function selectTheme(id: string) {
    if (pending) return;
    setPending(true);
    setErrorCode(null);
    try {
      const response = await client.putKey('ui.theme', { scope: 'global', value: id }, spaceSelector);
      const selected = catalog.find((theme) => theme.id === id);
      if (!selected) throw new Error('unavailable');
      clearThemeWarning();
      activateTheme(selected);
      onEntryUpdated(response.entry);
    } catch (error) {
      activateTheme(EDITORIAL_THEME);
      setErrorCode(error instanceof ApiError ? error.code : 'theme_unavailable');
    } finally {
      setPending(false);
    }
  }

  async function activateConfiguredTheme() {
    if (pending) return;
    setPending(true);
    setErrorCode(null);
    try {
      const selected = catalog.find((theme) => theme.id === configured);
      if (!selected) throw new Error('unavailable');
      activateTheme(selected);
      clearThemeWarning();
    } catch {
      activateTheme(EDITORIAL_THEME);
      setErrorCode('theme_unavailable');
    } finally {
      setPending(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file || importing) return;
    setSuccessName(null);
    setErrorCode(null);
    if (file.size > MAX_THEME_BYTES) {
      setErrorCode('payload_too_large');
      return;
    }
    setImporting(true);
    try {
      const response = await client.importTheme(file);
      await refreshThemeCatalog();
      setSuccessName(response.theme.name);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorCode(error.details?.[0]?.code ?? error.code);
      } else {
        setErrorCode('theme_service_failed');
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div class="config-entry theme-control" data-key="ui.theme" data-testid="theme-control">
      <div class="config-entry__header">
        <span class="config-entry__label">{t('theme.label')}</span>
        <span class="config-entry__key">ui.theme</span>
        <span class="config-entry__source config-entry__source--global">global</span>
      </div>
      <p class="config-entry__description">{t('theme.description')}</p>
      <label class="theme-control__selector">
        <span>{t('theme.selector')}</span>
        <select
          value={configured}
          disabled={pending}
          data-testid="theme-selector"
          onChange={(event) => void selectTheme((event.target as HTMLSelectElement).value)}
        >
          {unavailable && <option value={configured}>{configured} — {t('theme.unavailable')}</option>}
          {catalog.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.id === 'editorial'
                ? t('theme.editorial.name')
                : theme.id === 'crt'
                  ? t('theme.crt.name')
                  : theme.name}
            </option>
          ))}
        </select>
      </label>
      <p class="theme-control__metadata">
        {configuredDescription ?? (unavailable ? t('theme.unavailable_help') : '')}
      </p>
      {(activeTheme.id !== configured || warningCode) && (
        <button
          type="button"
          disabled={pending || !configuredTheme}
          data-testid="theme-activate"
          onClick={() => void activateConfiguredTheme()}
        >
          {pending ? t('theme.activating') : t('theme.activate')}
        </button>
      )}
      <label class="theme-control__import">
        <span>{importing ? t('theme.importing') : t('theme.import')}</span>
        <input
          type="file"
          accept=".json,application/json"
          disabled={importing}
          data-testid="theme-import"
          onChange={(event) => {
            const input = event.target as HTMLInputElement;
            void importFile(input.files?.[0]);
            input.value = '';
          }}
        />
      </label>
      {successName && <p class="theme-control__success" role="status">{t('theme.import_success', { name: successName })}</p>}
      {(errorCode || warningCode) && (
        <p class="config-entry__error" role="alert" data-testid="theme-error">
          {t(errorKey(errorCode ?? warningCode ?? 'generic'))} {t('theme.error.recovery')}
        </p>
      )}
    </div>
  );
}
