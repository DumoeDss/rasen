import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { StoreLayerRef, WireConfigEntry } from '../api/types.js';
import { modeScope, type ConfigMode, type SpaceType } from '../config/controls.js';
import { errorSurface } from '../config/errors.js';
import { useT } from '../i18n/store.js';

/**
 * Keepalive beat control (pipelines-ui spec). A dedicated Defaults-section
 * control for the global-only `keepalive.beatSeconds` key: one built-in preset
 * — 270s (economy, the registry default) — plus a bounded 90–280 custom input. Writes
 * go through the ordinary config API (`putKey`/`deleteKey`) exactly like the
 * autopilot Defaults rows; the control re-renders from the re-resolved entry on
 * every write. The derived tool-timeout hint (beat + 50s) is informational only
 * — it names the shell tool timeout the caller should raise, never a written
 * setting (design D2/D3).
 */

/** The configurable beat range (mirrors `keepalive.beatSeconds` registry validation). */
export const BEAT_MIN = 90;
export const BEAT_MAX = 280;
/** The built-in default preset (the registry default beat). */
const ECONOMY_PRESET = 270;
/** Informational tool-timeout margin over the beat (design D2). */
const TIMEOUT_MARGIN_SECONDS = 50;

interface KeepaliveBeatControlProps {
  entry: WireConfigEntry;
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
  entry,
  mode,
  spaceType,
  selector,
  onPageError,
  onEntryUpdated,
}: KeepaliveBeatControlProps) {
  const key = entry.definition.key;
  const writeScope = modeScope(mode, spaceType);
  const t = useT();
  const effective = typeof entry.value === 'number' ? entry.value : ECONOMY_PRESET;

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState<string>(String(effective));

  // Re-sync the custom input to the effective value whenever a write re-resolves
  // the entry (the control reflects the effective value on load and after each write).
  useEffect(() => {
    setCustom(String(effective));
  }, [effective]);

  async function run(fn: () => Promise<{ entry: WireConfigEntry }>) {
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
      setError(invalid);
      return;
    }
    void run(() => client.putKey(key, { scope: writeScope, value }, selector));
  }

  function unset() {
    void run(() => client.deleteKey(key, writeScope, selector));
  }

  // The hint tracks the value currently in play — the pending custom edit when it
  // parses, otherwise the effective value — so it updates live as the user types.
  const draft = Number(custom);
  const hintBeat = custom.trim() !== '' && !Number.isNaN(draft) ? draft : effective;
  const active = effective === ECONOMY_PRESET ? 'economy' : 'custom';

  return (
    <div class="keepalive-beat" data-testid="keepalive-beat-control" data-key={key} title={entry.definition.description}>
      <span class="keepalive-beat__label">{t('keepalive.label')}</span>
      <span class="keepalive-beat__desc">{t('keepalive.description')}</span>
      <div class="keepalive-beat__presets" role="group" aria-label={t('keepalive.presets_label')}>
        <button
          type="button"
          class={`member-chip${active === 'economy' ? ' member-chip--selected' : ''}`}
          data-testid="keepalive-preset-economy"
          title={t('keepalive.preset_economy_title')}
          aria-pressed={active === 'economy'}
          disabled={pending}
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
          disabled={pending}
          onInput={(e) => {
            setCustom((e.target as HTMLInputElement).value);
            setError(null);
          }}
        />
        <button
          type="button"
          data-testid="keepalive-custom-set"
          disabled={pending}
          onClick={() => {
            if (custom.trim() === '') {
              setError(t('keepalive.error_range', { min: BEAT_MIN, max: BEAT_MAX }));
              return;
            }
            commit(Number(custom));
          }}
        >
          {t('keepalive.set')}
        </button>
      </label>
      <span class="keepalive-beat__hint" data-testid="keepalive-timeout-hint">
        {t('keepalive.hint', { total: hintBeat + TIMEOUT_MARGIN_SECONDS, margin: TIMEOUT_MARGIN_SECONDS })}
      </span>
      <span
        class={`config-entry__source config-entry__source--${entry.source}`}
        data-testid="keepalive-source"
      >
        {entry.source}
      </span>
      {entry.source !== 'default' && (
        <button type="button" data-testid="keepalive-unset" disabled={pending} onClick={unset}>
          {t('keepalive.reset')}
        </button>
      )}
      {error && (
        <span class="keepalive-beat__error" role="alert" data-testid="keepalive-error">
          {t(error)}
        </span>
      )}
    </div>
  );
}
