import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { StoreLayerRef, WireConfigEntry } from '../api/types.js';
import { tabbedEntries } from '../config/grouping.js';
import type { ConfigMode } from '../config/controls.js';
import { useSpace } from '../store/use-space.js';
import { ConfigEntryRow } from './ConfigEntryRow.js';

/**
 * The config page (design D1/D2/D7): one space-addressed `listConfig` call
 * renders the whole page for either space type — a project space edits its
 * project layer, a store space edits the store's own values (the deferred stub
 * is gone). A page-level Global / Local segmented control is both the write
 * target and the visibility filter; keys are organized into scope-filtered
 * tabs; each row shows its layer transparency (inherited-from / shadowed
 * lines) and, for store-inherited keys, an edit-in-store link.
 */
export function ConfigPage() {
  const space = useSpace();
  const [entries, setEntries] = useState<WireConfigEntry[] | null>(null);
  const [storeRef, setStoreRef] = useState<StoreLayerRef | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  // Default Local (design D1): the user navigated into a space, so the space's
  // own configuration is the context; Global is one click away.
  const [mode, setMode] = useState<ConfigMode>('local');
  const [activeTab, setActiveTab] = useState<string | null>(null);

  const selector = space?.selector;
  const spaceType = space?.type ?? 'project';

  useEffect(() => {
    if (!selector) {
      setEntries(null);
      setStoreRef(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    client
      .listConfig(selector)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setStoreRef(res.store);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load configuration' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selector]);

  function updateEntry(updated: WireConfigEntry) {
    setEntries((current) =>
      current
        ? current.map((e) => (e.definition.key === updated.definition.key ? updated : e))
        : current
    );
  }

  if (loading) {
    return <p>Loading configuration…</p>;
  }

  const tabs = entries ? tabbedEntries(entries, mode, spaceType) : [];
  // The active tab is derived with a fallback so a mode switch that empties the
  // selected tab (e.g. Privacy in Local mode) lands on the first available tab
  // rather than a blank page — no reload, per the spec.
  const currentTab = tabs.find((t) => t.tab === activeTab) ?? tabs[0];

  return (
    <div>
      {pageError && (
        <p class="config-page__error">
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''} Use the space switcher above.
        </p>
      )}

      <div class="config-page__mode" role="group" aria-label="Configuration scope" data-testid="config-mode">
        <button
          type="button"
          class={`member-chip${mode === 'global' ? ' member-chip--selected' : ''}`}
          aria-pressed={mode === 'global'}
          onClick={() => setMode('global')}
        >
          Global
        </button>
        <button
          type="button"
          class={`member-chip${mode === 'local' ? ' member-chip--selected' : ''}`}
          aria-pressed={mode === 'local'}
          onClick={() => setMode('local')}
        >
          Local
        </button>
      </div>

      {tabs.length > 0 && (
        <div class="config-page__tabs" role="tablist" aria-label="Configuration sections" data-testid="config-tabs">
          {tabs.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              class={`member-chip${currentTab?.tab === t.tab ? ' member-chip--selected' : ''}`}
              aria-selected={currentTab?.tab === t.tab}
              onClick={() => setActiveTab(t.tab)}
            >
              {t.tab}
            </button>
          ))}
        </div>
      )}

      {currentTab?.groups.map((group) => (
        <section key={group.group} class="config-group">
          <h2>{group.group}</h2>
          {group.entries.map((entry) => (
            <ConfigEntryRow
              key={entry.definition.key}
              entry={entry}
              mode={mode}
              spaceType={spaceType}
              spaceSelector={selector ?? ''}
              storeRef={storeRef}
              onPageError={(message, fix) => setPageError({ message, fix })}
              onEntryUpdated={updateEntry}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
