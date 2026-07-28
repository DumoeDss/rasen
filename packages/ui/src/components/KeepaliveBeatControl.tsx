import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { StoreLayerRef, WireConfigEntry } from '../api/types.js';
import { modeScope, type ConfigMode, type SpaceType } from '../config/controls.js';
import { errorSurface } from '../config/errors.js';
import { useT } from '../i18n/store.js';

/**
 * Keepalive control (pipelines-ui spec). The effective `keepalive.enabled`
 * switch and retained `keepalive.beatSeconds` cadence share one Defaults card,
 * while writes, reset state, errors, and API re-resolution remain per-key.
 */

/** The configurable beat range (mirrors `keepalive.beatSeconds` registry validation). */
export const BEAT_MIN = 90;
export const BEAT_MAX = 280;
/** The built-in default preset (the registry default beat). */
const ECONOMY_PRESET = 270;
/** Informational tool-timeout margin over the beat (design D2). */
const TIMEOUT_MARGIN_SECONDS = 50;

interface KeepaliveBeatControlProps {
  enabledEntry?: WireConfigEntry;
  beatEntry?: WireConfigEntry;
  mode: ConfigMode;
  spaceType: SpaceType;
  selector: string;
  storeRef: StoreLayerRef | null;
  onPageError: (message: string, fix?: string) => void;
  onEntryUpdated: (entry: WireConfigEntry) => void;
}

/** Client-side mirror of the registry's 90–280 integer check — immediate feedback only, the server stays authoritative. */
function validateBeat(value: number, t: (key: string, values?: Record<string, string | number>) => string): string | null {
  if (!Number.isInteger(value) || value < BEAT_MIN || value > BEAT_MAX) {
    return t('keepalive.error_range', { min: BEAT_MIN, max: BEAT_MAX });
  }
  return null;
}

export function KeepaliveBeatControl({
  enabledEntry,
  beatEntry,
  mode,
  spaceType,
  selector,
  onPageError,
  onEntryUpdated,
}: KeepaliveBeatControlProps) {
  const writeScope = modeScope(mode, spaceType);
  const t = useT();
  const effectiveEnabled = enabledEntry?.value !== false;
  const effectiveBeat = typeof beatEntry?.value === 'number' ? beatEntry.value : ECONOMY_PRESET;

  const [enabledPending, setEnabledPending] = useState(false);
  const [enabledError, setEnabledError] = useState<string | null>(null);
  const [beatPending, setBeatPending] = useState(false);
  const [beatError, setBeatError] = useState<string | null>(null);
  const [custom, setCustom] = useState<string>(String(effectiveBeat));

  // Re-sync the custom input to the effective value whenever a write re-resolves
  // the entry (the control reflects the effective value on load and after each write).
  useEffect(() => {
    setCustom(String(effectiveBeat));
  }, [effectiveBeat]);

  async function run(
    fn: () => Promise<{ entry: WireConfigEntry }>,
    setPending: (pending: boolean) => void,
    setError: (error: string | null) => void
  ) {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      onEntryUpdated(result.entry);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) return;
        if (errorSurface(err.code) === 'page') onPageError(err.message, err.fix);
        else setError(err.message);
      } else {
        setError('status.error.write');
      }
    } finally {
      setPending(false);
    }
  }

  function commit(value: number) {
    const invalid = validateBeat(value, t);
    if (invalid) {
      setBeatError(invalid);
      return;
    }
    if (!beatEntry) return;
    void run(
      () => client.putKey(beatEntry.definition.key, { scope: writeScope, value }, selector),
      setBeatPending,
      setBeatError
    );
  }

  function setEnabled(value: boolean) {
    if (!enabledEntry) return;
    void run(
      () => client.putKey(enabledEntry.definition.key, { scope: writeScope, value }, selector),
      setEnabledPending,
      setEnabledError
    );
  }

  function unsetEntry(
    entry: WireConfigEntry,
    setPending: (pending: boolean) => void,
    setError: (error: string | null) => void
  ) {
    void run(
      () => client.deleteKey(entry.definition.key, writeScope, selector),
      setPending,
      setError
    );
  }

  // The hint tracks the value currently in play — the pending custom edit when it
  // parses, otherwise the effective value — so it updates live as the user types.
  const draft = Number(custom);
  const hintBeat = custom.trim() !== '' && !Number.isNaN(draft) ? draft : effectiveBeat;
  const active = effectiveBeat === ECONOMY_PRESET ? 'economy' : 'custom';

  return (
    <div
      class={`keepalive-beat${effectiveEnabled ? '' : ' keepalive-beat--disabled'}`}
      data-testid="keepalive-beat-control"
      data-enabled={String(effectiveEnabled)}
    >
      {enabledEntry && (
        <div class="keepalive-beat__enabled" title={enabledEntry.definition.description}>
          <div class="keepalive-beat__enabled-copy">
            <span class="keepalive-beat__label">{t('keepalive.enabled_label')}</span>
            <span class="keepalive-beat__desc">{t('keepalive.enabled_description')}</span>
          </div>
          <button
            type="button"
            class={`keepalive-beat__toggle${effectiveEnabled ? ' keepalive-beat__toggle--on' : ''}`}
            role="switch"
            aria-checked={effectiveEnabled}
            aria-label={t('keepalive.enabled_aria')}
            data-testid="keepalive-enabled-toggle"
            disabled={enabledPending}
            onClick={() => setEnabled(!effectiveEnabled)}
          >
            {effectiveEnabled ? t('keepalive.enabled_on') : t('keepalive.enabled_off')}
          </button>
          <span
            class={`config-entry__source config-entry__source--${enabledEntry.source}`}
            data-testid="keepalive-enabled-source"
          >
            {enabledEntry.source}
          </span>
          {enabledEntry.scopeValues[writeScope] !== undefined && (
            <button
              type="button"
              data-testid="keepalive-enabled-unset"
              disabled={enabledPending}
              onClick={() => unsetEntry(enabledEntry, setEnabledPending, setEnabledError)}
            >
              {t('keepalive.reset')}
            </button>
          )}
          {enabledError && (
            <span class="keepalive-beat__error" role="alert" data-testid="keepalive-enabled-error">
              {t(enabledError)}
            </span>
          )}
        </div>
      )}
      {beatEntry && (
        <div class="keepalive-beat__cadence" title={beatEntry.definition.description}>
          <span class="keepalive-beat__label">{t('keepalive.label')}</span>
          <span class="keepalive-beat__desc">{t('keepalive.description')}</span>
          <div class="keepalive-beat__presets" role="group" aria-label={t('keepalive.presets_label')}>
            <button
              type="button"
              class={`member-chip${active === 'economy' ? ' member-chip--selected' : ''}`}
              data-testid="keepalive-preset-economy"
              title={t('keepalive.preset_economy_title')}
              aria-pressed={active === 'economy'}
              disabled={beatPending}
              onClick={() => commit(ECONOMY_PRESET)}
            >
              {t('keepalive.preset_economy', { seconds: ECONOMY_PRESET })}
            </button>
          </div>
          <label class="keepalive-beat__custom">
            <span>{t('keepalive.custom')}</span>
            <input
              type="number"
              min={BEAT_MIN}
              max={BEAT_MAX}
              step="1"
              class="keepalive-beat__input"
              data-testid="keepalive-custom-input"
              value={custom}
              disabled={beatPending}
              onInput={(e) => {
                setCustom((e.target as HTMLInputElement).value);
                setBeatError(null);
              }}
            />
            <button
              type="button"
              data-testid="keepalive-custom-set"
              disabled={beatPending}
              onClick={() => {
                if (custom.trim() === '') {
                  setBeatError(t('keepalive.error_range', { min: BEAT_MIN, max: BEAT_MAX }));
                  return;
                }
                commit(Number(custom));
              }}
            >
              {t('keepalive.set')}
            </button>
          </label>
          <span class="keepalive-beat__hint" data-testid="keepalive-timeout-hint">
            {t('keepalive.hint', {
              total: hintBeat + TIMEOUT_MARGIN_SECONDS,
              margin: TIMEOUT_MARGIN_SECONDS,
            })}
          </span>
          <span
            class={`config-entry__source config-entry__source--${beatEntry.source}`}
            data-testid="keepalive-source"
          >
            {beatEntry.source}
          </span>
          {beatEntry.scopeValues[writeScope] !== undefined && (
            <button
              type="button"
              data-testid="keepalive-unset"
              disabled={beatPending}
              onClick={() => unsetEntry(beatEntry, setBeatPending, setBeatError)}
            >
              {t('keepalive.reset')}
            </button>
          )}
          {beatError && (
            <span class="keepalive-beat__error" role="alert" data-testid="keepalive-error">
              {t(beatError)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
