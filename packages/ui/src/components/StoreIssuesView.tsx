import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  StoreExecutionPlanNodeInput,
  StoreIssueDetailResponse,
  StoreIssueState,
  StoreIssueSummary,
  StoreProjectRollupEntry,
  StoreResolvedPlanNode,
  StoreTargetLineRollupEntry,
} from '../api/types.js';
import { PageHeader } from './ui/PageHeader.js';
import { useSpace } from '../store/use-space.js';
import { useT } from '../i18n/store.js';

const ISSUE_STATES: StoreIssueState[] = ['open', 'resolved', 'dropped'];

/** A locally-authored plan node draft, before Publish. Never pre-filled. */
interface DraftNode {
  nodeId: string;
  kind: 'change' | 'intent';
  projectId: string;
  targetLineId: string;
  changeInstanceId: string;
  changeAlias: string;
  summary: string;
}

function emptyDraftNode(): DraftNode {
  return {
    nodeId: '',
    kind: 'change',
    projectId: '',
    targetLineId: '',
    changeInstanceId: '',
    changeAlias: '',
    summary: '',
  };
}

/** A draft node's scope is complete only when BOTH project and target line are explicitly chosen — never inferred. */
function nodeScopeComplete(node: DraftNode): boolean {
  return node.projectId.trim().length > 0 && node.targetLineId.trim().length > 0;
}

/** Every other required field for the node's declared kind, so an incomplete draft cannot be submitted either. */
function nodeContentComplete(node: DraftNode): boolean {
  if (node.nodeId.trim().length === 0) return false;
  if (node.kind === 'change') return node.changeInstanceId.trim().length > 0;
  return node.summary.trim().length > 0;
}

function draftToInput(node: DraftNode): StoreExecutionPlanNodeInput {
  const base = {
    nodeId: node.nodeId,
    kind: node.kind,
    projectId: node.projectId,
    targetLineId: node.targetLineId,
  };
  return node.kind === 'change'
    ? { ...base, changeInstanceId: node.changeInstanceId, changeAlias: node.changeAlias || undefined }
    : { ...base, summary: node.summary };
}

/**
 * The Store-level cross-project Issues view (`store-issue-resources` board-ui
 * spec, requirement "Cross-project Issues are a Store-level view whose nodes
 * reference project changes"). Not nested inside any project's view — it
 * fetches through the Store's own `space` selector like every other call.
 * Selecting an Issue shows its state and its current resolved Execution Plan:
 * every node is rendered regardless of resolution status, and an unresolved /
 * ambiguous / not-created reference is shown as unreadable with the reason,
 * never omitted (`resolution.status` + `resolution.outcome`).
 *
 * Carries the Store-level Issue mutation surface: `create` and `setState`
 * take no project or target line at all (an Issue is Store-level intent), but
 * `publishPlan`'s per-node scope is exactly the case requirement 3 guards
 * ("An aggregate view never submits a mutation with an incomplete scope"): the
 * per-node project/target-line `<select>`s below start on an unselected
 * placeholder and are NEVER defaulted from the fetched project/target-line
 * list — not even when exactly one option exists — and Publish stays disabled
 * until every draft node's scope is explicitly complete.
 */
export function StoreIssuesView() {
  const t = useT();
  const space = useSpace();
  const selector = space?.selector;

  const [issues, setIssues] = useState<StoreIssueSummary[] | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StoreIssueDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [projects, setProjects] = useState<StoreProjectRollupEntry[]>([]);
  const [targetLines, setTargetLines] = useState<StoreTargetLineRollupEntry[]>([]);

  const [newIssueId, setNewIssueId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newReadme, setNewReadme] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [stateValue, setStateValue] = useState<StoreIssueState>('open');
  const [reasonValue, setReasonValue] = useState('');
  const [stateBusy, setStateBusy] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);

  const [planNodes, setPlanNodes] = useState<DraftNode[]>([emptyDraftNode()]);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    client
      .getStoreIssues(selector)
      .then((res) => {
        if (cancelled) return;
        setIssues([...res.issues]);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'store_issues.error.load' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, selector]);

  // The project/target-line catalog populates the plan-node <select> OPTIONS
  // only — never a selected value (requirement 3's "sole candidate is not
  // adopted" case applies even when this list has exactly one entry).
  useEffect(() => {
    let cancelled = false;
    Promise.all([client.getStoreProjects(selector), client.getStoreTargetLines(selector)])
      .then(([projectsRes, targetLinesRes]) => {
        if (cancelled) return;
        setProjects([...projectsRes.projects]);
        setTargetLines([...targetLinesRes.targetLines]);
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setTargetLines([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selector, refreshNonce]);

  function loadDetail(issueId: string) {
    setSelectedIssueId(issueId);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setPlanNodes([emptyDraftNode()]);
    setPlanError(null);
    client
      .getStoreIssue(issueId, selector)
      .then((res) => {
        setDetail(res);
        setStateValue(res.issue.record?.state ?? 'open');
        setReasonValue('');
      })
      .catch((err) => {
        setDetailError(err instanceof ApiError ? err.message : 'store_issues.error.detail_load');
      })
      .finally(() => setDetailLoading(false));
  }

  function refresh() {
    setRefreshNonce((n) => n + 1);
    if (selectedIssueId) loadDetail(selectedIssueId);
  }

  async function submitCreate(e: Event) {
    e.preventDefault();
    setCreateBusy(true);
    setCreateError(null);
    try {
      await client.createStoreIssue({ issueId: newIssueId, title: newTitle, readme: newReadme }, selector);
      setNewIssueId('');
      setNewTitle('');
      setNewReadme(false);
      refresh();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'store_issues.error.create_failed');
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitState(e: Event) {
    e.preventDefault();
    if (!selectedIssueId) return;
    setStateBusy(true);
    setStateError(null);
    try {
      await client.setStoreIssueState(
        { issueId: selectedIssueId, state: stateValue, reason: reasonValue || undefined },
        selector
      );
      refresh();
    } catch (err) {
      setStateError(err instanceof ApiError ? err.message : 'store_issues.error.state_failed');
    } finally {
      setStateBusy(false);
    }
  }

  const planScopeComplete = planNodes.length > 0 && planNodes.every((n) => nodeScopeComplete(n) && nodeContentComplete(n));

  async function submitPlan(e: Event) {
    e.preventDefault();
    if (!selectedIssueId || !planScopeComplete) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      await client.publishStoreExecutionPlan(
        { issueId: selectedIssueId, nodes: planNodes.map(draftToInput) },
        selector
      );
      setPlanNodes([emptyDraftNode()]);
      refresh();
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : 'store_issues.error.plan_failed');
    } finally {
      setPlanBusy(false);
    }
  }

  function updateNode(index: number, patch: Partial<DraftNode>) {
    setPlanNodes((nodes) => nodes.map((n, i) => (i === index ? { ...n, ...patch } : n)));
  }

  function addNode() {
    setPlanNodes((nodes) => [...nodes, emptyDraftNode()]);
  }

  function removeNode(index: number) {
    setPlanNodes((nodes) => nodes.filter((_, i) => i !== index));
  }

  if (loading) {
    return <p class="store-issues__loading">{t('store_issues.loading')}</p>;
  }

  if (pageError) {
    return (
      <div class="store-issues__error" data-testid="store-issues-error">
        <p>
          {t(pageError.message)}
          {pageError.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <button type="button" onClick={refresh}>
          {t('status.retry')}
        </button>
      </div>
    );
  }

  const resolvedNodes: readonly StoreResolvedPlanNode[] = detail?.plan?.readiness.nodes ?? [];

  return (
    <div class="store-issues" data-testid="store-issues-view">
      <PageHeader title={t('store_issues.title')} />

      <form class="store-issues__create-form" data-testid="store-issue-create-form" onSubmit={submitCreate}>
        <h3>{t('store_issues.create_heading')}</h3>
        <label>
          {t('store_issues.field_id')}
          <input
            type="text"
            data-testid="store-issue-create-id"
            value={newIssueId}
            onInput={(e) => setNewIssueId((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          {t('store_issues.field_title')}
          <input
            type="text"
            data-testid="store-issue-create-title"
            value={newTitle}
            onInput={(e) => setNewTitle((e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="store-issue-create-readme"
            checked={newReadme}
            onChange={(e) => setNewReadme((e.target as HTMLInputElement).checked)}
          />
          {t('store_issues.field_readme')}
        </label>
        <button
          type="submit"
          class="btn--primary"
          data-testid="store-issue-create-submit"
          disabled={createBusy || newIssueId.trim().length === 0 || newTitle.trim().length === 0}
        >
          {t('store_issues.create_submit')}
        </button>
        {createError && <p class="store-issues__form-error">{t(createError)}</p>}
      </form>

      {!issues || issues.length === 0 ? (
        <p class="store-issues__empty" data-testid="store-issues-empty">
          {t('store_issues.empty')}
        </p>
      ) : (
        <ul class="store-issues__list" data-testid="store-issues-list">
          {issues.map((issue) => (
            <li key={issue.issueId}>
              <button
                type="button"
                class="store-issues__row"
                data-testid="store-issue-row"
                data-issue={issue.issueId}
                data-selected={selectedIssueId === issue.issueId}
                onClick={() => loadDetail(issue.issueId)}
              >
                <span class="store-issues__row-id">{issue.issueId}</span>
                <span class="store-issues__row-title">{issue.record?.title ?? ''}</span>
                <span class="store-issues__row-state">{issue.record?.state ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selectedIssueId && (
        <div class="store-issues__detail" data-testid="store-issue-detail" data-issue={selectedIssueId}>
          {detailLoading && <p>{t('store_issues.detail_loading')}</p>}
          {detailError && <p class="store-issues__form-error">{t(detailError)}</p>}
          {detail && (
            <>
              <h3 data-testid="store-issue-detail-state">
                {detail.issue.issueId} — {detail.issue.record?.state ?? t('store_issues.state_unknown')}
              </h3>

              <form class="store-issues__state-form" data-testid="store-issue-state-form" onSubmit={submitState}>
                <label>
                  {t('store_issues.field_state')}
                  <select
                    data-testid="store-issue-state-select"
                    value={stateValue}
                    onChange={(e) => setStateValue((e.target as HTMLSelectElement).value as StoreIssueState)}
                  >
                    {ISSUE_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('store_issues.field_reason')}
                  <textarea
                    data-testid="store-issue-state-reason"
                    value={reasonValue}
                    onInput={(e) => setReasonValue((e.target as HTMLTextAreaElement).value)}
                  />
                </label>
                <button type="submit" data-testid="store-issue-state-submit" disabled={stateBusy}>
                  {t('store_issues.state_submit')}
                </button>
                {stateError && <p class="store-issues__form-error">{t(stateError)}</p>}
              </form>

              <h4>{t('store_issues.plan_heading')}</h4>
              {resolvedNodes.length === 0 ? (
                <p data-testid="store-issue-plan-empty">{t('store_issues.plan_empty')}</p>
              ) : (
                <ul class="store-issues__plan-nodes" data-testid="store-issue-plan-nodes">
                  {resolvedNodes.map((resolved, i) => {
                    const readable = resolved.resolution.status === 'resolved';
                    const owningProject =
                      resolved.resolution.claimants.find((c) => c.projectId === resolved.node.projectId)
                        ?.projectId ?? resolved.node.projectId;
                    return (
                      <li
                        key={`${resolved.node.nodeId}-${i}`}
                        class="store-issues__plan-node"
                        data-testid="store-issue-plan-node"
                        data-node={resolved.node.nodeId}
                        data-status={resolved.resolution.status}
                        data-readable={readable}
                      >
                        <span class="store-issues__plan-node-label">
                          {resolved.node.kind === 'change'
                            ? resolved.node.changeAlias ?? resolved.node.changeInstanceId
                            : resolved.node.summary}
                        </span>
                        <span class="store-issues__plan-node-project" data-testid="store-issue-plan-node-project">
                          {owningProject} / {resolved.node.targetLineId}
                        </span>
                        {!readable && (
                          <span
                            class="store-issues__plan-node-unreadable"
                            data-testid="store-issue-plan-node-unreadable"
                          >
                            {t('store_issues.plan_node_unreadable', { status: resolved.resolution.status })}
                            {resolved.resolution.outcome ? ` (${resolved.resolution.outcome})` : ''}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <h4>{t('store_issues.publish_heading')}</h4>
              <form class="store-issues__plan-form" data-testid="store-issue-plan-form" onSubmit={submitPlan}>
                {planNodes.map((node, i) => (
                  <fieldset key={i} class="store-issues__plan-draft-node" data-testid="store-plan-draft-node">
                    <select
                      data-testid={`store-plan-node-${i}-kind`}
                      value={node.kind}
                      onChange={(e) => updateNode(i, { kind: (e.target as HTMLSelectElement).value as 'change' | 'intent' })}
                    >
                      <option value="change">{t('store_issues.node_kind_change')}</option>
                      <option value="intent">{t('store_issues.node_kind_intent')}</option>
                    </select>
                    <input
                      type="text"
                      placeholder={t('store_issues.field_node_id')}
                      data-testid={`store-plan-node-${i}-id`}
                      value={node.nodeId}
                      onInput={(e) => updateNode(i, { nodeId: (e.target as HTMLInputElement).value })}
                    />
                    {/* Scope selects: NEVER pre-selected, even with exactly one option (board-ui
                        requirement 3, "A sole visible candidate is not adopted as scope"). */}
                    <select
                      data-testid={`store-plan-node-${i}-project`}
                      value={node.projectId}
                      onChange={(e) => updateNode(i, { projectId: (e.target as HTMLSelectElement).value })}
                    >
                      <option value="">{t('store_issues.select_project_placeholder')}</option>
                      {projects.map((p) => (
                        <option key={p.projectId} value={p.projectId}>
                          {p.projectId}
                        </option>
                      ))}
                    </select>
                    <select
                      data-testid={`store-plan-node-${i}-target-line`}
                      value={node.targetLineId}
                      onChange={(e) => updateNode(i, { targetLineId: (e.target as HTMLSelectElement).value })}
                    >
                      <option value="">{t('store_issues.select_target_line_placeholder')}</option>
                      {targetLines.map((tl) => (
                        <option key={tl.targetLineId} value={tl.targetLineId}>
                          {tl.targetLineId}
                        </option>
                      ))}
                    </select>
                    {node.kind === 'change' ? (
                      <input
                        type="text"
                        placeholder={t('store_issues.field_change_instance_id')}
                        data-testid={`store-plan-node-${i}-change-instance-id`}
                        value={node.changeInstanceId}
                        onInput={(e) => updateNode(i, { changeInstanceId: (e.target as HTMLInputElement).value })}
                      />
                    ) : (
                      <input
                        type="text"
                        placeholder={t('store_issues.field_summary')}
                        data-testid={`store-plan-node-${i}-summary`}
                        value={node.summary}
                        onInput={(e) => updateNode(i, { summary: (e.target as HTMLInputElement).value })}
                      />
                    )}
                    <button
                      type="button"
                      data-testid={`store-plan-remove-node-${i}`}
                      onClick={() => removeNode(i)}
                      disabled={planNodes.length <= 1}
                    >
                      {t('store_issues.remove_node')}
                    </button>
                  </fieldset>
                ))}
                <button type="button" data-testid="store-plan-add-node" onClick={addNode}>
                  {t('store_issues.add_node')}
                </button>
                <button
                  type="submit"
                  class="btn--primary"
                  data-testid="store-plan-submit"
                  disabled={planBusy || !planScopeComplete}
                >
                  {t('store_issues.publish_submit')}
                </button>
                {planError && <p class="store-issues__form-error">{t(planError)}</p>}
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
