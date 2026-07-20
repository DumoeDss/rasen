import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { WireConfigEntry } from '../api/types.js';
import { groupEntries } from '../config/grouping.js';
import { useProjectState } from '../store/use-project-state.js';
import { ConfigEntryRow } from './ConfigEntryRow.js';
import { GatesInventoryPanel } from './GatesInventoryPanel.js';

/**
 * The config page (design.md D6): one `listConfig` call renders the whole
 * page, grouped by registry group; re-fetches whenever the selected project
 * changes.
 */
export function ConfigPage() {
  const projectState = useProjectState();
  const [entries, setEntries] = useState<WireConfigEntry[] | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const projectId = projectState.selected?.projectId;

  useEffect(() => {
    if (!projectState.loaded) return;
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
  }, [projectId, projectState.loaded]);

  function updateEntry(updated: WireConfigEntry) {
    setEntries((current) =>
      current
        ? current.map((e) => (e.definition.key === updated.definition.key ? updated : e))
        : current
    );
  }

  if (!projectState.loaded || loading) {
    return <p>Loading configuration…</p>;
  }

  return (
    <div>
      {!projectState.selected && (
        <p class="config-page__no-project-hint">
          No project selected — showing global configuration only. Select a project above to view
          and edit project-scoped values.
        </p>
      )}
      {pageError && (
        <p class="config-page__error">
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''} Use the project switcher above.
        </p>
      )}
      {renderEntries()}
    </div>
  );

  function renderEntries() {
    // A page-level error (design.md D6: "pointing at the project switcher")
    // is a banner ABOVE the list, not a replacement for it — a single row's
    // failed write must not hide every entry that already loaded (m4).
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
