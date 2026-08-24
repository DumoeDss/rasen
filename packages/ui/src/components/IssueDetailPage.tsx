import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  StoreIssueAttentionResponse,
  StoreIssueAcceptanceGateEvaluation,
  StoreExecutionPlanNode,
  StoreIssueNodeDelivery,
  StoreIssueNodeStatus,
  StoreIssueProjectionResponse,
} from '../api/types.js';
import { PageHeader } from './ui/PageHeader.js';
import { spaceHref, useSpace, type Space } from '../store/use-space.js';
import { useT } from '../i18n/store.js';
import {
  ISSUE_ATTENTION_KIND_LABEL_KEYS,
  ISSUE_DELIVERY_STATE_LABEL_KEYS,
  ISSUE_DETERMINATION_LABEL_KEYS,
  ISSUE_HEALTH_LABEL_KEYS,
  ISSUE_LIFECYCLE_LABEL_KEYS,
  ISSUE_OBSERVATION_LABEL_KEYS,
  ISSUE_PHASE_LABEL_KEYS,
  ISSUE_PROBLEM_KIND_LABEL_KEYS,
  ISSUE_THREAD_KIND_LABEL_KEYS,
  attentionItemDetail,
  issueBlockerLabel,
} from './issue-vocabulary.js';
import {
  buildIssueProvenance,
  ISSUE_PROVENANCE,
  issueAttentionProvenanceFamily,
  issueHealthProvenanceFamily,
  issuePhaseProvenanceFamily,
} from './issue-provenance.js';

/**
 * The Issue Detail (issue-board-ui spec / roadmap §9.2): one Issue's whole
 * projection read, presented section by section.
 *
 * Every displayed fact comes verbatim from a field of the single-Issue
 * projection payload or the narrowed attention payload. The page derives
 * nothing: no axis, no count, no determination, no blocker state. Where the
 * payload reports a problem it is presented BESIDE what did derive, never
 * instead of it — an Issue with an unreadable plan still renders its read.
 */

/** Every material fact carried by one node's delivery variant. */
function DeliveryFacts({ delivery }: { delivery: StoreIssueNodeDelivery }) {
  const t = useT();
  if (delivery.state === 'record') {
    return (
      <div class="issue-detail__delivery-facts" data-testid="issue-detail-record-delivery-facts">
        <span>
          {t('issues.delivery.record_facts', {
            basis: delivery.basis,
            archivedAt: delivery.archivedAt ?? '-',
            outcome: delivery.outcome ?? '-',
            commit: delivery.codeCommit ?? '-',
            branch: delivery.planningBranch ?? '-',
          })}
        </span>
        <span data-testid="issue-detail-delivery-location">
          {t('issues.delivery.location', {
            entry: delivery.entryName,
            ref: delivery.foundAtRef,
            path: delivery.blobPath,
          })}
        </span>
        <span data-testid="issue-detail-delivery-evidence">
          {t('issues.delivery.evidence', {
            evidence:
              delivery.evidence === null
                ? '-'
                : delivery.evidence.map((entry) => `${entry.path} (${entry.sha256})`).join(', ') || '-',
          })}
        </span>
        <span data-testid="issue-detail-delivery-missing">
          {t('issues.delivery.missing', {
            missing: delivery.missing === null ? '-' : delivery.missing.join(', ') || '-',
          })}
        </span>
      </div>
    );
  }
  if (delivery.state === 'no-record') {
    return (
      <span class="issue-detail__delivery-facts" data-testid="issue-detail-no-record-delivery-facts">
        {t('issues.delivery.no_record_facts', {
          ref: delivery.foundAtRef ?? '-',
          path: delivery.blobPath ?? '-',
        })}
      </span>
    );
  }
  return null;
}

function acceptanceGateFacts(
  gate: StoreIssueAcceptanceGateEvaluation,
  t: (key: string, vars?: Record<string, string | number>) => string
): string {
  const exclusions = gate.exclusions
    .map((entry) => `${entry.nodeId}:${entry.lifecycle}:${entry.reason}`)
    .join(', ') || '-';
  const optional = gate.optionalNodes.join(', ') || '-';
  if (gate.eligible) {
    return t('issues.detail.attention_gate', {
      eligible: 'true',
      revision: gate.conditionsRevisionId,
      snapshot: `${gate.snapshot.completed}/${gate.snapshot.total}:${gate.snapshot.health}:${gate.snapshot.problemsStanding}`,
      refusal: '-',
      blockers: '-',
      exclusions,
      optional,
    });
  }
  const blockers = gate.blockers.map((blocker) => {
    if (blocker.kind === 'un-terminal-node') return `${blocker.nodeId}:${blocker.observation}`;
    if (blocker.kind === 'failing-node') return blocker.nodeId;
    if (blocker.kind === 'status-problem') {
      return `${blocker.problemKind}:${blocker.node ?? '-'}:${blocker.ref ?? '-'}:${blocker.reason}`;
    }
    return blocker.reason;
  }).join(', ') || '-';
  return t('issues.detail.attention_gate', {
    eligible: 'false',
    revision: '-',
    snapshot: '-',
    refusal: `${gate.refusalCode}: ${gate.message}`,
    blockers,
    exclusions,
    optional,
  });
}

function NodeRow({ node, planNode }: { node: StoreIssueNodeStatus; planNode?: StoreExecutionPlanNode }) {
  const t = useT();
  return (
    <li class="issue-detail__node" data-testid="issue-detail-node" data-node={node.nodeId}>
      <span class="issue-detail__node-id">{node.nodeId}</span>
      <span class="issue-detail__node-kind">
        {node.kind === 'change' ? t('issues.node.kind_change') : t('issues.node.kind_intent')}
      </span>
      <span class="issue-detail__node-lifecycle" data-testid="issue-detail-node-lifecycle">
        {t(ISSUE_LIFECYCLE_LABEL_KEYS[node.lifecycle])}
        {node.reason !== null ? ` — ${node.reason}` : ''}
      </span>
      <span class="issue-detail__node-observation" data-testid="issue-detail-node-observation">
        {t(ISSUE_OBSERVATION_LABEL_KEYS[node.observation])}
      </span>
      <span class="issue-detail__node-target" data-testid="issue-detail-node-target">
        {t('issues.node.target', { project: node.projectId, line: node.targetLineId })}
      </span>
      {node.alias !== null && <span class="issue-detail__node-alias">{node.alias}</span>}
      {planNode !== undefined && (
        <span class="issue-detail__node-plan-facts" data-testid="issue-detail-node-plan-facts">
          {t('issues.node.plan_facts', {
            dependencies: planNode.dependsOn.join(', ') || '-',
            instance: planNode.changeInstanceId ?? '-',
            changeAlias: planNode.changeAlias ?? '-',
            summary: planNode.summary ?? '-',
          })}
        </span>
      )}
      {node.suggestedPipeline !== null && (
        <span class="issue-detail__node-suggestion" data-testid="issue-detail-node-suggestion">
          {t('issues.node.suggested_pipeline', { pipeline: node.suggestedPipeline })}
        </span>
      )}
      {node.rationale !== null && (
        <span class="issue-detail__node-rationale">
          {t('issues.node.rationale', { rationale: node.rationale })}
        </span>
      )}
      {node.uncertainty !== null && (
        <span class="issue-detail__node-uncertainty">
          {t('issues.node.uncertainty', { uncertainty: node.uncertainty })}
        </span>
      )}
      {node.diagnostic !== null && (
        <span class="issue-detail__node-diagnostic" data-testid="issue-detail-node-diagnostic">
          {node.diagnostic}
        </span>
      )}
    </li>
  );
}

function ProvenanceMap({
  projection,
  attention,
}: {
  projection: StoreIssueProjectionResponse;
  attention: StoreIssueAttentionResponse | null;
}) {
  const t = useT();
  const entries = buildIssueProvenance(projection, attention);
  return (
    <section class="issue-detail__provenance" data-testid="issue-provenance-map" aria-label={t('issues.provenance.title')}>
      <h3>{t('issues.provenance.title')}</h3>
      <div class="issue-detail__provenance-grid">
        {entries.map((entry) => (
          <article
            class="issue-detail__provenance-entry"
            id={entry.anchor}
            key={entry.family}
            data-testid="issue-provenance-entry"
            data-provenance-family={entry.family}
            data-provenance-kind={entry.kind}
            tabIndex={-1}
          >
            <h4>{t(entry.labelKey)}</h4>
            <span class={`issue-detail__provenance-kind issue-detail__provenance-kind--${entry.kind}`}>
              {t(`issues.provenance.kind.${entry.kind}`)}
            </span>
            <dl class="issue-detail__provenance-facts">
              {entry.facts.map((fact, index) => (
                <div key={`${fact.label}-${index}`} data-testid="issue-provenance-fact">
                  <dt>{fact.label}</dt>
                  <dd>{fact.label === 'diagnostic' && fact.value === 'unavailable' ? t('issues.provenance.unavailable') : fact.value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function IssueDetailPage() {
  const space = useSpace();
  const { params } = useRoute();
  const issueId = params.issueId;
  const selector = space?.selector;
  return (
    <IssueDetailState
      key={`${selector ?? 'no-store'}\0${issueId}`}
      space={space}
      selector={selector}
      issueId={issueId}
    />
  );
}

/** Store+Issue-owned state: changing either route parameter remounts before paint. */
function IssueDetailState({
  space,
  selector,
  issueId,
}: {
  space: Space | null;
  selector: string | undefined;
  issueId: string;
}) {
  const t = useT();
  const [projection, setProjection] = useState<StoreIssueProjectionResponse | null>(null);
  const [attention, setAttention] = useState<StoreIssueAttentionResponse | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    Promise.all([
      client.getStoreIssueProjection(issueId, selector),
      client.getStoreIssueAttention(selector, issueId),
    ])
      .then(([projectionRes, attentionRes]) => {
        if (cancelled) return;
        setProjection(projectionRes);
        setAttention(attentionRes);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'issues.error.load_detail' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selector, issueId, refreshNonce]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p class="issue-detail__loading">{t('issues.detail_loading')}</p>;
  }

  if (pageError || projection === null) {
    return (
      <div class="issue-detail__error" data-testid="issue-detail-error">
        <p>
          {t(pageError?.message ?? 'issues.error.load_detail')}
          {pageError?.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <button type="button" onClick={refresh}>
          {t('status.retry')}
        </button>
      </div>
    );
  }

  const { issue, plan, status, delivery, review } = projection;
  const nodeById = new Map(status.nodes.map((node) => [node.nodeId, node]));
  const planNodeById = new Map((plan?.revision?.nodes ?? []).map((node) => [node.nodeId, node]));
  const blockedNodes = status.nodes.filter((node) => node.blockedBy.length > 0);
  const attentionItems = attention?.items ?? [];
  const unsearchedRefs = new Map<string, { targetLineId: string; storeRef: string; reason: string }>();
  for (const ref of [...projection.unsearchedRefs, ...(attention?.unsearchedRefs ?? [])]) {
    unsearchedRefs.set(`${ref.targetLineId}\0${ref.storeRef}\0${ref.reason}`, ref);
  }

  return (
    <div class="issue-detail" data-testid="issue-detail">
      <PageHeader
        title={issue.record?.title ?? issue.issueId}
        actions={
          <>
            <a class="btn--ghost" href={space ? spaceHref(space, 'issues') : '/'}>
              {t('issues.back_to_board')}
            </a>
            <a
              class="btn--ghost"
              data-testid="issue-action-operations"
              href={space ? spaceHref(space, 'operations') : '/'}
            >
              {t('issues.actions.operations')}
            </a>
            <a
              class="btn--ghost"
              data-testid="issue-action-unlinked"
              href={space ? spaceHref(space, 'unlinked-changes') : '/'}
            >
              {t('issues.actions.unlinked')}
            </a>
            <button type="button" class="btn--ghost" data-testid="issue-detail-refresh" onClick={refresh}>
              {t('issues.refresh')}
            </button>
          </>
        }
      />

      {/* The three axes, side by side and separately labelled — never blended. */}
      <section class="issue-detail__axes" data-testid="issue-detail-axes">
        <span class="issue-detail__id">{issue.issueId}</span>
        <a href={`#${ISSUE_PROVENANCE['issue-record'].anchor}`} data-testid="issue-detail-state">
          {t('issues.detail.state', { state: issue.record?.state ?? t('issues.state_unknown') })}
        </a>
        <a
          href={`#${ISSUE_PROVENANCE[issuePhaseProvenanceFamily(status.phase)].anchor}`}
          data-testid="issue-detail-phase"
        >
          {t(ISSUE_PHASE_LABEL_KEYS[status.phase])}
        </a>
        <a
          href={`#${ISSUE_PROVENANCE[issueHealthProvenanceFamily(status.phase, status.health)].anchor}`}
          data-testid="issue-detail-health"
        >
          {t(ISSUE_HEALTH_LABEL_KEYS[status.health])}
        </a>
        <a href={`#${ISSUE_PROVENANCE['plan-projection'].anchor}`} data-testid="issue-detail-progress">
          {status.progress === null
            ? t('issues.progress_none')
            : t('issues.progress', {
                completed: status.progress.completed,
                total: status.progress.total,
              })}
        </a>
        <a href={`#${ISSUE_PROVENANCE.runtime.anchor}`} data-testid="issue-detail-run-state">
          {status.runStateVisibility.kind === 'execution-root'
            ? t('issues.notice.run_state', { root: status.runStateVisibility.executionRoot })
            : t('issues.notice.run_state_none')}
        </a>
      </section>

      {/* Problems and incompleteness, beside the read rather than instead of it. */}
      {(status.problems.length > 0 ||
         projection.problems.length > 0 ||
        unsearchedRefs.size > 0 ||
        !status.complete ||
        !projection.complete ||
        attention?.complete === false ||
        issue.diagnostic !== null ||
        issue.divergence !== null) && (
        <ul class="issue-detail__problems" data-testid="issue-detail-problems">
          {(!projection.complete || !status.complete || attention?.complete === false) && (
            <li data-testid="issue-detail-incomplete">{t('issues.notice.incomplete')}</li>
          )}
          {issue.diagnostic !== null && (
            <li data-testid="issue-detail-unreadable-record">
              {t('issues.card.unreadable_record', { reason: issue.diagnostic })}
            </li>
          )}
          {issue.divergence !== null && (
            <li data-testid="issue-detail-divergent">
              {t('issues.card.divergent', { count: issue.divergence.copies.length })}
            </li>
          )}
          {status.problems.map((problem, index) => (
            <li key={`status-${index}`} data-testid="issue-detail-status-problem">
              {t(ISSUE_PROBLEM_KIND_LABEL_KEYS[problem.kind])}
              {problem.node !== null ? ` ${problem.node}` : ''}
              {problem.ref !== null ? ` ${problem.ref}` : ''}: {problem.reason}
            </li>
          ))}
          {projection.problems.map((problem, index) => (
            <li key={`aggregate-${index}`} data-testid="issue-detail-aggregate-problem">
              {t('issues.notice.problem', { item: problem.itemId, reason: problem.reason })}
            </li>
          ))}
          {[...unsearchedRefs.values()].map((ref) => (
            <li key={`${ref.targetLineId}-${ref.storeRef}-${ref.reason}`} data-testid="issue-detail-unsearched">
              {t('issues.notice.unsearched_ref', {
                line: ref.targetLineId,
                ref: ref.storeRef,
                reason: ref.reason,
              })}
            </li>
          ))}
        </ul>
      )}

      <ProvenanceMap projection={projection} attention={attention} />

      {/* 1. Background and acceptance. */}
      <section class="issue-detail__section" id="issue-section-record" data-testid="issue-detail-background">
        <h3>{t('issues.detail.background')}</h3>
        {issue.record === null ? (
          <p>{t('issues.card.no_record')}</p>
        ) : (
          <dl class="issue-detail__facts">
            <dt>{t('issues.detail.record')}</dt>
            <dd data-testid="issue-detail-record-identity">
              {t('issues.detail.record_identity', {
                version: issue.record.version,
                id: issue.record.id,
                title: issue.record.title,
                state: issue.record.state,
              })}
            </dd>
            <dt>{t('issues.detail.created_at')}</dt>
            <dd>{issue.record.createdAt}</dd>
            {issue.record.reason !== null && (
              <>
                <dt>{t('issues.detail.reason')}</dt>
                <dd>{issue.record.reason}</dd>
              </>
            )}
            <dt>{t('issues.detail.revisions')}</dt>
            <dd>{issue.revisionIds.join(', ') || t('issues.detail.none')}</dd>
            <dt>{t('issues.detail.latest_revision')}</dt>
            <dd>{issue.latestRevisionId ?? t('issues.detail.none')}</dd>
            <dt>{t('issues.detail.refs')}</dt>
            <dd>{issue.refs.join(', ') || t('issues.detail.none')}</dd>
            <dt>{t('issues.detail.uncommitted')}</dt>
            <dd>{String(issue.uncommitted)}</dd>
          </dl>
        )}
        {issue.divergence !== null && (
          <ul class="issue-detail__copies" data-testid="issue-detail-record-copies">
            {issue.divergence.copies.map((copy, index) => (
              <li key={`${copy.storeRef ?? 'local'}-${copy.targetLineId ?? 'none'}-${index}`}>
                {t('issues.detail.record_copy', {
                  ref: copy.storeRef ?? '-',
                  line: copy.targetLineId ?? '-',
                  sha: copy.sha256,
                  diagnostic: copy.diagnostic ?? '-',
                  record: copy.record === null
                    ? '-'
                    : `${copy.record.id} · ${copy.record.title} · ${copy.record.state} · ${copy.record.createdAt}`,
                })}
              </li>
            ))}
          </ul>
        )}
        {status.acceptance === null ? (
          <p data-testid="issue-detail-acceptance-absent">{t('issues.detail.acceptance_absent')}</p>
        ) : (
          <div data-testid="issue-detail-acceptance">
            <p data-testid="issue-detail-acceptance-conditions">
              {status.acceptance.conditions.revisionId === null
                ? t('issues.detail.conditions_none')
                : t('issues.detail.conditions_revision', {
                    revision: status.acceptance.conditions.revisionId,
                  })}
              {status.acceptance.conditions.diagnostic !== null
                ? ` — ${status.acceptance.conditions.diagnostic}`
                : ''}
            </p>
            <dl class="issue-detail__facts" data-testid="issue-detail-conditions-metadata">
              <dt>{t('issues.detail.conditions_path')}</dt>
              <dd>{status.acceptance.conditions.path ?? t('issues.detail.none')}</dd>
              {status.acceptance.conditions.revision !== null && (
                <>
                  <dt>{t('issues.detail.conditions_created')}</dt>
                  <dd>{status.acceptance.conditions.revision.createdAt}</dd>
                  <dt>{t('issues.detail.conditions_supersedes')}</dt>
                  <dd>{status.acceptance.conditions.revision.supersedes ?? t('issues.detail.none')}</dd>
                  <dt>{t('issues.detail.content_sha')}</dt>
                  <dd>{status.acceptance.conditions.revision.contentSha256}</dd>
                </>
              )}
            </dl>
            <ul class="issue-detail__conditions">
              {(status.acceptance.conditions.revision?.conditions ?? []).map((condition) => (
                <li key={condition.id} data-testid="issue-detail-condition">
                  <span class="issue-detail__condition-id">{condition.id}</span>
                  <span class="issue-detail__condition-requirement">{condition.requirement}</span>
                  {condition.verification !== undefined && (
                    <span class="issue-detail__condition-verification">{condition.verification}</span>
                  )}
                </li>
              ))}
            </ul>
            <p data-testid="issue-detail-gate">
              {status.acceptance.gate.eligible
                ? t('issues.detail.gate_eligible', {
                    revision: status.acceptance.gate.conditionsRevisionId,
                  })
                : t('issues.detail.gate_blocked', {
                    code: status.acceptance.gate.refusalCode,
                    message: status.acceptance.gate.message,
                  })}
            </p>
            {status.acceptance.gate.eligible && (
              <p data-testid="issue-detail-gate-snapshot">
                {t('issues.detail.gate_snapshot', {
                  completed: status.acceptance.gate.snapshot.completed,
                  total: status.acceptance.gate.snapshot.total,
                  health: status.acceptance.gate.snapshot.health,
                  problems: status.acceptance.gate.snapshot.problemsStanding,
                })}
              </p>
            )}
            {!status.acceptance.gate.eligible && status.acceptance.gate.blockers.length > 0 && (
              <ul class="issue-detail__gate-blockers">
                {status.acceptance.gate.blockers.map((blocker, index) => (
                  <li key={index} data-testid="issue-detail-gate-blocker">
                    {blocker.kind === 'un-terminal-node'
                      ? `${blocker.nodeId}: ${t(ISSUE_OBSERVATION_LABEL_KEYS[blocker.observation])}`
                      : blocker.kind === 'failing-node'
                        ? blocker.nodeId
                        : blocker.kind === 'status-problem'
                          ? `${t(ISSUE_PROBLEM_KIND_LABEL_KEYS[blocker.problemKind])} ${blocker.node ?? '-'} ${blocker.ref ?? '-'}: ${blocker.reason}`
                          : blocker.reason}
                  </li>
                ))}
              </ul>
            )}
            {status.acceptance.gate.exclusions.length > 0 && (
              <ul class="issue-detail__gate-exclusions">
                {status.acceptance.gate.exclusions.map((exclusion) => (
                  <li key={exclusion.nodeId} data-testid="issue-detail-gate-exclusion">
                    {`${exclusion.nodeId} ${t(ISSUE_LIFECYCLE_LABEL_KEYS[exclusion.lifecycle])} — ${exclusion.reason}`}
                  </li>
                ))}
              </ul>
            )}
            <p data-testid="issue-detail-optional-nodes">
              {t('issues.detail.optional_nodes', {
                nodes: status.acceptance.gate.optionalNodes.join(', ') || '-',
              })}
            </p>
            {status.acceptance.record !== null && (
              <div data-testid="issue-detail-accepted-record">
                <p>
                  {t('issues.detail.accepted_record', {
                    acceptedAt: status.acceptance.record.acceptedAt,
                    revision: status.acceptance.record.conditionsRevisionId,
                  })}
                </p>
                <p data-testid="issue-detail-accepted-record-facts">
                  {t('issues.detail.accepted_record_facts', {
                    conditionsSha: status.acceptance.record.conditionsSha256,
                    completed: status.acceptance.record.gate.completed,
                    total: status.acceptance.record.gate.total,
                    health: status.acceptance.record.gate.health,
                    problems: status.acceptance.record.gate.problemsStanding,
                    note: status.acceptance.record.note ?? '-',
                    contentSha: status.acceptance.record.contentSha256,
                  })}
                </p>
                <ul class="issue-detail__accepted-exclusions">
                  {(status.acceptance.record.exclusions ?? []).map((exclusion) => (
                    <li key={exclusion.nodeId} data-testid="issue-detail-accepted-exclusion">
                      {`${exclusion.nodeId} · ${exclusion.lifecycle} · ${exclusion.reason}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. The Execution Plan, node by node, plus the revision delta. */}
      <section class="issue-detail__section" id="issue-section-plan" data-testid="issue-detail-plan">
        <h3>{t('issues.detail.plan')}</h3>
        <p data-testid="issue-detail-plan-revision">
          {plan === null || plan.revisionId === null
            ? t('issues.detail.plan_none')
            : t('issues.detail.plan_revision', { revision: plan.revisionId })}
          {plan !== null && plan.diagnostic !== null ? ` — ${plan.diagnostic}` : ''}
        </p>
        {plan?.revision !== null && plan?.revision !== undefined && (
          <p class="issue-detail__plan-metadata" data-testid="issue-detail-plan-metadata">
            {t('issues.detail.plan_metadata', {
              created: plan.revision.createdAt,
              supersedes: plan.revision.supersedes ?? '-',
              sha: plan.revision.contentSha256,
              ready: String(plan.readiness.readyToResolve),
            })}
          </p>
        )}
        <ul class="issue-detail__nodes">
          {status.nodes.map((node) => (
            <NodeRow key={node.nodeId} node={node} planNode={planNodeById.get(node.nodeId)} />
          ))}
        </ul>
        {plan !== null && plan.readiness.nodes.length > 0 && (
          <ul class="issue-detail__readiness" data-testid="issue-detail-readiness">
            {plan.readiness.nodes.map((entry) => (
              <li key={entry.node.nodeId} data-testid="issue-detail-readiness-node">
                {t('issues.detail.readiness_facts', {
                  node: entry.node.nodeId,
                  readiness: entry.readiness,
                  resolution: entry.resolution.status,
                  claimants: entry.resolution.claimants
                    .map((claimant) => `${claimant.changeId}@${claimant.projectId}/${claimant.targetLineId}:${claimant.foundAtRef}:${String(claimant.archived)}`)
                    .join(', ') || '-',
                  searched: entry.resolution.searchedRefs.join(', ') || '-',
                  local: entry.resolution.localLocator?.root ?? '-',
                  outcome: entry.resolution.outcome ?? '-',
                  archived: String(entry.resolution.archived),
                  blocked: entry.blockedBy.join(', ') || '-',
                })}
              </li>
            ))}
          </ul>
        )}
        {status.delta !== null && (
          <div class="issue-detail__delta" data-testid="issue-detail-delta">
            <h4>
              {t('issues.detail.delta', {
                revision: status.delta.revisionId,
                supersedes: status.delta.supersedes,
              })}
            </h4>
            <ul>
              {status.delta.added.map((nodeId) => (
                <li key={`added-${nodeId}`} data-testid="issue-detail-delta-added">
                  {t('issues.detail.delta_added', { node: nodeId })}
                </li>
              ))}
              {status.delta.removed.map((nodeId) => (
                <li key={`removed-${nodeId}`} data-testid="issue-detail-delta-removed">
                  {t('issues.detail.delta_removed', { node: nodeId })}
                </li>
              ))}
              {status.delta.retargeted.map((entry) => (
                <li key={`retarget-${entry.nodeId}`} data-testid="issue-detail-delta-retargeted">
                  {t('issues.detail.delta_retargeted', {
                    node: entry.nodeId,
                    from: `${entry.fromProjectId}/${entry.fromTargetLineId}`,
                    to: `${entry.toProjectId}/${entry.toTargetLineId}`,
                  })}
                </li>
              ))}
              {status.delta.lifecycleChanges.map((entry) => (
                <li key={`lifecycle-${entry.nodeId}`} data-testid="issue-detail-delta-lifecycle">
                  {t('issues.detail.delta_lifecycle', {
                    node: entry.nodeId,
                    from: t(ISSUE_LIFECYCLE_LABEL_KEYS[entry.from]),
                    to: t(ISSUE_LIFECYCLE_LABEL_KEYS[entry.to]),
                  })}
                </li>
              ))}
              {status.delta.edgeChanges.map((entry) => (
                <li key={`edges-${entry.nodeId}`} data-testid="issue-detail-delta-edges">
                  {t('issues.detail.delta_edges', {
                    node: entry.nodeId,
                    added: entry.addedDependencies.join(', ') || '-',
                    removed: entry.removedDependencies.join(', ') || '-',
                  })}
                </li>
              ))}
              {status.delta.suggestionChanges.map((entry) => (
                <li key={`suggestion-${entry.nodeId}`} data-testid="issue-detail-delta-suggestion">
                  {t('issues.detail.delta_suggestion', {
                    node: entry.nodeId,
                    from: entry.from ?? '-',
                    to: entry.to ?? '-',
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 3. Changes grouped by member project, each group with its own progress. */}
      <section class="issue-detail__section" id="issue-section-projects" data-testid="issue-detail-projects">
        <h3>{t('issues.detail.projects')}</h3>
        {status.projects.length === 0 ? (
          <p>{t('issues.detail.projects_none')}</p>
        ) : (
          status.projects.map((lane) => (
            <div class="issue-detail__lane" data-testid="issue-detail-lane" data-project={lane.projectId} key={lane.projectId}>
              <h4>
                <span class="issue-detail__lane-name">{lane.alias ?? lane.projectId}</span>
                <span class="issue-detail__lane-id">{lane.projectId}</span>
                <span class="issue-detail__lane-progress" data-testid="issue-detail-lane-progress">
                  {t('issues.progress', {
                    completed: lane.progress.completed,
                    total: lane.progress.total,
                  })}
                </span>
              </h4>
              <ul>
                {lane.nodeIds.map((nodeId) => {
                  const node = nodeById.get(nodeId);
                  return (
                    <li key={nodeId} data-testid="issue-detail-lane-node">
                      {nodeId}
                      {node !== undefined
                        ? ` — ${t(ISSUE_OBSERVATION_LABEL_KEYS[node.observation])}`
                        : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* 4. Cross-project dependencies: the projection's own blocker facts. */}
      <section class="issue-detail__section" id="issue-section-dependencies" data-testid="issue-detail-dependencies">
        <h3>{t('issues.detail.dependencies')}</h3>
        {blockedNodes.length === 0 ? (
          <p data-testid="issue-detail-dependencies-none">{t('issues.detail.dependencies_none')}</p>
        ) : (
          <ul>
            {blockedNodes.map((node) => (
              <li key={node.nodeId} data-testid="issue-detail-dependency" data-node={node.nodeId}>
                <span class="issue-detail__dependency-node">{node.nodeId}</span>
                <span class="issue-detail__dependency-blockers">
                  {node.blockedBy
                    .map((blocker) =>
                      issueBlockerLabel({
                        nodeId: blocker.nodeId,
                        projectId: blocker.projectId,
                        state: t(ISSUE_OBSERVATION_LABEL_KEYS[blocker.observation]),
                      })
                    )
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. Runs, sessions, and delivery evidence — per node, then the rollup. */}
      <section class="issue-detail__section" id="issue-section-delivery" data-testid="issue-detail-delivery">
        <h3>{t('issues.detail.delivery')}</h3>
        <ul>
          {status.nodes.map((node) => (
            <li key={node.nodeId} data-testid="issue-detail-attribution" data-node={node.nodeId}>
              <span class="issue-detail__attribution-node">{node.nodeId}</span>
              <span data-testid="issue-detail-pipeline">
                {t('issues.detail.pipeline', {
                  pipeline: node.attribution.pipeline ?? t('issues.detail.none'),
                })}
              </span>
              {node.runStatePath !== null && (
                <span class="issue-detail__run-state-path">{node.runStatePath}</span>
              )}
              <span class="issue-detail__located-by" data-testid="issue-detail-located-by">
                {t('issues.detail.located_by', { locator: node.locatedBy ?? '-' })}
              </span>
              {node.attribution.evidenceLocator !== null && (
                <span class="issue-detail__evidence-locator" data-testid="issue-detail-evidence-locator">
                  {node.attribution.evidenceLocator}
                </span>
              )}
              <ul class="issue-detail__sessions">
                {node.attribution.sessions.map((session) => (
                  <li
                    key={`${session.stageId}-${session.sessionId ?? ''}-${session.threadId ?? ''}`}
                    data-testid="issue-detail-session"
                  >
                    {t('issues.detail.session', {
                      stage: session.stageId,
                      role: session.role ?? '-',
                      runtime: session.runtime ?? '-',
                    })}
                    <span class="issue-detail__session-pointers" data-testid="issue-detail-session-pointers">
                      {t('issues.detail.session_pointers', {
                        session: session.sessionId ?? '-',
                        thread: session.threadId ?? '-',
                        transcript: session.transcript ?? '-',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {node.delivery !== null && (
                <div class="issue-detail__node-delivery" data-testid="issue-detail-node-delivery">
                  <a
                    href={`#${ISSUE_PROVENANCE.delivery.anchor}`}
                    data-testid="issue-detail-delivery-state"
                  >
                    {t(ISSUE_DELIVERY_STATE_LABEL_KEYS[node.delivery.state])}
                  </a>
                  <DeliveryFacts delivery={node.delivery} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {delivery === null ? (
          <p data-testid="issue-detail-delivery-none">{t('issues.detail.delivery_none')}</p>
        ) : (
          <div class="issue-detail__delivery-rollup">
            <p data-testid="issue-detail-delivery-revision">
              {t('issues.detail.delivery_revision', { revision: delivery.revisionId })}
            </p>
            <ul data-testid="issue-detail-delivery-entries">
              {delivery.entries.map((entry) => (
                <li key={entry.nodeId} data-testid="issue-detail-delivery-entry">
                  <span>
                    {t('issues.detail.delivery_entry', {
                      node: entry.nodeId,
                      alias: entry.alias ?? '-',
                      project: entry.projectId,
                      lifecycle: entry.lifecycle,
                      observation: entry.observation,
                    })}
                  </span>
                  {entry.delivery !== null && (
                    <>
                      <a
                        href={`#${ISSUE_PROVENANCE.delivery.anchor}`}
                        data-testid="issue-detail-delivery-state"
                      >
                        {t(ISSUE_DELIVERY_STATE_LABEL_KEYS[entry.delivery.state])}
                      </a>
                      <DeliveryFacts delivery={entry.delivery} />
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p data-testid="issue-detail-delivery-counts">
              {t('issues.detail.delivery_counts', {
                record: delivery.counts.record,
                noRecord: delivery.counts['no-record'],
                notArchived: delivery.counts['not-archived'],
                unreadable: delivery.counts.unreadable,
                unattributed: delivery.counts.unattributed,
              })}
            </p>
          </div>
        )}
      </section>

      {/* 6. The review view: determination, threads, verification summary. */}
      <section class="issue-detail__section" id="issue-section-review" data-testid="issue-detail-review">
        <h3>{t('issues.detail.review')}</h3>
        <p data-testid="issue-detail-review-context">
          {t('issues.detail.review_context', {
            issue: review.issueId,
            revision: review.revisionId ?? '-',
          })}
        </p>
        <p data-testid="issue-detail-determination">
          {t(ISSUE_DETERMINATION_LABEL_KEYS[review.determination.kind])}
          {review.determination.kind === 'review-ready'
            ? ` — ${review.determination.conditionsRevisionId}`
            : review.determination.kind === 'accepted'
              ? ` — ${review.determination.acceptedAt ?? '-'} · ${review.determination.conditionsRevisionId ?? '-'}`
              : review.determination.kind === 'not-ready'
                ? ` — ${t('issues.detail.blocker_count', { count: review.determination.blockerCount })}`
                : review.determination.kind === 'conditions-missing'
                  ? ` — ${review.determination.message}`
                  : review.determination.kind === 'acceptance-unknown'
                    ? ` — ${review.determination.reason}`
                    : ''}
        </p>
        {review.threads.length === 0 ? (
          <p data-testid="issue-detail-threads-none">{t('issues.detail.threads_none')}</p>
        ) : (
          <ul>
            {review.threads.map((thread, index) => (
              <li key={index} data-testid="issue-detail-thread">
                <span class="issue-detail__thread-kind">
                  {t(ISSUE_THREAD_KIND_LABEL_KEYS[thread.kind])}
                </span>
                <span class="issue-detail__thread-node">{thread.nodeId}</span>
                {'alias' in thread && thread.alias !== null && (
                  <span class="issue-detail__thread-alias">{thread.alias}</span>
                )}
                {thread.kind === 'blocked-behind' && (
                  <span>{thread.blockers.map((blocker) => issueBlockerLabel(blocker)).join(', ')}</span>
                )}
                {thread.kind === 'failure' && thread.diagnostic !== null && (
                  <span>{thread.diagnostic}</span>
                )}
                {(thread.kind === 'optional-open' || thread.kind === 'archive-pending') && (
                  <span>{t(ISSUE_OBSERVATION_LABEL_KEYS[thread.observation])}</span>
                )}
                {thread.kind === 'evidence-missing' && <span>{thread.names.join(', ')}</span>}
              </li>
            ))}
          </ul>
        )}
        <p data-testid="issue-detail-verification">
          {t('issues.detail.verification', {
            progress:
              review.verification.progress === null
                ? '-/-'
                : `${review.verification.progress.completed}/${review.verification.progress.total}`,
            record: review.verification.delivery?.record ?? '-',
            noRecord: review.verification.delivery?.['no-record'] ?? '-',
            notArchived: review.verification.delivery?.['not-archived'] ?? '-',
            unreadable: review.verification.delivery?.unreadable ?? '-',
            unattributed: review.verification.delivery?.unattributed ?? '-',
          })}
        </p>
      </section>

      {/* 7. Needs attention, narrowed to this Issue. */}
      <section class="issue-detail__section" id="issue-section-attention" data-testid="issue-detail-attention">
        <h3>{t('issues.detail.attention')}</h3>
        {attention !== null && (
          <>
            <p data-testid="issue-detail-attention-summary">
              {t('issues.detail.attention_summary', {
                narrowed: String(attention.narrowed),
                issue: attention.issueId ?? '-',
                scanned: attention.scannedCount,
                total: attention.total,
                complete: String(attention.complete),
                failure: attention.counts.failure,
                blocked: attention.counts['blocked-behind'],
                waiting: attention.counts['waiting-human'],
                acceptance: attention.counts['acceptance-awaiting'],
                problem: attention.counts.problem,
              })}
            </p>
            <ul class="issue-detail__attention-scanned" data-testid="issue-detail-attention-scanned">
              {attention.scanned.map((entry) => (
                <li key={entry.issueId} data-testid="issue-detail-attention-scan-entry">
                  {t('issues.detail.attention_scan_entry', {
                    issue: entry.issueId,
                    phase: entry.phase,
                    health: entry.health,
                    count: entry.itemCount,
                    visibility:
                      entry.runStateVisibility.kind === 'execution-root'
                        ? entry.runStateVisibility.executionRoot
                        : 'none',
                  })}
                </li>
              ))}
            </ul>
          </>
        )}
        {attentionItems.length === 0 ? (
          <p data-testid="issue-detail-attention-empty">{t('issues.attention.empty')}</p>
        ) : (
          <ul>
            {attentionItems.map((item, index) => {
              const detail = attentionItemDetail(item, t);
              return (
                <li key={index} data-testid="issue-detail-attention-item" data-kind={item.kind}>
                  <a
                    class="issue-detail__attention-kind"
                    href={`#${ISSUE_PROVENANCE[issueAttentionProvenanceFamily(item)].anchor}`}
                    data-testid="issue-detail-attention-evidence"
                  >
                    {t(ISSUE_ATTENTION_KIND_LABEL_KEYS[item.kind])}
                  </a>
                  {item.nodeId !== null && (
                    <span class="issue-detail__attention-node">{item.nodeId}</span>
                  )}
                  <span class="issue-detail__attention-context" data-testid="issue-detail-attention-context">
                    {t('issues.detail.attention_context', {
                      issue: item.issueId,
                      alias: item.alias ?? '-',
                      phase: item.phase,
                      health: item.health,
                    })}
                  </span>
                  {detail !== null && <span class="issue-detail__attention-detail">{detail}</span>}
                  {item.kind === 'acceptance-awaiting' && item.gate !== null && (
                    <span class="issue-detail__attention-gate" data-testid="issue-detail-attention-gate">
                      {acceptanceGateFacts(item.gate, t)}
                    </span>
                  )}
                  {item.kind === 'problem' && (
                    <span class="issue-detail__attention-problem" data-testid="issue-detail-attention-problem">
                      {`${item.problem.kind} · ${item.problem.node ?? '-'} · ${item.problem.ref ?? '-'} · ${item.problem.reason}`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
