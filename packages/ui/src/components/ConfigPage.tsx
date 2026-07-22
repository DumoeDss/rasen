import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { WireConfigEntry } from '../api/types.js';
import { groupEntries } from '../config/grouping.js';
import { useSpace } from '../store/use-space.js';
import { ConfigEntryRow } from './ConfigEntryRow.js';
import { GatesInventoryPanel } from './GatesInventoryPanel.js';

/**
 * The config page (design.md D6; management-ui-shell design D6): one
 * `listConfig` call renders the whole page, grouped by registry group,
 * re-fetching whenever the route's planning space changes. Config still rides
 * the config-api's own `?project=` param (child 1 did not move config onto
 * `?space=`), so this stays a thin route-derived reader: for a project space
 * it passes the project id exactly as before; for a store space, store-scoped
 * config is deferred to the later Config redesign, so it renders an explicit
 * notice rather than mis-addressing the store root as a project.
 */
export function ConfigPage() {
  const space = useSpace();
  const [entries, setEntries] = useState<WireConfigEntry[] | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const isStoreSpace = space?.type === 'store';
  const projectId = space?.type === 'project' ? space.id : undefined;

  useEffect(() => {
    if (isStoreSpace) {
      // Store-scoped config is deferred (design D6): nothing to fetch.
      setEntries(null);
      setPageError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    client
      .listConfig(projectId)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
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
  }, [projectId, isStoreSpace]);

  function updateEntry(updated: WireConfigEntry) {
    setEntries((current) =>
      current
        ? current.map((e) => (e.definition.key === updated.definition.key ? updated : e))
        : current
    );
  }

  if (isStoreSpace) {
    return (
      <p class="config-page__store-deferred" data-testid="config-store-deferred">
        Store configuration arrives with the Config redesign. Switch to a project space to edit
        project-scoped configuration.
      </p>
    );
  }

  if (loading) {
    return <p>Loading configuration…</p>;
  }

  return (
    <div>
      {pageError && (
        <p class="config-page__error">
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''} Use the space switcher above.
        </p>
      )}
      {renderEntries()}
    </div>
  );

  function renderEntries() {
    // A page-level error (design.md D6: "pointing at the switcher") is a
    // banner ABOVE the list, not a replacement for it — a single row's failed
    // write must not hide every entry that already loaded (m4).
    if (!entries) return null;

    const groups = groupEntries(entries);
    return groups.map((group) => (
      <section key={group.group} class="config-group">
        <h2>{group.group}</h2>
        {group.group === 'Autopilot' && <GatesInventoryPanel />}
        {group.entries.map((entry) => (
          <ConfigEntryRow
            key={entry.definition.key}
            entry={entry}
            projectId={projectId}
            onPageError={(message, fix) => setPageError({ message, fix })}
            onEntryUpdated={updateEntry}
          />
        ))}
      </section>
    ));
  }
}
