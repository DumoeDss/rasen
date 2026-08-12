/**
 * `store-scoped-issues-management` task 10.3–10.9 — the Store v2 aggregate
 * board. Groups Changes by project and target line, shows an incomplete-result
 * banner, and guards the create action until the user has explicitly chosen a
 * project and a target line. The Store is addressed by UID, never derived from
 * a `store:<id>` space selector.
 */
import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import type {
  StoreAggregateChangesResponse,
  StoreProjectRollupResponse,
} from '../api/types.js';

export interface StoreAggregateBoardProps {
  /** The Store's STABLE identity — never derived from the space selector. */
  storeUid: string;
}

export function StoreAggregateBoard({ storeUid }: StoreAggregateBoardProps) {
  const [rollup, setRollup] = useState<StoreProjectRollupResponse | null>(null);
  const [groups, setGroups] = useState<StoreAggregateChangesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosenProject, setChosenProject] = useState('');
  const [chosenLine, setChosenLine] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await client.storeProjects(storeUid);
        if (!cancelled) setRollup(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [storeUid]);

  // Load changes for the chosen project + line, or the whole Store.
  useEffect(() => {
    if (!chosenProject || !chosenLine) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await client.storeChanges(storeUid, {
          projectId: chosenProject,
          targetLineId: chosenLine,
        });
        if (!cancelled) setGroups(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [storeUid, chosenProject, chosenLine]);

  if (error) return <div class="store-board-error">{error}</div>;
  if (!rollup) return <div class="store-board-loading">Loading…</div>;

  return (
    <div class="store-aggregate-board" data-store-uid={storeUid}>
      <h2>Store Changes</h2>

      {/* The create action stays disabled until the user has chosen BOTH a
          project and a target line explicitly. The chosen values come from the
          form, never from the board's current filter state. */}
      <div class="store-create-guard">
        <select
          value={chosenProject}
          onChange={(e) => setChosenProject((e.target as HTMLSelectElement).value)}
          aria-label="Project"
        >
          <option value="">Select project…</option>
          {rollup.projects.map((p) => (
            <option key={p.projectId} value={p.projectId}>{p.projectId}</option>
          ))}
        </select>
        <select
          value={chosenLine}
          onChange={(e) => setChosenLine((e.target as HTMLSelectElement).value)}
          aria-label="Target line"
          disabled={!chosenProject}
        >
          <option value="">Select target line…</option>
          {rollup.targetLines.map((l) => (
            <option key={l.targetLineId} value={l.targetLineId}>{l.targetLineId}</option>
          ))}
        </select>
        <button
          disabled={!chosenProject || !chosenLine}
          data-testid="create-change-btn"
        >
          New Change
        </button>
      </div>

      {/* The incomplete-result banner appears whenever `complete` is false. */}
      {groups && !groups.complete && (
        <div class="incomplete-banner" data-testid="incomplete-banner">
          INCOMPLETE: {groups.unsearchedRefs.length} store ref(s) could not be searched
          {groups.unsearchedRefs.map((ref, i) => (
            <div key={i} class="unsearched-ref">
              {ref.storeRef} ({ref.targetLineId}): {ref.reason}
            </div>
          ))}
        </div>
      )}

      {/* Groups are keyed by (projectId, targetLineId). Every card states its
          project, target line, and Change instance. */}
      {groups && groups.groups.map((group) => (
        <div class="change-group" key={`${group.projectId}/${group.targetLineId}`}>
          <h3>{group.projectId} / {group.targetLineId}</h3>
          {group.active.map((entry) => (
            <div class="change-card active" key={entry.changeId}>
              <span class="change-project">{group.projectId}</span>
              <span class="change-line">{group.targetLineId}</span>
              <span class="change-id">{entry.changeId}</span>
              {entry.changeInstanceId && (
                <span class="change-instance">{entry.changeInstanceId}</span>
              )}
            </div>
          ))}
          {group.archived.map((entry) => (
            <div class="change-card archived" key={entry.entryName}>
              <span class="change-project">{group.projectId}</span>
              <span class="change-line">{group.targetLineId}</span>
              <span class="change-entry">{entry.entryName}</span>
              {entry.outcome && (
                <span class="change-outcome">{entry.outcome}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
