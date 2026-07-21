import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionListEntry, TaskChildDetail, TaskDetailResponse } from '../api/types.js';
import { BOARD_COLUMNS, deriveColumn, sessionsForTask, sessionStage } from '../board/columns.js';
import type { BoardColumn } from '../board/columns.js';
import { SessionRow } from './SessionRow.js';
import { LaunchSessionDialog } from './LaunchSessionDialog.js';
import { spaceHref, useSpace } from '../store/use-space.js';

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

const COLUMN_LABELS: Record<BoardColumn, string> = Object.fromEntries(
  BOARD_COLUMNS.map((c) => [c.id, c.label])
) as Record<BoardColumn, string>;

/** A child's lifecycle column: archived ⇒ done; otherwise the same derivation the board uses; a load-failed child has no summary → planning. */
function childColumn(child: TaskChildDetail): BoardColumn {
  if (child.archived) return 'done';
  if (child.summary) return deriveColumn(child.summary, child.run ?? undefined).column;
  return 'planning';
}

function ChildRow({ child }: { child: TaskChildDetail }) {
  const column = childColumn(child);
  const { total, completed } = child.taskProgress;
  return (
    <article class="task-detail__child" data-testid="task-detail-child" data-change={child.name}>
      <div class="task-detail__child-head">
        <span class="task-detail__child-name">{child.name}</span>
        <span class={`task-detail__child-column task-detail__child-column--${column}`}>
          {COLUMN_LABELS[column]}
        </span>
        {child.archived && child.archivedAt && (
          <span class="task-detail__child-archived">archived {child.archivedAt}</span>
        )}
      </div>
      <div class="task-detail__child-meta">
        <span class="task-detail__child-progress">
          {total > 0 ? `${completed}/${total} tasks` : 'No tasks'}
        </span>
        {child.dependsOn.length > 0 && (
          <span class="task-detail__child-deps" data-testid="task-detail-child-deps">
            depends on {child.dependsOn.join(', ')}
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

function ChildChecklist({ child }: { child: TaskChildDetail }) {
  if (child.tasks.length === 0) {
    return <p class="task-detail__checklist-empty">No tasks recorded for this change.</p>;
  }
  return (
    <ul class="task-detail__checklist" data-testid="task-detail-checklist">
      {child.tasks.map((item, i) => (
        <li key={i} class={`task-detail__task task-detail__task--${item.done ? 'done' : 'open'}`}>
          <span aria-hidden="true">{item.done ? '☑' : '☐'}</span> {item.text}
        </li>
      ))}
    </ul>
  );
}

export function TaskDetailPage() {
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
            setPageError({ message: 'Failed to load the Task.' });
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
    return <p class="task-detail__loading">Loading Task…</p>;
  }

  if (notFound) {
    return (
      <div class="task-detail__not-found" data-testid="task-detail-not-found">
        <h2>Task not found</h2>
        <p>
          No Task named <code>{taskId}</code> in this space.
        </p>
        <a href={backHref}>← Back to board</a>
      </div>
    );
  }

  if (pageError || !detail) {
    return (
      <div class="task-detail__error">
        <p>
          {pageError?.message ?? 'Failed to load the Task.'}
          {pageError?.fix ? ` — ${pageError.fix}` : ''}
        </p>
        <button type="button" onClick={refresh}>
          Retry
        </button>
        <a href={backHref}>← Back to board</a>
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
          ← Board
        </a>
        <h2 class="task-detail__title">{task.label}</h2>
        <span class="task-detail__kind">{isPortfolio ? 'Portfolio' : 'Change'}</span>
        {liveStage && (
          <span class="task-detail__live" data-testid="task-detail-live">
            ⦿ {liveStage}
          </span>
        )}
      </header>

      <div class="task-detail__columns">
        <section class="task-detail__children" aria-label="Children">
          {isPortfolio ? (
            <>
              <p class="task-detail__progress" data-testid="task-detail-progress">
                {doneCount}/{children.length} changes
              </p>
              {children.length === 0 ? (
                <p class="task-detail__children-empty">This portfolio has no changes yet.</p>
              ) : (
                children.map((child) => <ChildRow key={child.name} child={child} />)
              )}
              {children.every((c) => c.dependsOn.length === 0) && (
                <p class="task-detail__no-deps" data-testid="task-detail-no-deps">
                  No declared dependencies.
                </p>
              )}
            </>
          ) : (
            children[0] && <ChildChecklist child={children[0]} />
          )}
          {errors.length > 0 && (
            <div class="task-detail__load-errors" aria-label="Children that failed to load">
              {errors.map((e) => (
                <p key={e.name} class="task-detail__load-error" role="alert">
                  {e.name}: {e.message}
                </p>
              ))}
            </div>
          )}
        </section>

        <section class="task-detail__sessions" aria-label="Sessions">
          <div class="task-detail__sessions-toolbar">
            <button type="button" onClick={() => setDialogOpen(true)}>
              Launch run
            </button>
            <button type="button" onClick={refresh}>
              Refresh
            </button>
          </div>
          {ordered.length === 0 ? (
            <p class="task-detail__sessions-empty">No sessions for this Task.</p>
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
