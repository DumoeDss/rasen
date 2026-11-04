import { useEffect, useRef, useState } from 'preact/hooks';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  StoreChangeIssueLinkEntry,
  StoreExecutionPlanNode,
  StoreExecutionPlanNodeInput,
  StoreIssueIdentity,
  StoreIssueProjectionEntry,
  StoreIssueProjectionResponse,
} from '../api/types.js';
import { useT } from '../i18n/store.js';

export type LinkDialogMode = 'attach' | 'create';

const CANONICAL_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isCanonicalLinkId(value: string): boolean {
  return CANONICAL_ID.test(value);
}

/** Explicit field-by-field copy: adding a plan field requires touching this list. */
export function copyPlanNode(node: StoreExecutionPlanNode): StoreExecutionPlanNodeInput {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    projectId: node.projectId,
    targetLineId: node.targetLineId,
    dependsOn: [...node.dependsOn],
    ...(node.kind === 'change'
      ? {
          changeInstanceId: node.changeInstanceId,
          ...(node.changeAlias === undefined ? {} : { changeAlias: node.changeAlias }),
        }
      : { summary: node.summary }),
    ...(node.lifecycle === undefined ? {} : { lifecycle: node.lifecycle }),
    ...(node.reason === undefined ? {} : { reason: node.reason }),
    ...(node.suggestedPipeline === undefined ? {} : { suggestedPipeline: node.suggestedPipeline }),
    ...(node.rationale === undefined ? {} : { rationale: node.rationale }),
    ...(node.uncertainty === undefined ? {} : { uncertainty: node.uncertainty }),
  };
}

export function suggestNodeId(changeId: string, existing: readonly StoreExecutionPlanNode[]): string {
  const used = new Set(existing.map(node => node.nodeId));
  if (!used.has(changeId)) return changeId;
  let suffix = 2;
  while (used.has(`${changeId}-${suffix}`)) suffix += 1;
  return `${changeId}-${suffix}`;
}

function exactChangeNode(
  entry: StoreChangeIssueLinkEntry,
  nodeId: string
): StoreExecutionPlanNodeInput {
  const change = entry.occurrence.change;
  return {
    nodeId,
    kind: 'change',
    projectId: change.projectId,
    targetLineId: change.targetLineId,
    changeInstanceId: change.changeInstanceId ?? undefined,
    changeAlias: change.changeId,
    dependsOn: [],
  };
}

function readableBase(detail: StoreIssueProjectionResponse | null): {
  revisionId: string | null;
  nodes: readonly StoreExecutionPlanNode[];
} | null {
  if (detail === null) return null;
  if (detail.issue.record?.state !== 'open') return null;
  if (detail.issue.latestRevisionId === null) return { revisionId: null, nodes: [] };
  if (detail.plan?.revision === null || detail.plan?.revision === undefined) return null;
  return { revisionId: detail.plan.revisionId, nodes: detail.plan.revision.nodes };
}

function canonicalIssueSelector(issue: StoreIssueProjectionEntry): string | null {
  return issue.identity?.uid ?? null;
}

function issueOptionLabel(issue: StoreIssueProjectionEntry): string {
  return `${issue.identity?.key ?? issue.issueId} — ${issue.record?.title ?? ''}`;
}

type CreateRecoveryOutcome = {
  kind: 'created-plan-failed' | 'publication-indeterminate';
  identity: Pick<StoreIssueIdentity, 'uid' | 'key'>;
  message: string;
};

export function LinkChangeDialog({
  entry,
  issues,
  selector,
  initialMode,
  onClose,
  onRefresh,
}: {
  entry: StoreChangeIssueLinkEntry;
  issues: readonly StoreIssueProjectionEntry[];
  selector?: string;
  initialMode: LinkDialogMode;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  const t = useT();
  const owner = useRef({ entry, selector, initialMode }).current;
  const liveScope = useRef({ entry, selector, initialMode });
  const active = useRef(true);
  liveScope.current = { entry, selector, initialMode };
  const change = owner.entry.occurrence.change;
  const [mode, setMode] = useState<LinkDialogMode>(owner.initialMode);
  const [issueId, setIssueId] = useState(
    owner.initialMode === 'attach'
      ? issues.map(canonicalIssueSelector).find(value => value !== null) ?? ''
      : ''
  );
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState<StoreIssueProjectionResponse | null>(null);
  const [nodeId, setNodeId] = useState(change.changeId);
  const [confirming, setConfirming] = useState(false);
  const [loadingIssue, setLoadingIssue] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createInFlightRef = useRef(false);
  const createLockedRef = useRef(false);
  const [createLocked, setCreateLocked] = useState(false);
  const [createOutcome, setCreateOutcome] = useState<CreateRecoveryOutcome | null>(null);

  useEffect(() => () => {
    active.current = false;
  }, []);

  function ownsScope(): boolean {
    return active.current &&
      liveScope.current.selector === owner.selector &&
      liveScope.current.entry === owner.entry &&
      liveScope.current.initialMode === owner.initialMode;
  }

  async function loadIssue(target = issueId, preserveError = false): Promise<void> {
    if (!target || !ownsScope()) return;
    setLoadingIssue(true);
    if (!preserveError) setError(null);
    try {
      const next = await client.getStoreIssueProjection(target, owner.selector);
      if (!ownsScope()) return;
      const base = readableBase(next);
      if (base === null) {
        setDetail(null);
        setError(t('unlinked.dialog.issue_unreadable'));
        return;
      }
      setDetail(next);
      setNodeId(suggestNodeId(change.changeId, base.nodes));
    } catch (caught) {
      if (!ownsScope()) return;
      setDetail(null);
      setError(caught instanceof ApiError ? caught.message : t('unlinked.dialog.issue_load_error'));
    } finally {
      if (ownsScope()) setLoadingIssue(false);
    }
  }

  function currentNodes(): readonly StoreExecutionPlanNode[] {
    return readableBase(detail)?.nodes ?? [];
  }

  const duplicateNode = currentNodes().some(node => node.nodeId === nodeId);
  const validNode = isCanonicalLinkId(nodeId) && !duplicateNode;
  const validCreate = !createLocked && title.trim().length > 0 && validNode;
  const validAttach = detail !== null && detail.issue.identity !== null && validNode;

  async function stillAttachable(): Promise<boolean> {
    if (!ownsScope()) return false;
    const fresh = await client.getStoreChangeIssueLinks(owner.selector);
    if (!ownsScope()) return false;
    const candidate = fresh.entries.find(value =>
      value.occurrence.change.changeInstanceId === change.changeInstanceId &&
      value.occurrence.change.projectId === change.projectId &&
      value.occurrence.change.targetLineId === change.targetLineId &&
      value.occurrence.change.changeId === change.changeId
    );
    return candidate?.association === 'unlinked' && candidate.eligibility === 'attachable';
  }

  async function confirmAttach(): Promise<void> {
    if (!detail || detail.issue.identity === null || !validAttach || !ownsScope()) return;
    const detailSnapshot = detail;
    const issueUidSnapshot = detail.issue.identity.uid;
    const nodeIdSnapshot = nodeId;
    setSubmitting(true);
    setError(null);
    try {
      if (!(await stillAttachable())) {
        if (!ownsScope()) return;
        setError(t('unlinked.dialog.change_no_longer_unlinked'));
        setConfirming(false);
        await onRefresh();
        return;
      }
      if (!ownsScope()) return;
      const base = readableBase(detailSnapshot);
      if (base === null) {
        setError(t('unlinked.dialog.issue_unreadable'));
        setConfirming(false);
        return;
      }
      await client.publishStoreExecutionPlan({
        issueId: issueUidSnapshot,
        expectedRevisionId: base.revisionId,
        nodes: [...base.nodes.map(copyPlanNode), exactChangeNode(owner.entry, nodeIdSnapshot)],
      }, owner.selector);
      if (!ownsScope()) return;
      await onRefresh();
      if (!ownsScope()) return;
      onClose();
    } catch (caught) {
      if (!ownsScope()) return;
      if (caught instanceof ApiError && caught.code === 'execution_plan_revision_conflict') {
        setError(t('unlinked.dialog.revision_conflict'));
        setConfirming(false);
        await onRefresh();
        if (ownsScope()) await loadIssue(issueUidSnapshot, true);
      } else {
        setError(caught instanceof ApiError ? caught.message : t('unlinked.dialog.attach_error'));
      }
    } finally {
      if (ownsScope()) setSubmitting(false);
    }
  }

  async function confirmCreate(): Promise<void> {
    if (
      !validCreate ||
      createInFlightRef.current ||
      createLockedRef.current ||
      !ownsScope()
    ) return;
    createInFlightRef.current = true;
    const titleSnapshot = title.trim();
    const nodeIdSnapshot = nodeId;
    setSubmitting(true);
    setError(null);
    try {
      if (!(await stillAttachable())) {
        if (!ownsScope()) return;
        setError(t('unlinked.dialog.change_no_longer_unlinked'));
        setConfirming(false);
        await onRefresh();
        return;
      }
      if (!ownsScope()) return;
      const created = await client.createStoreIssue({ title: titleSnapshot }, owner.selector);
      if (!ownsScope()) return;
      createLockedRef.current = true;
      setCreateLocked(true);
      try {
        await client.publishStoreExecutionPlan({
          issueId: created.identity.uid,
          expectedRevisionId: null,
          nodes: [exactChangeNode(owner.entry, nodeIdSnapshot)],
        }, owner.selector);
        if (!ownsScope()) return;
      } catch (caught) {
        if (!ownsScope()) return;
        const message = caught instanceof ApiError ? caught.message : t('unlinked.dialog.plan_error');
        setCreateOutcome({
          kind: 'created-plan-failed',
          identity: created.identity,
          message,
        });
        setConfirming(false);
        await onRefresh();
        return;
      }
      await onRefresh();
      if (!ownsScope()) return;
      onClose();
    } catch (caught) {
      if (!ownsScope()) return;
      if (caught instanceof ApiError && caught.code === 'issue_publication_indeterminate') {
        createLockedRef.current = true;
        setCreateLocked(true);
        setConfirming(false);
        const recovery = caught.recovery;
        if (
          recovery?.kind === 'issue-publication-indeterminate' &&
          recovery.retrySafe === false &&
          typeof recovery.identity?.uid === 'string' &&
          typeof recovery.identity.key === 'string'
        ) {
          setCreateOutcome({
            kind: 'publication-indeterminate',
            identity: recovery.identity,
            message: caught.message,
          });
          setError(null);
        } else {
          setError(caught.message);
        }
        await onRefresh();
      } else {
        setError(caught instanceof ApiError ? caught.message : t('unlinked.dialog.create_error'));
      }
    } finally {
      if (ownsScope()) {
        createInFlightRef.current = false;
        setSubmitting(false);
      }
    }
  }

  async function recoverCreateOutcome(): Promise<void> {
    if (!createOutcome || !ownsScope()) return;
    const outcome = createOutcome;
    setMode('attach');
    setIssueId(outcome.identity.uid);
    if (outcome.kind === 'created-plan-failed') setCreateOutcome(null);
    setConfirming(false);
    await loadIssue(outcome.identity.uid);
  }

  // If a caller ever reuses this component without a key, fail closed during
  // render. Reads and writes continue to use only the immutable owner snapshot.
  if (!ownsScope()) return null;

  return (
    <div class="link-change-dialog__backdrop" role="presentation">
      <section class="link-change-dialog" role="dialog" aria-modal="true" aria-label={t('unlinked.dialog.title')}>
        <header>
          <h2>{t('unlinked.dialog.title')}</h2>
          <button type="button" onClick={onClose}>{t('unlinked.dialog.close')}</button>
        </header>
        <dl class="link-change-dialog__scope">
          <div><dt>{t('unlinked.change')}</dt><dd>{change.changeId}</dd></div>
          <div><dt>{t('unlinked.instance')}</dt><dd><code>{change.changeInstanceId}</code></dd></div>
          <div><dt>{t('unlinked.project')}</dt><dd>{change.projectId}</dd></div>
          <div><dt>{t('unlinked.target_line')}</dt><dd>{change.targetLineId}</dd></div>
        </dl>

        <div class="link-change-dialog__modes">
          <button type="button" aria-pressed={mode === 'attach'} onClick={() => { setMode('attach'); setIssueId(issues.map(canonicalIssueSelector).find(value => value !== null) ?? ''); setDetail(null); setConfirming(false); }}>{t('unlinked.attach')}</button>
          <button type="button" aria-pressed={mode === 'create'} disabled={createLocked} onClick={() => { setMode('create'); setIssueId(''); setTitle(''); setDetail(null); setConfirming(false); }}>{t('unlinked.create')}</button>
        </div>

        {mode === 'attach' ? (
          <div class="link-change-dialog__form">
            <label>
              {t('unlinked.dialog.issue')}
              <select value={issueId} onChange={event => { setIssueId((event.target as HTMLSelectElement).value); setDetail(null); setConfirming(false); }}>
                <option value="">{t('unlinked.dialog.choose_issue')}</option>
                {issueId && !issues.some(issue => canonicalIssueSelector(issue) === issueId) && (
                  <option value={issueId}>{issueId}</option>
                )}
                {issues.filter(issue => issue.identity !== null).map(issue => (
                  <option key={issue.identity!.uid} value={issue.identity!.uid}>{issueOptionLabel(issue)}</option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!issueId || loadingIssue} onClick={() => void loadIssue()}>
              {loadingIssue ? t('unlinked.dialog.loading_issue') : t('unlinked.dialog.load_issue')}
            </button>
          </div>
        ) : (
          <div class="link-change-dialog__form">
            <label>{t('unlinked.dialog.issue_title')}<input value={title} onInput={event => { setTitle((event.target as HTMLInputElement).value); setConfirming(false); }} /></label>
          </div>
        )}

        <label class="link-change-dialog__node">
          {t('unlinked.dialog.node_id')}
          <input value={nodeId} onInput={event => { setNodeId((event.target as HTMLInputElement).value); setConfirming(false); }} />
        </label>
        {!isCanonicalLinkId(nodeId) && <p role="alert">{t('unlinked.dialog.node_invalid')}</p>}
        {duplicateNode && <p role="alert">{t('unlinked.dialog.node_duplicate')}</p>}

        {createOutcome?.kind === 'created-plan-failed' && (
          <div class="link-change-dialog__partial" role="alert" data-testid="unlinked-partial-outcome">
            <p>{t('unlinked.dialog.partial', { issue: createOutcome.identity.key, error: createOutcome.message })}</p>
            <button type="button" onClick={() => void recoverCreateOutcome()}>{t('unlinked.dialog.recover_attach')}</button>
          </div>
        )}

        {createOutcome?.kind === 'publication-indeterminate' && (
          <div class="link-change-dialog__partial" role="alert" data-testid="unlinked-indeterminate-outcome">
            <p>{t('unlinked.dialog.indeterminate', {
              issue: createOutcome.identity.key,
              uid: createOutcome.identity.uid,
              error: createOutcome.message,
            })}</p>
            <button type="button" onClick={() => void recoverCreateOutcome()}>{t('unlinked.dialog.recover_indeterminate')}</button>
          </div>
        )}

        {error && <p class="link-change-dialog__error" role="alert">{error}</p>}

        {confirming ? (
          <div class="link-change-dialog__confirmation" data-testid="unlinked-confirmation">
            <p>{t('unlinked.dialog.confirm_scope', {
              issue: mode === 'attach'
                ? (detail?.issue.identity?.key ?? issueId)
                : title.trim(),
              revision: mode === 'attach' ? (readableBase(detail)?.revisionId ?? t('unlinked.dialog.no_plan')) : t('unlinked.dialog.no_plan'),
              node: nodeId,
              preserved: mode === 'attach' ? currentNodes().length : 0,
            })}</p>
            <button type="button" disabled={submitting} onClick={() => void (mode === 'attach' ? confirmAttach() : confirmCreate())}>
              {submitting ? t('unlinked.dialog.submitting') : t('unlinked.dialog.confirm')}
            </button>
            <button type="button" disabled={submitting} onClick={() => setConfirming(false)}>{t('unlinked.dialog.back')}</button>
          </div>
        ) : (
          <button
            type="button"
            disabled={mode === 'attach' ? !validAttach : !validCreate}
            onClick={() => setConfirming(true)}
          >
            {t('unlinked.dialog.preview')}
          </button>
        )}
      </section>
    </div>
  );
}
