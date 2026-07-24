import { Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  StoreLayerRef,
  WireConfigEntry,
  WireProfileEntry,
  WorkflowEnablementResponse,
} from '../api/types.js';
import { tabbedEntries } from '../config/grouping.js';
import type { ConfigMode } from '../config/controls.js';
import { useSpace, type Space } from '../store/use-space.js';
import { useNavigationGuard } from '../store/use-navigation-guard.js';
import { ConfigEntryRow } from './ConfigEntryRow.js';
import { PageHeader } from './ui/PageHeader.js';
import { TelemetryDisclosure } from './TelemetryDisclosure.js';

/** A pending navigation blocked by an unapplied profile draft (design D5). */
type PendingLeave =
  | { kind: 'mode'; mode: ConfigMode }
  | { kind: 'tab'; tab: string }
  | { kind: 'route'; href: string };

/** The synthetic select value that displays a space's own workflow-selection override honestly (design D4). */
const OVERRIDE_SELECT_VALUE = '__override__';

/**
 * The config page (design D1/D2/D7): one space-addressed `listConfig` call
 * renders the whole page for either space type — a project space edits its
 * project layer, a store space edits the store's own values (the deferred stub
 * is gone). A page-level Global / Local segmented control is both the write
 * target and the visibility filter; keys are organized into scope-filtered
 * tabs; each row shows its layer transparency (inherited-from / shadowed
 * lines) and, for store-inherited keys, an edit-in-store link.
 */
export function ConfigPage() {
  const space = useSpace();
  const [entries, setEntries] = useState<WireConfigEntry[] | null>(null);
  const [storeRef, setStoreRef] = useState<StoreLayerRef | null>(null);
  const [pageError, setPageError] = useState<{ message: string; fix?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  // Default Global (ui-profile-workflow-split config-ui-package spec): entering
  // Config lands on the machine-wide configuration; the space's own scope is one
  // click away. (Previously defaulted to Local.)
  const [mode, setMode] = useState<ConfigMode>('global');
  const [activeTab, setActiveTab] = useState<string | null>(null);
  // Unapplied profile-draft state lifted from the SpaceProfileSelector (design
  // D5): while dirty, switching mode/tab or leaving the route asks first.
  const [profileDirty, setProfileDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);

  const { route } = useLocation();

  const selector = space?.selector;
  const spaceType = space?.type ?? 'project';

  useEffect(() => {
    if (!selector) {
      setEntries(null);
      setStoreRef(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    client
      .listConfig(selector)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setStoreRef(res.store);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setPageError({ message: err.message, fix: err.fix });
        } else {
          setPageError({ message: 'Failed to load configuration' });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selector]);

  function updateEntry(updated: WireConfigEntry) {
    setEntries((current) =>
      current
        ? current.map((e) => (e.definition.key === updated.definition.key ? updated : e))
        : current
    );
  }

  // Route-leave guard (design D5): while a profile draft is unapplied, an in-app
  // navigation click is intercepted and staged as a pending leave rather than
  // navigating; the confirm dialog below resolves it.
  useNavigationGuard(profileDirty, (href) => setPendingLeave({ kind: 'route', href }));

  if (loading) {
    return <p>Loading configuration…</p>;
  }

  const tabs = entries ? tabbedEntries(entries, mode, spaceType) : [];
  // The active tab is derived with a fallback so a mode switch that empties the
  // selected tab (e.g. Privacy in Local mode) lands on the first available tab
  // rather than a blank page — no reload, per the spec.
  const currentTab = tabs.find((t) => t.tab === activeTab) ?? tabs[0];

  // Mode/tab switches route through a dirty check (design D5): with an
  // unapplied profile draft they stage a pending leave (confirm dialog) instead
  // of switching; the SpaceProfileSelector unmounts on any such switch, so
  // discarding is simply proceeding — the draft evaporates with the component.
  function requestMode(next: ConfigMode) {
    if (next === mode) return;
    if (profileDirty) {
      setPendingLeave({ kind: 'mode', mode: next });
      return;
    }
    setMode(next);
  }
  function requestTab(next: string) {
    if (next === currentTab?.tab) return;
    if (profileDirty) {
      setPendingLeave({ kind: 'tab', tab: next });
      return;
    }
    setActiveTab(next);
  }
  function confirmLeave() {
    const action = pendingLeave;
    setPendingLeave(null);
    setProfileDirty(false);
    if (!action) return;
    if (action.kind === 'mode') setMode(action.mode);
    else if (action.kind === 'tab') setActiveTab(action.tab);
    else route(action.href);
  }

  return (
    <div>
      {pageError && (
        <p class="config-page__error">
          {pageError.message}
          {pageError.fix ? ` — ${pageError.fix}` : ''} Use the space switcher above.
        </p>
      )}

      <PageHeader
        title="Configuration"
        actions={
          <div class="config-page__mode" role="group" aria-label="Configuration scope" data-testid="config-mode">
            <button
              type="button"
              class={`member-chip${mode === 'global' ? ' member-chip--selected' : ''}`}
              aria-pressed={mode === 'global'}
              onClick={() => requestMode('global')}
            >
              Global
            </button>
            <button
              type="button"
              class={`member-chip${mode === 'local' ? ' member-chip--selected' : ''}`}
              aria-pressed={mode === 'local'}
              onClick={() => requestMode('local')}
            >
              Local
            </button>
          </div>
        }
      />

      {tabs.length > 0 && (
        <div class="config-page__tabs" role="tablist" aria-label="Configuration sections" data-testid="config-tabs">
          {tabs.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              class={`member-chip${currentTab?.tab === t.tab ? ' member-chip--selected' : ''}`}
              aria-selected={currentTab?.tab === t.tab}
              onClick={() => requestTab(t.tab)}
            >
              {t.tab}
            </button>
          ))}
        </div>
      )}

      {mode === 'local' && spaceType === 'project' && currentTab?.tab === 'Project' && space && (
        <SpaceProfileSelector space={space} onDirtyChange={setProfileDirty} />
      )}

      {currentTab?.groups.map((group) => (
        <section key={group.group} class="config-group">
          <h2>{group.group}</h2>
          {group.entries.map((entry) => (
            // A keyed Fragment (no wrapping DOM node) keeps every `.config-entry`
            // a DIRECT child of `.config-group`, so `.config-entry:first-of-type`
            // (style.css) still strips the top border/padding from only the first
            // row of the group rather than from every row.
            <Fragment key={entry.definition.key}>
              <ConfigEntryRow
                entry={entry}
                mode={mode}
                spaceType={spaceType}
                spaceSelector={selector ?? ''}
                storeRef={storeRef}
                onPageError={(message, fix) => setPageError({ message, fix })}
                onEntryUpdated={updateEntry}
              />
              {entry.definition.key === 'telemetry.enabled' && <TelemetryDisclosure />}
            </Fragment>
          ))}
        </section>
      ))}

      {pendingLeave && (
        <div class="workflow-dialog__overlay" data-testid="config-leave-dialog">
          <div class="workflow-dialog" role="dialog" aria-label="Discard profile draft">
            <h3 class="workflow-dialog__title">Discard unapplied profile change?</h3>
            <p>
              You picked a profile for this space but haven’t applied it. Leaving now discards that
              draft — nothing is installed or removed.
            </p>
            <div class="workflow-dialog__dismiss">
              <button type="button" data-testid="config-leave-discard" onClick={confirmLeave}>
                Discard draft
              </button>
              <button
                type="button"
                class="btn--ghost"
                data-testid="config-leave-stay"
                onClick={() => setPendingLeave(null)}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function cliMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The Local Project tab's Profile selector (config-ui-package spec "The Local
 * Project tab selects the space's workflow profile", design D7). It resolves the
 * space's absolute root from the spaces listing, reads the enablement state
 * (governing mode + locked profile) and the available profiles, and performs the
 * REAL switch through the enablement API: picking a profile writes the space's
 * profile lock and applies it (install/remove), "Follow global profile" clears
 * the lock. When the space carries its own selection override, switching to a
 * profile requires an explicit confirmation (it replaces the override, D4), and
 * the existing reset-to-profile affordance is offered. A switch is single-flight;
 * an apply failure surfaces the CLI's message with the actual post-write state.
 */
function SpaceProfileSelector({
  space,
  onDirtyChange,
}: {
  space: Space;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [root, setRoot] = useState<string | null>(null);
  const [rootResolved, setRootResolved] = useState(false);
  const [enablement, setEnablement] = useState<WorkflowEnablementResponse | null>(null);
  const [profiles, setProfiles] = useState<WireProfileEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);
  // Draft (design D5): a pick only stages `draftPick`; nothing mutates until
  // Update. `null` means no draft — the applied state governs the control.
  const [draftPick, setDraftPick] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  // Follow-global from override mode removes the space's own selection — a
  // distinct confirm from the replace-with-a-profile one (M1).
  const [confirmingFollowGlobal, setConfirmingFollowGlobal] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);

  // Resolve the space's absolute root from the spaces listing (the same
  // client-side join the Workflows page used): enablement addresses a concrete
  // filesystem root, not the `<type>:<id>` selector.
  useEffect(() => {
    let cancelled = false;
    setRootResolved(false);
    client
      .listSpaces()
      .then((res) => {
        if (cancelled) return;
        const match = res.spaces.find((s) => s.type === 'project' && s.id === space.id);
        setRoot(match && match.type === 'project' ? match.root : null);
      })
      .catch(() => {
        if (!cancelled) setRoot(null);
      })
      .finally(() => {
        if (!cancelled) setRootResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [space.id]);

  useEffect(() => {
    if (!root) return;
    let cancelled = false;
    setLoadError(null);
    setMutateError(null);
    setDraftPick(null);
    setConfirmingReplace(false);
    setConfirmingFollowGlobal(false);
    setResetConfirming(false);
    Promise.all([client.getWorkflowEnablement(root), client.listProfiles()])
      .then(([en, profs]) => {
        if (cancelled) return;
        setEnablement(en);
        setProfiles(profs.profiles);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(cliMessage(err, 'Failed to load this space’s profile state.'));
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  // The applied state as a select value: '' = follow the user-wide profile, a
  // lock name when locked, or the override sentinel when the space carries its
  // own selection (design D4/D5).
  const applied =
    enablement?.mode === 'locked-profile'
      ? enablement.lockedProfile ?? ''
      : enablement?.mode === 'override'
        ? OVERRIDE_SELECT_VALUE
        : '';
  const selected = draftPick ?? applied;
  const dirty = draftPick !== null && draftPick !== applied;

  // Report dirtiness up so ConfigPage can guard mode/tab/route changes; always
  // report clean on unmount (a mode/tab switch unmounts this and discards the
  // draft, so the lifted flag must not linger).
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyChange(false), []);

  async function mutate(
    body:
      | { root: string; op: 'set-profile'; profile: string }
      | { root: string; op: 'clear-profile' }
      | { root: string; op: 'follow-global' }
      | { root: string; op: 'reset' }
  ) {
    if (mutating) return;
    setMutating(true);
    setMutateError(null);
    try {
      const res = await client.mutateWorkflowEnablement(body);
      setEnablement(res);
      setDraftPick(null);
      setConfirmingReplace(false);
      setConfirmingFollowGlobal(false);
      setResetConfirming(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setMutateError(cliMessage(err, 'Failed to switch this space’s profile.'));
      if (err instanceof ApiError && err.state) setEnablement(err.state as WorkflowEnablementResponse);
    } finally {
      setMutating(false);
    }
  }

  // A pick only stages the draft — no write, no apply (design D5).
  function onPick(value: string) {
    setMutateError(null);
    setDraftPick(value);
  }

  // The explicit Update performs the real switch. Over an existing override the
  // replace-confirmation is folded in here (design D4/D5), not at pick time.
  function onUpdate() {
    if (!dirty || mutating || !root || draftPick === null) return;
    if (draftPick === '') {
      // Follow global. From override mode, clearing the lock alone is a no-op
      // (the override still governs) — confirm and clear BOTH layers (M1). From
      // a lock, clearing the lock is the correct, non-destructive action.
      if (applied === OVERRIDE_SELECT_VALUE) {
        setConfirmingFollowGlobal(true);
        return;
      }
      mutate({ root, op: 'clear-profile' });
      return;
    }
    if (applied === OVERRIDE_SELECT_VALUE) {
      setConfirmingReplace(true);
      return;
    }
    mutate({ root, op: 'set-profile', profile: draftPick });
  }

  // Store spaces never render this (guarded by the caller); a project root that
  // could not be resolved is a load error, not a silent omission.
  if (rootResolved && !root) {
    return (
      <div class="config-profile" data-testid="config-profile-selector">
        <p class="config-profile__error" role="alert" data-testid="config-profile-error">
          Could not resolve this space’s filesystem root.
        </p>
      </div>
    );
  }

  const builtIns = (profiles ?? []).filter((p) => p.builtIn);
  // Spec: the selector offers EVERY saved profile. A broken file is still listed
  // (annotated + non-selectable) rather than silently omitted — set-profile
  // would refuse it at validation anyway, but the user must see it exists.
  const saved = (profiles ?? []).filter((p) => !p.builtIn);
  // The staged profile's human label for the unapplied-change reminder.
  const draftLabel = draftPick === '' ? 'Follow global profile' : draftPick;

  return (
    <section class="config-profile" data-testid="config-profile-selector">
      <h2>Profile</h2>
      <p class="config-profile__hint">
        Switch this space to a named profile — installing and removing workflows to match. Manage the profiles
        themselves on the Profiles page.
      </p>

      {loadError && (
        <p class="config-profile__error" role="alert" data-testid="config-profile-error">{loadError}</p>
      )}

      <label class="config-profile__picker">
        <span>Space profile</span>
        <select
          data-testid="config-profile-picker"
          value={selected}
          disabled={mutating || !enablement}
          onChange={(e) => onPick((e.target as HTMLSelectElement).value)}
        >
          <option value="">Follow global profile</option>
          {applied === OVERRIDE_SELECT_VALUE && (
            // The space's own selection has no dropdown referent — surface it
            // honestly as the current, non-selectable state (design D4).
            <option value={OVERRIDE_SELECT_VALUE} disabled>
              custom (this space’s own selection)
            </option>
          )}
          {builtIns.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
          {saved.map((p) => (
            <option key={p.name} value={p.name} disabled={p.error !== undefined}>
              {p.name}{p.error !== undefined ? ' (broken)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          class="btn--primary"
          data-testid="config-profile-update"
          disabled={!dirty || mutating || !root}
          onClick={onUpdate}
        >
          {mutating ? 'Updating…' : 'Update'}
        </button>
      </label>

      {dirty && (
        <p class="config-profile__reminder" role="status" data-testid="config-profile-reminder">
          Profile changed to <strong>{draftLabel}</strong> — not applied yet. Click Update to install/remove
          workflows.
        </p>
      )}

      {enablement && (
        <p class="config-profile__mode-text" data-testid="config-profile-mode">
          {enablement.mode === 'locked-profile'
            ? `Locked to profile "${enablement.lockedProfile}".`
            : enablement.mode === 'override'
              ? 'This space uses its own workflow selection.'
              : 'This space follows the user-wide profile.'}
        </p>
      )}

      {enablement?.mode === 'override' && (
        <div class="config-profile__override" data-testid="config-profile-override">
          {!resetConfirming ? (
            <button
              type="button"
              data-testid="config-profile-reset"
              disabled={mutating}
              onClick={() => setResetConfirming(true)}
            >
              Reset to profile
            </button>
          ) : (
            <span class="config-profile__confirm">
              Discard this space’s own selection and follow the user-wide profile?
              <button
                type="button"
                data-testid="config-profile-reset-confirm"
                disabled={mutating}
                onClick={() => root && mutate({ root, op: 'reset' })}
              >
                {mutating ? 'Resetting…' : 'Yes, reset'}
              </button>
              <button type="button" disabled={mutating} onClick={() => setResetConfirming(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      )}

      {confirmingReplace && draftPick && draftPick !== '' && (
        <div class="config-profile__confirm-replace" data-testid="config-profile-confirm">
          <p>
            This space uses its own workflow selection. Switching to <strong>{draftPick}</strong> will replace it.
          </p>
          <button
            type="button"
            data-testid="config-profile-confirm-yes"
            disabled={mutating}
            onClick={() => root && mutate({ root, op: 'set-profile', profile: draftPick })}
          >
            {mutating ? 'Switching…' : 'Replace and switch'}
          </button>
          <button type="button" disabled={mutating} onClick={() => setConfirmingReplace(false)}>
            Cancel
          </button>
        </div>
      )}

      {confirmingFollowGlobal && (
        <div class="config-profile__confirm-replace" data-testid="config-profile-follow-global-confirm">
          <p>
            This space will follow the global profile. Its own workflow selection will be removed.
          </p>
          <button
            type="button"
            data-testid="config-profile-follow-global-yes"
            disabled={mutating}
            onClick={() => root && mutate({ root, op: 'follow-global' })}
          >
            {mutating ? 'Switching…' : 'Follow global profile'}
          </button>
          <button type="button" disabled={mutating} onClick={() => setConfirmingFollowGlobal(false)}>
            Cancel
          </button>
        </div>
      )}

      {mutateError && (
        <p class="config-profile__error" role="alert" data-testid="config-profile-mutate-error">{mutateError}</p>
      )}
    </section>
  );
}
