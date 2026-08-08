/**
 * `store-scoped-issues-management` task 10.5–10.7 — the Store Issues view.
 * Shows the Issue list with state, and an Issue detail showing the latest
 * Execution Plan revision's nodes, their kinds, dependency edges, and states.
 * Unresolved, ambiguous, and divergent are shown as themselves — never as an
 * empty cell or a zero.
 */
import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import type {
  StoreIssueListResponse,
  StoreIssueDetailResponse,
} from '../api/types.js';

export interface StoreIssuesViewProps {
  storeUid: string;
}

export function StoreIssuesView({ storeUid }: StoreIssuesViewProps) {
  const [list, setList] = useState<StoreIssueListResponse | null>(null);
  const [selected, setSelected] = useState<StoreIssueDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await client.storeIssues(storeUid);
        if (!cancelled) setList(r);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [storeUid]);

  async function selectIssue(issueId: string) {
    try {
      const detail = await client.storeIssueDetail(storeUid, issueId);
      setSelected(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) return <div class="store-issues-error">{error}</div>;
  if (!list) return <div class="store-issues-loading">Loading…</div>;

  return (
    <div class="store-issues-view" data-store-uid={storeUid}>
      <h2>Store Issues</h2>

      {/* The incomplete-result banner. */}
      {!list.complete && (
        <div class="incomplete-banner" data-testid="issues-incomplete-banner">
          INCOMPLETE: {list.unsearchedRefs.length} store ref(s) could not be searched
        </div>
      )}

      {/* The Issue list with state. */}
      <ul class="issue-list">
        {list.issues.length === 0 && <li class="no-issues">No issues</li>}
        {list.issues.map((issue) => (
          <li
            key={issue.issueId}
            class="issue-entry"
            data-issue-state={issue.record?.state ?? 'unknown'}
            onClick={() => selectIssue(issue.issueId)}
          >
            <span class="issue-id">{issue.issueId}</span>
            <span class="issue-state">[{issue.record?.state ?? 'UNREADABLE'}]</span>
            {/* Divergent Issues show the divergence, not an empty cell. */}
            {issue.divergence && (
              <span class="issue-divergent">DIVERGENT across {issue.divergence.copies.length} copies</span>
            )}
            {issue.uncommitted && <span class="issue-uncommitted">(uncommitted)</span>}
            <span class="issue-title">{issue.record?.title ?? '(record does not validate)'}</span>
          </li>
        ))}
      </ul>

      {/* Issue detail with plan nodes. */}
      {selected && selected.plan && selected.plan.revision && (
        <div class="issue-detail" data-testid="issue-detail">
          <h3>
            Plan {selected.plan.revisionId}
            {selected.plan.revision.supersedes && ` (supersedes ${selected.plan.revision.supersedes})`}
          </h3>
          {selected.plan.readiness.nodes.map((entry) => {
            const node = entry.node;
            return (
              <div
                class="plan-node"
                key={node.nodeId}
                data-node-kind={node.kind}
                data-node-state={entry.resolution.status}
              >
                <div class="node-header">
                  {node.nodeId} [{node.kind}] {node.projectId}/{node.targetLineId}
                </div>
                {/* Unresolved, ambiguous, divergent shown as themselves. */}
                {entry.resolution.status === 'unresolved' && (
                  <div class="node-unresolved">
                    unresolved — searched: {entry.resolution.searchedRefs?.join(', ') || '(no readable ref)'}
                  </div>
                )}
                {entry.resolution.status === 'ambiguous' && (
                  <div class="node-ambiguous">
                    ambiguous — {entry.resolution.claimants?.length} claimant(s)
                  </div>
                )}
                {entry.resolution.status === 'resolved' && (
                  <div class="node-resolved">
                    state: {entry.resolution.status}
                    {entry.resolution.outcome && `, outcome: ${entry.resolution.outcome}`}
                  </div>
                )}
                {entry.blockedBy.length > 0 && (
                  <div class="node-blocked">blocked by: {entry.blockedBy.join(', ')}</div>
                )}
              </div>
            );
          })}
          <div class="ready-to-resolve">
            ready to resolve: {selected.plan.readiness.readyToResolve ? 'yes' : 'no'}
          </div>
        </div>
      )}
    </div>
  );
}
