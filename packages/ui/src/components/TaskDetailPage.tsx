import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionListEntry, TaskChildDetail, TaskDetailResponse } from '../api/types.js';
import { deriveColumn, sessionsForTask, sessionStage } from '../board/columns.js';
import type { BoardColumn } from '../board/columns.js';
import { SessionRow } from './SessionRow.js';
import { LaunchSessionDialog } from './LaunchSessionDialog.js';
import { renderInlineCode } from './ui/inline-code.js';
import { spaceHref, useSpace } from '../store/use-space.js';
import { useT } from '../i18n/store.js';

/**
 * Task detail page (ui-space-redesign-task-detail design D1/D4). The route's
 * `:changeName` param is a polymorphic Task id — a portfolio container OR a
 * bare single change — resolved server-side by `GET /api/v1/tasks/:id`. Left
 * column: the child roster (each child's lifecycle, task progress, dependency
 * hints; a single Task degrades to that one change's checklist). Right column:
 * the Task's supervised sessions, live on top, reusing `SessionRow`'s tail +
 * confirm-first kill, plus a Launch run carrying the page's space and Task
 * change context. Every read is scoped to the URL's opaque-token space.
 */

/** Lifecycle column id → its i18n key (the label renders through `t()`). */
const COLUMN_LABEL_KEYS: Record<BoardColumn, string> = {
  planning: 'board.column.planning',
  ready: 'board.column.ready',
  'in-progress': 'board.column.in_progress',
  done: 'board.column.done',
};

/** A child's lifecycle column: archived ⇒ done; otherwise the same derivation the board uses; a load-failed child has no summary → planning. */
function childColumn(child: TaskChildDetail): BoardColumn {
  if (child.archived) return 'done';
  if (child.summary) return deriveColumn(child.summary, child.run ?? undefined).column;
  return 'planning';
}

function ChildRow({ child }: { child: TaskChildDetail }) {
  const t = useT();
  const column = childColumn(child);
  const { total, completed } = child.taskProgress;
  return (
    <article class="task-detail__child" data-testid="task-detail-child" data-change={child.name}>
      <div class="task-detail__child-head">
        <span class="task-detail__child-name">{child.name}</span>
        <span class={`task-detail__child-column task-detail__child-column--${column}`}>
          {t(COLUMN_LABEL_KEYS[column])}
        </span>
        {child.archived && child.archivedAt && (
          <span class="task-detail__child-archived">{t('task_detail.child_archived', { date: child.archivedAt })}</span>
        )}
      </div>
      <div class="task-detail__child-meta">
        <span class="task-detail__child-progress">
          {total > 0 ? t('task.progress.tasks', { done: completed, total }) : t('task.progress.no_tasks')}
        </span>
        {child.dependsOn.length > 0 && (
          <span class="task-detail__child-deps" data-testid="task-detail-child-deps">
            {t('task_detail.child_deps', { deps: child.dependsOn.join(', ') })}
          </span>
        )}
      </div>
      {child.loadError && (
        <p class="task-detail__child-error" role="alert">
          {child.loadError}
        </p>
      )}
    </article>
  );
}

/**
 * A single change's task checklist as a structured card (task-detail-ui spec):
 * a progress summary header, the open (unchecked) items always listed, and the
 * completed items collapsed behind a disclosure whenever at least one is
 * complete — so a fully-done change reads as a one-line summary until expanded.
 * Task text renders backtick spans as `<code>` (no markdown library).
 */
function ChildChecklist({ child }: { child: TaskChildDetail }) {
  const t = useT();
  const [showCompleted, setShowCompleted] = useState(false);
  if (child.tasks.length === 0) {
    return <p class="task-detail__checklist-empty">{t('task_detail.checklist_empty')}</p>;
  }
  const total = child.tasks.length;
  const openItems = child.tasks.filter((task) => !task.done);
  const doneItems = child.tasks.filter((task) => task.done);
  const completed = doneItems.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div class="task-checklist" data-testid="task-detail-checklist">
      <div class="task-checklist__header">
        <span class="task-checklist__label">{t('task_detail.checklist_label')}</span>
        <span class="task-checklist__count" data-testid="task-checklist-count">
          {completed}/{total}
        </span>
      </div>
      <div
        class="task-checklist__progress"
        role="progressbar"
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div class="task-checklist__progress-fill" style={{ width: `${pct}%` }} />
      </div>

      {openItems.length > 0 && (
        <ul class="task-checklist__list" data-testid="task-checklist-open">
          {openItems.map((item, i) => (
            <li key={i} class="task-checklist__item task-checklist__item--open">
              <span class="task-checklist__box" aria-hidden="true">
                ☐
              </span>
              <span class="task-checklist__text">{renderInlineCode(item.text)}</span>
            </li>
          ))}
        </ul>
      )}

      {doneItems.length > 0 && (
        <div class="task-checklist__completed">
          <button
            type="button"
            class="task-checklist__disclosure btn--ghost"
            data-testid="task-checklist-toggle"
            aria-expanded={showCompleted}
            onClick={() => setShowCompleted((s) => !s)}
          >
            {showCompleted
              ? t('task_detail.checklist_hide', { count: completed })
              : t('task_detail.checklist_show', { count: completed })}
          </button>
          {showCompleted && (
            <ul class="task-checklist__list task-checklist__list--done" data-testid="task-checklist-completed">
              {doneItems.map((item, i) => (
                <li key={i} class="task-checklist__item task-checklist__item--done">
                  <span class="task-checklist__box" aria-hidden="true">
                    ☑
                  </span>
                  <span class="task-checklist__text">{renderInlineCode(item.text)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskDetailPage() {
  const t = useT();
  const space = useSpace();
  const selector = space?.selector;
  const { params } = useRoute();
  const taskId = params.changeName ?? '';

  const [detail, setDetail] = useState<TaskDetailResponse | null>(null);
  const [sessions, setSessions] = useState<SessionListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function load(initial: boolean) {
      if (initial) {
        setLoading(true);
        setNotFound(false);
        setPageError(null);
      }
      Promise.all([client.getTaskDetail(taskId, selector), client.listSessions(selector)])
        .then(([detailRes, sessionsRes]) => {
          if (cancelled) return;
          setDetail(detailRes);
          setSessions(sessionsRes.sessions);
          setNotFound(false);
          setPageError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError && (err.code === 'task_not_found' || err.status === 404)) {
            setNotFound(true);
            setDetail(null);
          } else if (err instanceof ApiError) {
            setPageError({ message: err.message, fix: err.fix });
          } else {
            setPageError({ message: 'status.error.task_load' });
          }
        })
        .finally(() => {
          if (!cancelled && initial) setLoading(false);
        });
    }

    load(true);
    const interval = setInterval(() => load(false), 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [taskId, selector, refreshNonce]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  const backHref = space ? spaceHref(space, 'board') : '/';

  if (loading) {
    return <p class="task-detail__loading">{t('status.loading.task')}</p>;
  }

  if (notFound) {
    return (
      <div class="task-detail__not-found" data-testid="task-detail-not-found">
        <h2>{t('task_detail.not_found_title')}</h2>
        <p>
          {t('task_detail.not_found_body_pre')}<code>{taskId}</code>{t('task_detail.not_found_body_post')}
        </p>
        <a href={backHref}>{t('task_detail.back_to_board')}</a>
      </div>
    );
  }

  if (pageError || !detail) {
    return (
      <div class="task-detail__error">
        <p>
          {t(pageError?.message ?? 'status.error.task_load')}
          {pageError?.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <button type="button" onClick={refresh}>
          {t('status.retry')}
        </button>
        <a href={backHref}>{t('task_detail.back_to_board')}</a>
      </div>
    );
  }

  const { task, children, errors } = detail;
  const isPortfolio = task.kind === 'portfolio';
  const doneCount = children.filter((c) => childColumn(c) === 'done').length;

  const childNames = new Set(children.map((c) => c.name));
  const { live, ended } = sessionsForTask(sessions, childNames);
  const ordered = [...live, ...ended];
  const liveStage = live.length > 0 ? sessionStage(live[0]!) : null;

  // A single Task's Launch run pre-fills its one change; a portfolio container
  // is not a change, so the target is left blank (open question, design).
  const launchChangeName = isPortfolio ? '' : (children[0]?.name ?? task.id);

  return (
    <div class="task-detail" data-testid="task-detail-page">
      <header class="task-detail__header">
        <a class="task-detail__back" href={backHref}>
          {t('task_detail.back')}
        </a>
        <h2 class="task-detail__title">{task.label}</h2>
        <span class="task-detail__kind">{isPortfolio ? t('task_detail.kind_portfolio') : t('task_detail.kind_change')}</span>
        {liveStage && (
          <span class="task-detail__live" data-testid="task-detail-live">
            ⦿ {liveStage}
          </span>
        )}
      </header>

      <div class="task-detail__columns">
        <section class="task-detail__children" aria-label={t('task_detail.children_label')}>
          {isPortfolio ? (
            <>
              <p class="task-detail__progress" data-testid="task-detail-progress">
                {t('task_detail.progress', { done: doneCount, total: children.length })}
              </p>
              {children.length === 0 ? (
                <p class="task-detail__children-empty">{t('task_detail.children_empty')}</p>
              ) : (
                children.map((child) => <ChildRow key={child.name} child={child} />)
              )}
              {children.every((c) => c.dependsOn.length === 0) && (
                <p class="task-detail__no-deps" data-testid="task-detail-no-deps">
                  {t('task_detail.no_deps')}
                </p>
              )}
            </>
          ) : (
            children[0] && <ChildChecklist child={children[0]} />
          )}
          {errors.length >  0 && (
            <div class="task-detail__load-errors" aria-label={t('task_detail.load_errors_label')}>
              {errors.map((e) => (
                <p key={e.name} class="task-detail__load-error" role="alert">
                  {e.name}: {e.message}
                </p>
              ))}
            </div>
          )}
        </section>

        <section class="task-detail__sessions" aria-label={t('task_detail.sessions_label')}>
          <div class="task-detail__sessions-toolbar">
            <button type="button" class="btn--primary" onClick={() => setDialogOpen(true)}>
              {t('task_detail.launch_run')}
            </button>
            <button type="button" class="btn--ghost" onClick={refresh}>
              {t('task_detail.refresh')}
            </button>
          </div>
          {ordered.length === 0 ? (
            <p class="task-detail__sessions-empty">{t('task_detail.sessions_empty')}</p>
          ) : (
            ordered.map((entry) => (
              <SessionRow key={entry.session.id} entry={entry} onKilled={() => refresh()} />
            ))
          )}
        </section>
      </div>

      {dialogOpen && (
        <LaunchSessionDialog
          space={selector}
          changeName={launchChangeName}
          onCancel={() => setDialogOpen(false)}
          onLaunched={() => {
            setDialogOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
