import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  RunsResponse,
  SessionListEntry,
  SpaceMember,
  StoreChangeIssueLinksResponse,
  StoreProjectsResponse,
} from '../api/types.js';
import { useT } from '../i18n/store.js';
import { spaceEntryForSelector, useSpace } from '../store/use-space.js';
import { MemberChips } from './MemberChips.js';
import {
  RunOperationsPanel,
} from './OperationsSection.js';
import { PageHeader } from './ui/PageHeader.js';
import { SessionRow } from './SessionRow.js';
import {
  attributeRunChange,
  attributeSessionChange,
  classifySession,
  type ChangeAttribution,
  type SessionPresentationGroup,
} from './operations-model.js';

interface SourceFailure {
  readonly source: 'sessions' | 'runs';
  readonly message: string;
}

interface MemberOperationsSource extends SpaceMember {
  readonly selector?: string;
  readonly sessions: readonly SessionListEntry[];
  readonly runs: RunsResponse | null;
  readonly failures: readonly SourceFailure[];
  readonly loadingMore?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function executionLabel(entry: SessionListEntry): string {
  const execution = entry.session.execution;
  if (execution === undefined) return 'legacy / unknown';
  if (execution.kind === 'planning-only') return 'planning-only';
  return `${execution.projectId} · ${execution.root}`;
}

function AttributionFacts({ attribution }: { attribution: ChangeAttribution }) {
  const t = useT();
  if (attribution.kind === 'ambiguous') {
    return (
      <p class="operations-page__attribution operations-page__attribution--ambiguous">
        {t('operations.page.attribution_ambiguous', { count: attribution.candidates.length })}
      </p>
    );
  }
  if (attribution.kind === 'unavailable') {
    return (
      <p class="operations-page__attribution operations-page__attribution--unavailable">
        {t('operations.page.attribution_unavailable', { reason: attribution.reason })}
      </p>
    );
  }
  const change = attribution.entry.occurrence.change;
  return (
    <div class="operations-page__attribution" data-testid="operations-attribution-exact">
      <span>
        {t('operations.page.change')}: <strong>{change.changeId}</strong>
      </span>
      <code>{change.changeInstanceId}</code>
      <span>{change.projectId} / {change.targetLineId}</span>
      <span>
        {attribution.entry.issues.length === 0
          ? t('operations.page.issue_unavailable')
          : t('operations.page.issues', {
              issues: attribution.entry.issues.map(issue => issue.identity.key).join(', '),
            })}
      </span>
    </div>
  );
}

function SessionCard({
  entry,
  links,
  onRefresh,
}: {
  entry: SessionListEntry;
  links: StoreChangeIssueLinksResponse | null;
  onRefresh: () => void;
}) {
  const t = useT();
  const attribution = attributeSessionChange(entry.session, links?.entries ?? []);
  return (
    <div
      class="operations-page__session"
      data-testid="operations-session"
      data-session-id={entry.session.id}
    >
      <dl class="operations-page__session-facts">
        <div>
          <dt>{t('operations.page.actual_cwd')}</dt>
          <dd><code>{entry.session.cwd}</code> · {t('operations.page.locator_only')}</dd>
        </div>
        <div>
          <dt>{t('operations.page.execution')}</dt>
          <dd>{executionLabel(entry)}</dd>
        </div>
      </dl>
      <AttributionFacts attribution={attribution} />
      <SessionRow entry={entry} onKilled={onRefresh} />
    </div>
  );
}

function SessionGroup({
  group,
  entries,
  links,
  onRefresh,
}: {
  group: SessionPresentationGroup;
  entries: readonly SessionListEntry[];
  links: StoreChangeIssueLinksResponse | null;
  onRefresh: () => void;
}) {
  const t = useT();
  if (entries.length === 0) return null;
  const content = entries.map(entry => (
    <SessionCard key={entry.session.id} entry={entry} links={links} onRefresh={onRefresh} />
  ));
  if (group === 'settled') {
    return (
      <details class="operations-page__session-group" data-session-group={group}>
        <summary>{t('operations.page.sessions_settled', { count: entries.length })}</summary>
        {content}
      </details>
    );
  }
  return (
    <section class="operations-page__session-group" data-session-group={group}>
      <h2>{t(`operations.page.sessions_${group}`, { count: entries.length })}</h2>
      {content}
    </section>
  );
}

function mergeRuns(current: RunsResponse | null, next: RunsResponse): RunsResponse {
  if (current === null) return next;
  const reconciler = new Map((current.reconcilerRuns ?? []).map(run => [run.runId, run]));
  for (const run of next.reconcilerRuns ?? []) reconciler.set(run.runId, run);
  return {
    runs: [...current.runs, ...next.runs],
    reconcilerRuns: [...reconciler.values()],
    nextCursor: next.nextCursor,
    hasMore: next.hasMore,
  };
}

function ScopedOperationsPage({ selector }: { selector?: string }) {
  const t = useT();
  const ownerSelector = useRef(selector).current;
  const liveSelector = useRef(selector);
  const scopeActive = useRef(true);
  liveSelector.current = selector;
  const [projects, setProjects] = useState<StoreProjectsResponse | null>(null);
  const [links, setLinks] = useState<StoreChangeIssueLinksResponse | null>(null);
  const [storeSessions, setStoreSessions] = useState<readonly SessionListEntry[]>([]);
  const [members, setMembers] = useState<readonly MemberOperationsSource[]>([]);
  const [pageFailures, setPageFailures] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const membersRef = useRef(members);
  membersRef.current = members;

  function ownsStore(requestSelector = ownerSelector): boolean {
    return scopeActive.current &&
      liveSelector.current === ownerSelector &&
      requestSelector === ownerSelector;
  }

  useEffect(() => () => {
    scopeActive.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestSelector = ownerSelector;
    const retainedMembers = membersRef.current;
    setLoading(true);
    async function load(): Promise<void> {
      const [projectRead, spacesRead, linksRead, storeSessionRead] = await Promise.allSettled([
        client.getStoreProjects(requestSelector),
        client.listSpaces(),
        client.getStoreChangeIssueLinks(requestSelector),
        client.listSessions(requestSelector),
      ]);
      if (cancelled || !ownsStore(requestSelector)) return;
      const failures: string[] = [];
      if (spacesRead.status === 'rejected') {
        failures.push(errorMessage(spacesRead.reason, t('operations.page.spaces_error')));
      }
      if (projectRead.status === 'rejected') {
        failures.push(errorMessage(projectRead.reason, t('operations.page.roster_error')));
      } else {
        setProjects(projectRead.value);
        const storeSpace = spacesRead.status === 'fulfilled'
          ? spaceEntryForSelector(
              spacesRead.value.spaces,
              `store:${projectRead.value.storeUid}`
            )
          : null;
        const roots = new Map(
          spacesRead.status === 'fulfilled' && storeSpace?.type === 'store'
            ? storeSpace.members.map(member => [member.projectId, member] as const)
            : retainedMembers.map(member => [member.projectId, member] as const)
        );
        const roster = projectRead.value.projects.map(project => {
          const located = roots.get(project.projectId);
          return {
            projectId: project.projectId,
            name: located?.name ?? project.projectId,
            ...(located?.root === undefined ? {} : { root: located.root }),
          };
        });
        const memberReads = await Promise.all(roster.map(async member => {
          if (member.root === undefined) {
            return { member, selector: undefined, sessionRead: null, runRead: null };
          }
          const memberSelector = `project:${member.root}`;
          const [sessionRead, runRead] = await Promise.allSettled([
            client.listSessions(memberSelector),
            client.listRuns(memberSelector),
          ]);
          return { member, selector: memberSelector, sessionRead, runRead };
        }));
        if (!cancelled && ownsStore(requestSelector)) {
          setMembers(current => {
            const previousMembers = current;
            return memberReads.map(read => {
              if (read.selector === undefined || read.sessionRead === null || read.runRead === null) {
                return {
                  ...read.member,
                  sessions: [],
                  runs: null,
                  failures: [],
                } satisfies MemberOperationsSource;
              }
              const previous = previousMembers.find(member =>
                member.projectId === read.member.projectId && member.selector === read.selector
              );
              const sourceFailures: SourceFailure[] = [];
              if (read.sessionRead.status === 'rejected') {
                sourceFailures.push({
                  source: 'sessions',
                  message: errorMessage(read.sessionRead.reason, t('operations.page.sessions_error')),
                });
              }
              if (read.runRead.status === 'rejected') {
                sourceFailures.push({
                  source: 'runs',
                  message: errorMessage(read.runRead.reason, t('operations.page.runs_error')),
                });
              }
              return {
                ...read.member,
                selector: read.selector,
                sessions: read.sessionRead.status === 'fulfilled'
                  ? read.sessionRead.value.sessions
                  : previous?.sessions ?? [],
                runs: read.runRead.status === 'fulfilled'
                  ? read.runRead.value
                  : previous?.runs ?? null,
                failures: sourceFailures,
              } satisfies MemberOperationsSource;
            });
          });
        }
      }
      if (cancelled || !ownsStore(requestSelector)) return;
      if (linksRead.status === 'fulfilled') setLinks(linksRead.value);
      else {
        failures.push(errorMessage(linksRead.reason, t('operations.page.links_error')));
      }
      if (storeSessionRead.status === 'fulfilled') setStoreSessions(storeSessionRead.value.sessions);
      else {
        failures.push(errorMessage(storeSessionRead.reason, t('operations.page.sessions_error')));
      }
      setPageFailures(failures);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [selector, refreshNonce]);

  const allSessions = useMemo(() => {
    const byId = new Map<string, SessionListEntry>();
    for (const entry of storeSessions) byId.set(entry.session.id, entry);
    for (const member of members) {
      for (const entry of member.sessions) if (!byId.has(entry.session.id)) byId.set(entry.session.id, entry);
    }
    return [...byId.values()];
  }, [storeSessions, members]);

  const visibleSessions = allSessions.filter(entry => {
    if (selectedProject === null) return true;
    return entry.session.execution?.kind === 'project' &&
      entry.session.execution.projectId === selectedProject;
  });
  const groupedSessions = new Map<SessionPresentationGroup, SessionListEntry[]>([
    ['active', []], ['abnormal', []], ['settled', []],
  ]);
  for (const entry of visibleSessions) {
    for (const group of classifySession(entry).groups) groupedSessions.get(group)!.push(entry);
  }

  const visibleMembers = members.filter(member =>
    selectedProject === null || member.projectId === selectedProject
  );
  const hasLiveWork = visibleSessions.some(entry => classifySession(entry).groups.includes('active')) ||
    visibleMembers.some(member =>
      (member.runs?.reconcilerRuns ?? []).some(run => run.terminal === undefined && !run.error)
    );
  useEffect(() => {
    if (!hasLiveWork) return;
    const timer = setInterval(() => setRefreshNonce(value => value + 1), 3000);
    return () => clearInterval(timer);
  }, [hasLiveWork, selector]);

  async function retryMember(projectId: string): Promise<void> {
    const member = members.find(candidate => candidate.projectId === projectId);
    if (!member?.selector) return;
    const requestStore = ownerSelector;
    const memberSelector = member.selector;
    const [sessionRead, runRead] = await Promise.allSettled([
      client.listSessions(memberSelector), client.listRuns(memberSelector),
    ]);
    if (!ownsStore(requestStore)) return;
    setMembers(current => current.map(candidate => {
      if (candidate.projectId !== projectId || candidate.selector !== memberSelector) return candidate;
      const failures: SourceFailure[] = [];
      if (sessionRead.status === 'rejected') failures.push({ source: 'sessions', message: errorMessage(sessionRead.reason, t('operations.page.sessions_error')) });
      if (runRead.status === 'rejected') failures.push({ source: 'runs', message: errorMessage(runRead.reason, t('operations.page.runs_error')) });
      return {
        ...candidate,
        sessions: sessionRead.status === 'fulfilled' ? sessionRead.value.sessions : candidate.sessions,
        runs: runRead.status === 'fulfilled' ? runRead.value : candidate.runs,
        failures,
      };
    }));
  }

  async function loadMore(projectId: string): Promise<void> {
    const member = members.find(candidate => candidate.projectId === projectId);
    if (!member?.selector || !member.runs?.nextCursor) return;
    const requestStore = ownerSelector;
    const memberSelector = member.selector;
    const cursor = member.runs.nextCursor;
    setMembers(current => current.map(candidate =>
      candidate.projectId === projectId && candidate.selector === memberSelector
        ? { ...candidate, loadingMore: true }
        : candidate
    ));
    try {
      const next = await client.listRuns(memberSelector, { cursor });
      if (!ownsStore(requestStore)) return;
      setMembers(current => current.map(candidate =>
        candidate.projectId === projectId && candidate.selector === memberSelector
        ? { ...candidate, runs: mergeRuns(candidate.runs, next), loadingMore: false }
        : candidate));
    } catch (error) {
      if (!ownsStore(requestStore)) return;
      setMembers(current => current.map(candidate =>
        candidate.projectId === projectId && candidate.selector === memberSelector
        ? { ...candidate, failures: [...candidate.failures, { source: 'runs', message: errorMessage(error, t('operations.page.runs_error')) }], loadingMore: false }
        : candidate));
    }
  }

  const chips = (projects?.projects ?? []).map(project => ({
    projectId: project.projectId,
    name: members.find(member => member.projectId === project.projectId)?.name ?? project.projectId,
  }));

  if (loading && projects === null) return <p>{t('operations.page.loading')}</p>;

  return (
    <div class="operations-page" data-testid="operations-page">
      <PageHeader
        title={t('operations.page.title')}
        actions={<button type="button" class="btn--ghost" onClick={() => setRefreshNonce(value => value + 1)}>{t('operations.page.refresh')}</button>}
      />
      {pageFailures.map((failure, index) => <p key={index} class="operations-page__source-error" role="alert">{failure}</p>)}
      {chips.length > 0 && <MemberChips members={chips} selected={selectedProject} onSelect={setSelectedProject} />}
      <SessionGroup group="active" entries={groupedSessions.get('active')!} links={links} onRefresh={() => setRefreshNonce(value => value + 1)} />
      <SessionGroup group="abnormal" entries={groupedSessions.get('abnormal')!} links={links} onRefresh={() => setRefreshNonce(value => value + 1)} />
      <SessionGroup group="settled" entries={groupedSessions.get('settled')!} links={links} onRefresh={() => setRefreshNonce(value => value + 1)} />

      <section class="operations-page__members">
        <h2>{t('operations.page.runs_title')}</h2>
        {visibleMembers.map(member => (
          <article class="operations-page__member" key={member.projectId} data-project-id={member.projectId}>
            <h3>{member.name} <code>{member.projectId}</code></h3>
            {member.root === undefined ? (
              <p class="operations-page__unavailable">{t('operations.page.member_root_missing')}</p>
            ) : (
              <>
                {member.failures.map(failure => (
                  <p key={`${failure.source}-${failure.message}`} class="operations-page__source-error" role="alert">
                    {failure.source}: {failure.message}
                  </p>
                ))}
                {member.failures.length > 0 && <button type="button" onClick={() => void retryMember(member.projectId)}>{t('operations.page.retry_member')}</button>}
                {(member.runs?.reconcilerRuns ?? []).map(run => (
                  <div key={`attribution-${run.runId}`} class="operations-page__run-attribution" data-run-id={run.runId}>
                    <strong>{run.runId}</strong>
                    <AttributionFacts attribution={attributeRunChange(run, member.projectId, links?.entries ?? [])} />
                  </div>
                ))}
                <RunOperationsPanel
                  runsResponse={member.runs}
                  selector={member.selector}
                  childNames={(member.runs?.reconcilerRuns ?? []).map(run => run.changeId)}
                  projectId={member.projectId}
                  title={t('operations.page.member_runs', { project: member.name })}
                />
                {member.runs?.hasMore && member.runs.nextCursor && (
                  <button type="button" disabled={member.loadingMore} onClick={() => void loadMore(member.projectId)}>
                    {member.loadingMore ? t('operations.page.loading_more') : t('operations.page.load_more')}
                  </button>
                )}
              </>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

/**
 * Store-only Operations composition over existing Session, Run, roster and
 * link APIs. preact-iso reuses a route component when only `:storeId` changes,
 * so the selector keys the stateful child and synchronously retires every
 * previous-Store request and result.
 */
export function OperationsPage() {
  const selector = useSpace()?.selector;
  return <ScopedOperationsPage key={selector ?? ''} selector={selector} />;
}
