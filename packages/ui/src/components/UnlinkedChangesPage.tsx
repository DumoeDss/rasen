import { useEffect, useState } from 'preact/hooks';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  SpaceMember,
  StoreChangeIssueLinkEntry,
  StoreChangeIssueLinksResponse,
  StoreIssueProjectionsResponse,
} from '../api/types.js';
import { useT } from '../i18n/store.js';
import { useSpace } from '../store/use-space.js';
import { LinkChangeDialog, type LinkDialogMode } from './LinkChangeDialog.js';
import { MemberChips } from './MemberChips.js';
import { PageHeader } from './ui/PageHeader.js';

function groupKey(entry: StoreChangeIssueLinkEntry): string {
  const change = entry.occurrence.change;
  return `${change.projectId}\0${change.targetLineId}`;
}

function ChangeRow({
  entry,
  onAction,
}: {
  entry: StoreChangeIssueLinkEntry;
  onAction: (mode: LinkDialogMode) => void;
}) {
  const t = useT();
  const change = entry.occurrence.change;
  const attachable = entry.association === 'unlinked' && entry.eligibility === 'attachable';
  return (
    <article
      class={`unlinked-change unlinked-change--${entry.occurrence.kind}`}
      data-testid="unlinked-change-row"
      data-association={entry.association}
      data-eligibility={entry.eligibility}
    >
      <header>
        <span class="unlinked-change__kind">{t('unlinked.change')}</span>
        <strong>{change.changeId}</strong>
        <span>{entry.occurrence.kind === 'active' ? t('unlinked.active') : t('unlinked.archived')}</span>
      </header>
      <dl>
        <div><dt>{t('unlinked.instance')}</dt><dd><code>{change.changeInstanceId ?? t('unlinked.none')}</code></dd></div>
        <div><dt>{t('unlinked.project')}</dt><dd>{change.projectId}</dd></div>
        <div><dt>{t('unlinked.target_line')}</dt><dd>{change.targetLineId}</dd></div>
        <div><dt>{t('unlinked.source_ref')}</dt><dd><code>{change.foundAtRef}</code></dd></div>
        {entry.occurrence.kind === 'archived' && (
          <>
            <div><dt>{t('unlinked.archive_entry')}</dt><dd>{entry.occurrence.change.entryName}</dd></div>
            <div><dt>{t('unlinked.archive_date')}</dt><dd>{entry.occurrence.change.archiveDate ?? t('unlinked.none')}</dd></div>
          </>
        )}
      </dl>
      <p class="unlinked-change__association">
        {entry.association === 'unlinked'
          ? t('unlinked.no_issue_link')
          : entry.association === 'linked'
            ? t('unlinked.linked_issues', { count: entry.issues.length })
            : t('unlinked.unknown_reason', { reason: entry.eligibility })}
      </p>
      {attachable && (
        <div class="unlinked-change__actions">
          <button type="button" onClick={() => onAction('attach')}>{t('unlinked.attach')}</button>
          <button type="button" onClick={() => onAction('create')}>{t('unlinked.create')}</button>
        </div>
      )}
    </article>
  );
}

function ScopedUnlinkedChangesPage({ selector }: { selector?: string }) {
  const t = useT();
  const [links, setLinks] = useState<StoreChangeIssueLinksResponse | null>(null);
  const [issues, setIssues] = useState<StoreIssueProjectionsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    entry: StoreChangeIssueLinkEntry;
    mode: LinkDialogMode;
    selector?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      client.getStoreChangeIssueLinks(selector),
      client.getStoreIssueProjections(selector, 'open'),
    ])
      .then(([linkRead, issueRead]) => {
        if (cancelled) return;
        setLinks(linkRead);
        setIssues(issueRead);
      })
      .catch(caught => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : t('unlinked.load_error'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selector, refreshNonce]);

  const entries = links?.entries ?? [];
  const membersById = new Map<string, SpaceMember>();
  for (const entry of entries) {
    const projectId = entry.occurrence.change.projectId;
    membersById.set(projectId, { projectId, name: projectId });
  }
  const members = [...membersById.values()].sort((left, right) => left.projectId.localeCompare(right.projectId));
  const visible = selectedProject === null
    ? entries
    : entries.filter(entry => entry.occurrence.change.projectId === selectedProject);
  const attachable = visible.filter(entry => entry.association === 'unlinked' && entry.eligibility === 'attachable');
  const linked = visible.filter(entry => entry.association === 'linked');
  const unknown = visible.filter(entry => entry.association === 'unknown');
  const groups = new Map<string, StoreChangeIssueLinkEntry[]>();
  for (const entry of attachable) {
    const key = groupKey(entry);
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  if (loading && links === null) return <p>{t('unlinked.loading')}</p>;
  if (error) {
    return (
      <div class="unlinked-page__error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => setRefreshNonce(value => value + 1)}>{t('unlinked.refresh')}</button>
      </div>
    );
  }

  return (
    <div class="unlinked-page" data-testid="unlinked-changes-page">
      <PageHeader
        title={t('unlinked.title')}
        actions={<button type="button" class="btn--ghost" onClick={() => setRefreshNonce(value => value + 1)}>{t('unlinked.refresh')}</button>}
      />
      {!links?.complete && (
        <p class="unlinked-page__notice" role="status">{t('unlinked.incomplete')}</p>
      )}
      {members.length > 0 && <MemberChips members={members} selected={selectedProject} onSelect={setSelectedProject} />}

      <section class="unlinked-page__attachable">
        <h2>{t('unlinked.attachable_title', { count: attachable.length })}</h2>
        {attachable.length === 0 && <p>{t('unlinked.empty')}</p>}
        {[...groups.entries()].map(([key, rows]) => {
          const [projectId, targetLineId] = key.split('\0');
          return (
            <section key={key} class="unlinked-page__group" data-project-id={projectId} data-target-line-id={targetLineId}>
              <h3>{projectId} / {targetLineId}</h3>
              {rows.map(entry => (
                <ChangeRow
                  key={`${entry.occurrence.kind}-${entry.occurrence.change.foundAtRef}-${entry.occurrence.change.changeId}`}
                  entry={entry}
                  onAction={mode => setDialog({ entry, mode, selector })}
                />
              ))}
            </section>
          );
        })}
      </section>

      <details class="unlinked-page__linked">
        <summary>{t('unlinked.linked_title', { count: linked.length })}</summary>
        {linked.map(entry => <ChangeRow key={`${entry.occurrence.kind}-${entry.occurrence.change.changeId}`} entry={entry} onAction={() => {}} />)}
      </details>

      <section class="unlinked-page__unknown">
        <h2>{t('unlinked.unknown_title', { count: unknown.length })}</h2>
        {unknown.map(entry => <ChangeRow key={`${entry.occurrence.kind}-${entry.occurrence.change.changeId}`} entry={entry} onAction={() => {}} />)}
      </section>

      {dialog && dialog.selector === selector && (
        <LinkChangeDialog
          key={`${dialog.selector ?? ''}\0${dialog.entry.occurrence.change.changeInstanceId ?? ''}\0${dialog.mode}`}
          entry={dialog.entry}
          issues={issues?.issues ?? []}
          selector={dialog.selector}
          initialMode={dialog.mode}
          onClose={() => setDialog(null)}
          onRefresh={() => setRefreshNonce(value => value + 1)}
        />
      )}
    </div>
  );
}

/**
 * Store-only inventory: Change identity first, with explicit confirmed Issue
 * mutations. The route component itself may be reused by preact-iso when only
 * `:storeId` changes, so the selector keys the stateful child. This makes the
 * Store an immediate ownership boundary during render instead of waiting for
 * an effect to clear another Store's rows or dialog.
 */
export function UnlinkedChangesPage() {
  const selector = useSpace()?.selector;
  return <ScopedUnlinkedChangesPage key={selector ?? ''} selector={selector} />;
}
