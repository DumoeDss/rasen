import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SessionRecordWire, SpaceMember } from '../api/types.js';
import { useT } from '../i18n/store.js';

type ExecutionValue = '' | 'planning' | `project:${string}`;
type ExecutionSelection = {
  value: ExecutionValue;
  source: 'auto' | 'user';
};

/** A member with a checkout on this machine — the only kind that can be executed in. */
type LaunchableMember = SpaceMember & { root: string };

/**
 * A store may record a member whose checkout does not exist on this machine
 * (`store-project-membership`): it is listed with identity and name and NO
 * root. Such a member cannot be an execution target — `project:${undefined}`
 * is a selector the server rejects as `invalid_space` — so it is offered as a
 * disabled option rather than as a choice that always fails.
 */
function isLaunchable(member: SpaceMember): member is LaunchableMember {
  return typeof member.root === 'string' && member.root.length > 0;
}

function launchableMembers(members: readonly SpaceMember[]): LaunchableMember[] {
  return members.filter(isLaunchable);
}

function automaticExecutionSelection(members: readonly SpaceMember[]): ExecutionSelection {
  const launchable = launchableMembers(members);
  return {
    value: launchable.length === 1 ? `project:${launchable[0]!.root}` : '',
    source: 'auto',
  };
}

function reconcileExecutionSelection(
  current: ExecutionSelection,
  members: readonly SpaceMember[]
): ExecutionSelection {
  if (current.source === 'user' && current.value === 'planning') return current;
  if (
    current.source === 'user' &&
    current.value !== '' &&
    launchableMembers(members).some((member) => current.value === `project:${member.root}`)
  ) {
    return current;
  }
  return automaticExecutionSelection(members);
}

/**
 * Launch flow (design.md D4 of `slice3-sessions-ui`): kind + task + optional
 * changeName, submitted through the single `client.launchSession` seam
 * (NewChangeDialog's conventions: overlay, disabled-while-submitting,
 * verbatim server error). Client-side validation is minimal — non-empty
 * task — the server is the authoritative validator (400/409/503 envelopes
 * surface verbatim, including `agent_cli_unavailable`/`busy`). The board's
 * own new-change dialog is untouched: creating a change and launching a
 * supervised run are different speech acts on different endpoints.
 */
export function LaunchSessionDialog({
  onCancel,
  onLaunched,
  space,
  members,
  memberInventoryStatus,
  onRetryMemberInventory,
  changeName: changeNamePrefill,
}: {
  onCancel: () => void;
  onLaunched: (session: SessionRecordWire) => void;
  /** Optional planning-space selector; the launched run is attributed to it (design D4). */
  space?: string;
  /** Store-only presentation choices. Undefined preserves the project launch path; an empty array is a zero-member Store. */
  members?: readonly SpaceMember[];
  /** Store inventory transport state, independent from the last successful member list. */
  memberInventoryStatus?: 'loading' | 'loaded' | 'error';
  /** Re-fetches Store inventory without closing the launch dialog. */
  onRetryMemberInventory?: () => void;
  /** Optional change-name prefill — a single Task's change (blank for a portfolio container). */
  changeName?: string;
}) {
  const [kind, setKind] = useState<'auto' | 'goal'>('auto');
  const [task, setTask] = useState('');
  const [changeName, setChangeName] = useState(changeNamePrefill ?? '');
  const [executionSelection, setExecutionSelection] = useState<ExecutionSelection>(
    members === undefined
      ? { value: '', source: 'auto' }
      : automaticExecutionSelection(members)
  );
  // Inventory polling can commit new props before passive effects run. Derive
  // the value used by the rendered controls and submit handler synchronously,
  // so an automatic or removed project is never actionable during that gap.
  const effectiveExecutionSelection =
    members === undefined
      ? executionSelection
      : reconcileExecutionSelection(executionSelection, members);
  const execution = effectiveExecutionSelection.value;
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const t = useT();
  const effectiveInventoryStatus =
    members === undefined ? undefined : (memberInventoryStatus ?? 'loaded');

  useEffect(() => {
    if (members === undefined) return;
    setExecutionSelection((current) => {
      const reconciled = reconcileExecutionSelection(current, members);
      return current.source === reconciled.source && current.value === reconciled.value
        ? current
        : reconciled;
    });
  }, [members]);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    if (task.trim().length === 0) {
      setErrorMessage('dialog.launch.task_required');
      return;
    }
    if (members !== undefined && execution === '') {
      setErrorMessage('dialog.launch.execution_required');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await client.launchSession({
        kind,
        task,
        changeName: changeName.trim().length > 0 ? changeName.trim() : undefined,
        ...(space !== undefined ? { space } : {}),
        ...(execution !== '' ? { execution } : {}),
      });
      onLaunched(result.session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      // Authored fallback stored as an i18n KEY; rendered through `t()` (a
      // server ApiError.message passes through unchanged).
      setErrorMessage(err instanceof ApiError ? err.message : 'status.error.session_launch');
    }
  }

  return (
    <div class="launch-session-dialog__overlay">
      <form class="launch-session-dialog" onSubmit={handleSubmit} aria-label={t('dialog.launch.aria')}>
        <h2 class="launch-session-dialog__title">{t('dialog.launch.title')}</h2>
        <fieldset class="launch-session-dialog__field launch-session-dialog__kind" disabled={submitting}>
          <legend>{t('dialog.launch.kind')}</legend>
          <label>
            <input
              type="radio"
              name="kind"
              value="auto"
              checked={kind === 'auto'}
              onChange={() => setKind('auto')}
            />
            {t('dialog.launch.kind_auto')}
          </label>
          <label>
            <input
              type="radio"
              name="kind"
              value="goal"
              checked={kind === 'goal'}
              onChange={() => setKind('goal')}
            />
            {t('dialog.launch.kind_goal')}
          </label>
        </fieldset>
        {members !== undefined && (
          <fieldset class="launch-session-dialog__field launch-session-dialog__execution" disabled={submitting}>
            <legend>{t('dialog.launch.execution')}</legend>
            <small class="launch-session-dialog__hint">{t('dialog.launch.execution_hint')}</small>
            {effectiveInventoryStatus === 'loading' && members.length === 0 && (
              <p class="launch-session-dialog__inventory-loading">
                {t('dialog.launch.members_loading')}
              </p>
            )}
            {effectiveInventoryStatus === 'error' && (
              <div class="launch-session-dialog__inventory-error" role="alert">
                <span>{t('dialog.launch.members_error')}</span>
                {onRetryMemberInventory && (
                  <button type="button" class="btn--ghost" onClick={onRetryMemberInventory}>
                    {t('status.retry')}
                  </button>
                )}
              </div>
            )}
            {effectiveInventoryStatus === 'loaded' && members.length === 0 && (
              <p class="launch-session-dialog__execution-empty">{t('dialog.launch.members_empty')}</p>
            )}
            {members.map((member) => {
              // A member with no checkout here is listed (it IS a member) but
              // cannot be selected: the resulting `project:undefined` selector
              // is rejected by the server, so offering it would be offering a
              // choice that can only fail.
              if (!isLaunchable(member)) {
                return (
                  <label key={member.projectId} aria-disabled="true">
                    <input type="radio" name="execution" value="" disabled checked={false} />
                    <span>
                      <strong>{member.name}</strong>
                      <small>{member.projectId}</small>
                    </span>
                  </label>
                );
              }
              const value = `project:${member.root}` as const;
              return (
                <label key={member.root}>
                  <input
                    type="radio"
                    name="execution"
                    value={value}
                    checked={execution === value}
                    onChange={() => setExecutionSelection({ value, source: 'user' })}
                  />
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.root}</small>
                  </span>
                </label>
              );
            })}
            <label class="launch-session-dialog__planning-only">
              <input
                type="radio"
                name="execution"
                value="planning"
                checked={execution === 'planning'}
                onChange={() => setExecutionSelection({ value: 'planning', source: 'user' })}
              />
              <span>
                <strong>{t('dialog.launch.planning')}</strong>
                <small>{t('dialog.launch.planning_hint')}</small>
              </span>
            </label>
          </fieldset>
        )}
        <label class="launch-session-dialog__field">
          <span>{t('dialog.launch.task')}</span>
          <textarea
            name="task"
            value={task}
            disabled={submitting}
            required
            rows={4}
            onInput={(e) => setTask((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <label class="launch-session-dialog__field">
          <span>{t('dialog.launch.change_name')}</span>
          <input
            type="text"
            name="changeName"
            value={changeName}
            disabled={submitting}
            onInput={(e) => setChangeName((e.target as HTMLInputElement).value)}
          />
          <small class="launch-session-dialog__hint">{t('dialog.launch.hint')}</small>
        </label>
        {errorMessage && (
          <p class="launch-session-dialog__error" role="alert">
            {t(errorMessage)}
          </p>
        )}
        <div class="launch-session-dialog__actions">
          <button type="button" class="btn--ghost" onClick={onCancel} disabled={submitting}>
            {t('dialog.launch.cancel')}
          </button>
          <button
            type="submit"
            class="btn--primary"
            disabled={submitting || (members !== undefined && execution === '')}
          >
            {submitting ? t('dialog.launch.launching') : t('dialog.launch.launch')}
          </button>
        </div>
      </form>
    </div>
  );
}
