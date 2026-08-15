import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { StoreChangeGroup } from '../api/types.js';
import { PageHeader } from './ui/PageHeader.js';
import { useSpace } from '../store/use-space.js';
import { useT } from '../i18n/store.js';

/**
 * The Store aggregate board (`store-issue-resources` board-ui spec,
 * requirement "A layout v2 Store board groups its changes by project and
 * target line"). `StoreAggregateQuery.listChanges` already groups by project
 * AND target line (`GroupedChanges.groups`), so this component renders every
 * group the server returns verbatim: the same Change alias appearing under
 * two projects is naturally two board entries (two groups, one row each),
 * and a group with zero active/archived Changes is rendered as an explicit
 * empty group rather than filtered out of the list.
 *
 * Deliberately read-only: no mutation surface exists on the Change resource
 * in this change's scope, so requirement 3 ("An aggregate view never submits
 * a mutation with an incomplete scope") is vacuously satisfied here — the
 * scope-guarded mutation form lives on {@link StoreIssuesView} instead, where
 * the actual Store-level mutation surface (Issue create/state/plan-publish)
 * is.
 */
export function StoreAggregateBoard() {
  const t = useT();
  const space = useSpace();
  const selector = space?.selector;
  const [groups, setGroups] = useState<StoreChangeGroup[] | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    client
      .getStoreChanges(selector)
      .then((res) => {
        if (cancelled) return;
        setGroups([...res.groups]);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'store_board.error.load' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, selector]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p class="store-board__loading">{t('store_board.loading')}</p>;
  }

  if (pageError) {
    return (
      <div class="store-board__error" data-testid="store-board-error">
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

  if (!groups || groups.length === 0) {
    return (
      <div class="store-board__empty" data-testid="store-board-empty">
        <h2>{t('store_board.title')}</h2>
        <p>{t('store_board.empty')}</p>
      </div>
    );
  }

  return (
    <div class="store-board" data-testid="store-board">
      <PageHeader
        title={t('store_board.title')}
        actions={
          <button type="button" class="btn--ghost" onClick={refresh} data-testid="store-board-refresh">
            {t('store_board.refresh')}
          </button>
        }
      />
      <ul class="store-board__groups" data-testid="store-board-groups">
        {groups.map((group) => {
          const groupIsEmpty = group.active.length === 0 && group.archived.length === 0;
          return (
            <li
              key={`${group.projectId}::${group.targetLineId}`}
              class="store-board__group"
              data-testid="store-board-group"
              data-project={group.projectId}
              data-target-line={group.targetLineId}
            >
              <h3 class="store-board__group-title">
                {group.projectId} / {group.targetLineId}
              </h3>
              {groupIsEmpty ? (
                <p class="store-board__group-empty" data-testid="store-board-group-empty">
                  {t('store_board.group_empty')}
                </p>
              ) : (
                <>
                  <ul class="store-board__active" data-testid="store-board-active">
                    {group.active.map((entry, i) => (
                      <li
                        key={`${entry.changeId}-${i}`}
                        class="store-board__entry"
                        data-testid="store-board-entry"
                        data-change={entry.changeId}
                      >
                        {entry.changeId}
                      </li>
                    ))}
                  </ul>
                  {group.archived.length > 0 && (
                    <ul class="store-board__archived" data-testid="store-board-archived">
                      {group.archived.map((entry, i) => (
                        <li
                          key={`${entry.changeId}-${i}`}
                          class="store-board__entry store-board__entry--archived"
                          data-testid="store-board-archived-entry"
                          data-change={entry.changeId}
                        >
                          {entry.changeId}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
