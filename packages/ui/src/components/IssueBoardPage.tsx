import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  SpaceMember,
  StoreIssueAttentionItem,
  StoreIssueAttentionResponse,
  StoreIssueIdentity,
  StoreIssueProjectionEntry,
  StoreIssueProjectionsResponse,
  StoreProjectsResponse,
} from '../api/types.js';
import { IssueCard } from './IssueCard.js';
import { MemberChips } from './MemberChips.js';
import { PageHeader } from './ui/PageHeader.js';
import { spaceHref, useSpace, type Space } from '../store/use-space.js';
import { useT } from '../i18n/store.js';
import { ISSUE_PHASE_LABEL_KEYS, ISSUE_PHASE_ORDER } from './issue-vocabulary.js';

/**
 * The Issue Board (issue-board-ui spec / roadmap §9.1): one card per Issue in
 * the five phase lanes. Creation is the one Board mutation: after the server
 * writes the record, the Board refetches every read payload and renders only
 * that committed truth.
 *
 * Zero second state, structurally. All three read payloads are fetched on navigation and
 * on explicit refresh, keyed on `[selector, refreshNonce]`; nothing is cached
 * at module level, nothing is written to client storage, and no displayed value
 * is computed from another — lane placement IS `status.phase`, the health
 * badge IS `status.health`, the progress pair IS `status.progress`, and the
 * card's attention line IS the first item the scan ordered for that Issue.
 * Discarding and rebuilding any client cache therefore reproduces this view by
 * construction: there is nothing to rebuild.
 *
 * Member chips are a FILTER and nothing else (spec requirement 3): selecting
 * one hides cards, and hides nothing else — the lanes stay phase lanes, every
 * visible card keeps its own lane, and the selection is never persisted, so
 * leaving and returning starts at "All" again.
 */
export function IssueBoardPage() {
  const space = useSpace();
  const selector = space?.selector;
  return <IssueBoardState key={selector ?? 'no-store'} space={space} selector={selector} />;
}

function CreatedIssueNotice({ identity, space }: { identity: StoreIssueIdentity; space: Space }) {
  return (
    <p class="issue-board__created" data-testid="issue-board-created">
      <a href={spaceHref(space, 'issues', identity.uid)}>{identity.key}</a>
    </p>
  );
}

/** Selector-owned state: a route change replaces this child synchronously. */
function IssueBoardState({ space, selector }: { space: Space | null; selector: string | undefined }) {
  const t = useT();
  const [projections, setProjections] = useState<StoreIssueProjectionsResponse | null>(null);
  const [attention, setAttention] = useState<StoreIssueAttentionResponse | null>(null);
  const [projects, setProjects] = useState<StoreProjectsResponse | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [createdIdentity, setCreatedIdentity] = useState<StoreIssueIdentity | null>(null);
  // The selected member chip (a member's projectId), or null for "All". State
  // of THIS mount only — never persisted, never restored (spec: "the filter
  // does not persist").
  const [selectedMember, setSelectedMember] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    setSelectedMember(null);
    Promise.all([
      client.getStoreIssueProjections(selector),
      client.getStoreIssueAttention(selector),
      client.getStoreProjects(selector),
    ])
      .then(([projectionsRes, attentionRes, projectsRes]) => {
        if (cancelled) return;
        setProjections(projectionsRes);
        setAttention(attentionRes);
        setProjects(projectsRes);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'issues.error.load' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selector, refreshNonce]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  function handleIssueCreated(identity: StoreIssueIdentity) {
    setDialogOpen(false);
    setCreatedIdentity(identity);
    refresh();
  }

  if (loading) {
    return (
      <>
        <p class="issue-board__loading">{t('issues.loading')}</p>
        {createdIdentity !== null && space !== null && (
          <CreatedIssueNotice identity={createdIdentity} space={space} />
        )}
      </>
    );
  }

  if (pageError) {
    return (
      <div class="issue-board__error" data-testid="issue-board-error">
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

  const issues: StoreIssueProjectionEntry[] = projections?.issues ?? [];

  // The chip roster is the Store's complete project catalog, including members
  // with no lane in any current Issue. A projection lane may improve the label
  // with its payload alias, but it never controls membership in the roster.
  const memberById = new Map<string, SpaceMember>();
  for (const project of projects?.projects ?? []) {
    memberById.set(project.projectId, { projectId: project.projectId, name: project.projectId });
  }
  for (const entry of issues) {
    for (const lane of entry.status.projects) {
      const member = memberById.get(lane.projectId);
      if (member !== undefined && lane.alias !== null) {
        memberById.set(lane.projectId, {
          ...member,
          name: lane.alias,
        });
      }
    }
  }
  const members = [...memberById.values()].sort((a, b) => a.projectId.localeCompare(b.projectId));

  const visible =
    selectedMember === null
      ? issues
      : issues.filter((entry) =>
          entry.status.projects.some((lane) => lane.projectId === selectedMember)
        );

  // The first item the scan ordered for each Issue. The scan's `items` are
  // already sorted fail-first across Issues, so the FIRST match for an Issue is
  // that Issue's most important item — no ranking happens here.
  const topAttention = new Map<string, StoreIssueAttentionItem>();
  for (const item of attention?.items ?? []) {
    if (!topAttention.has(item.issueId)) topAttention.set(item.issueId, item);
  }

  // Every incompleteness fact the three payloads report, surfaced rather than
  // swallowed (spec requirement 2). Run-state visibility is a per-Issue fact;
  // the board discloses it exactly as the CLI listing does — the label when
  // any read saw an execution root, the plain statement when none did.
  const runStateRoot = issues
    .map((entry) => entry.status.runStateVisibility)
    .find((visibility) => visibility.kind === 'execution-root');
  const notices: Array<{ testid: string; text: string }> = [];
  if (!projections?.complete || !attention?.complete || !projects?.complete) {
    notices.push({ testid: 'issue-board-incomplete', text: t('issues.notice.incomplete') });
  }
  for (const problem of projections?.problems ?? []) {
    notices.push({
      testid: 'issue-board-problem',
      text: t('issues.notice.problem', {
        item: problem.itemId,
        reason: problem.reason,
      }),
    });
  }
  for (const problem of projects?.problems ?? []) {
    notices.push({
      testid: 'issue-board-problem',
      text: t('issues.notice.problem', {
        item: problem.itemId,
        reason: problem.reason,
      }),
    });
  }
  const unsearchedRefs = new Map<string, { targetLineId: string; storeRef: string; reason: string }>();
  for (const ref of [
    ...(projections?.unsearchedRefs ?? []),
    ...(attention?.unsearchedRefs ?? []),
    ...(projects?.unsearchedRefs ?? []),
  ]) {
    unsearchedRefs.set(`${ref.targetLineId}\0${ref.storeRef}\0${ref.reason}`, ref);
  }
  for (const ref of unsearchedRefs.values()) {
    notices.push({
      testid: 'issue-board-unsearched',
      text: t('issues.notice.unsearched_ref', {
        line: ref.targetLineId,
        ref: ref.storeRef,
        reason: ref.reason,
      }),
    });
  }
  if (issues.length > 0) {
    notices.push(
      runStateRoot !== undefined && runStateRoot.kind === 'execution-root'
        ? {
            testid: 'issue-board-run-state',
            text: t('issues.notice.run_state', { root: runStateRoot.executionRoot }),
          }
        : { testid: 'issue-board-run-state-none', text: t('issues.notice.run_state_none') }
    );
  }

  return (
    <div class="issue-board" data-testid="issue-board">
      <PageHeader
        title={t('issues.title')}
        actions={
          <>
            <button
              type="button"
              class="btn--primary"
              data-testid="issue-board-create"
              onClick={() => setDialogOpen(true)}
            >
              {t('unlinked.create')}
            </button>
            <button type="button" class="btn--ghost" data-testid="issue-board-refresh" onClick={refresh}>
              {t('issues.refresh')}
            </button>
          </>
        }
      />
      {dialogOpen && (
        <NewIssueDialog
          selector={selector}
          onCancel={() => setDialogOpen(false)}
          onCreated={handleIssueCreated}
        />
      )}
      {createdIdentity !== null && space !== null && (
        <CreatedIssueNotice identity={createdIdentity} space={space} />
      )}
      {notices.length > 0 && (
        <ul class="issue-board__notices" data-testid="issue-board-notices">
          {notices.map((notice, index) => (
            <li key={`${notice.testid}-${index}`} data-testid={notice.testid}>
              {notice.text}
            </li>
          ))}
        </ul>
      )}
      {members.length > 0 && (
        <MemberChips members={members} selected={selectedMember} onSelect={setSelectedMember} />
      )}
      {issues.length === 0 && (
        <p class="issue-board__empty" data-testid="issue-board-empty">
          {t('issues.empty')}
        </p>
      )}
      <div class="issue-board__lanes">
        {/* All five lanes render always, including when the Store has no
            Issues: a missing lane would read as "no such phase", which is a
            different claim from an empty phase. */}
        {ISSUE_PHASE_ORDER.map((phase) => {
          const laneIssues = visible.filter((entry) => entry.status.phase === phase);
          return (
            <section class="issue-lane" data-testid="issue-lane" data-phase={phase} key={phase}>
              <h3 class="issue-lane__title">
                {t(ISSUE_PHASE_LABEL_KEYS[phase])}
                <span class="issue-lane__count">{laneIssues.length}</span>
              </h3>
              {laneIssues.length === 0 ? (
                <p class="issue-lane__empty">{t('issues.lane_empty')}</p>
              ) : (
                laneIssues.map((entry) => (
                  <IssueCard
                    key={entry.identity?.uid ?? entry.issueId}
                    entry={entry}
                    attentionItem={topAttention.get(entry.identity?.uid ?? entry.issueId) ?? null}
                    href={space ? spaceHref(space, 'issues', entry.identity?.uid ?? entry.issueId) : '/'}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function NewIssueDialog({
  selector,
  onCancel,
  onCreated,
}: {
  selector: string | undefined;
  onCancel: () => void;
  onCreated: (identity: StoreIssueIdentity) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await client.createStoreIssue({ title }, selector);
      onCreated(result.identity);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setErrorMessage(err instanceof ApiError ? err.message : 'unlinked.dialog.create_error');
    }
  }

  return (
    <div class="new-change-dialog__overlay">
      <form
        class="new-change-dialog"
        data-testid="new-issue-dialog"
        aria-label={t('unlinked.create')}
        onSubmit={handleSubmit}
      >
        <h2 class="new-change-dialog__title">{t('unlinked.create')}</h2>
        <label class="new-change-dialog__field">
          <span>{t('unlinked.dialog.issue_title')}</span>
          <input
            type="text"
            name="title"
            value={title}
            disabled={submitting}
            required
            maxLength={200}
            onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
          />
        </label>
        {errorMessage && (
          <p class="new-change-dialog__error" role="alert">
            {t(errorMessage)}
          </p>
        )}
        <div class="new-change-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onCancel} disabled={submitting}>
            {t('dialog.new_change.cancel')}
          </button>
          <button type="submit" class="btn--primary" disabled={submitting}>
            {submitting ? t('unlinked.dialog.submitting') : t('dialog.new_change.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
