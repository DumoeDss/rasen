import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import { PageHeader } from './ui/PageHeader.js';
import { WorkflowSection, type ToggleContext } from './workflow-cards.js';
import type {
  ProfileListResponse,
  WireProfileEntry,
  WorkflowListEntry,
  WorkflowListResponse,
} from '../api/types.js';

/**
 * The Profiles page (profiles-ui spec). A space-agnostic `/profiles` route that
 * manages named workflow profiles — the *lists* of workflows a space can be
 * switched to, NOT installation. It reuses the Workflows page's shared
 * sectioned-card presentation (`workflow-cards.tsx`), but the corner switch
 * edits a profile's draft membership rather than a space's enablement. Built-in
 * `full`/`core` are viewable read-only (inert switches showing membership) with
 * a duplicate-to-edit path; saved profiles are editable as a draft (dirty +
 * Save/Discard). Actually switching a space to a profile happens on that space's
 * Config → Local → Project tab (space-workflow-enablement) — this page never
 * installs or uninstalls anything and says so.
 */

/** The reserved/built-in names and the CLI's name pattern, mirrored for immediate client-side feedback (server authoritative). */
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESERVED_NAMES = new Set(['full', 'core', 'custom']);

function validateProfileName(name: string): string | null {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    return 'Use 1–64 chars: start with a lowercase letter or digit, then lowercase letters, digits, dots, underscores, or hyphens.';
  }
  if (RESERVED_NAMES.has(name)) return `"${name}" is a reserved name.`;
  return null;
}

export function ProfilesPage() {
  const [profilesData, setProfilesData] = useState<ProfileListResponse | null>(null);
  const [workflowsData, setWorkflowsData] = useState<WorkflowListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  // The editable draft membership for the selected saved profile, plus the
  // stored baseline it was seeded from (for dirty tracking + Discard).
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [stored, setStored] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set true after a successful save, cleared on any new edit / selection change,
  // so the page can state the save's consequence (locked spaces apply on their
  // next apply — profiles-ui spec "Saving a profile does not re-apply locked
  // spaces", design D5).
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPageError(null);
    Promise.all([client.listProfiles(), client.listWorkflows()])
      .then(([profiles, workflows]) => {
        if (cancelled) return;
        setProfilesData(profiles);
        setWorkflowsData(workflows);
      })
      .catch((err) => {
        if (cancelled) return;
        setPageError(err instanceof ApiError ? err.message : 'Failed to load profiles.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  const profiles = profilesData?.profiles ?? [];
  const selected = profiles.find((p) => p.name === selectedName) ?? null;

  // Seed the draft whenever the selection OR its stored membership changes, so
  // the switches reflect the stored definition — and, after a save patches the
  // listing in place, the server's normalized definition (closure snap-back,
  // design D5). Idempotent when save already set draft/stored to the same set.
  useEffect(() => {
    const members = new Set(selected?.workflows ?? []);
    setDraft(members);
    setStored(members);
  }, [selected?.name, selected?.workflows]);

  // Clear the transient per-selection state (save error, just-saved note) ONLY
  // when the selected profile itself changes — NOT when a save patches the
  // current profile's membership in place (that must keep the note visible).
  useEffect(() => {
    setSaveError(null);
    setJustSaved(false);
  }, [selected?.name]);

  function refresh() {
    setRefreshNonce((n) => n + 1);
  }

  if (loading) {
    return <p class="profiles-page__loading" data-testid="profiles-loading">Loading profiles…</p>;
  }
  if (pageError) {
    return (
      <div class="profiles-page__error" data-testid="profiles-error">
        <p>{pageError}</p>
        <button type="button" onClick={refresh}>Retry</button>
      </div>
    );
  }

  const workflows = workflowsData?.workflows ?? [];
  const editable = selected !== null && !selected.builtIn && selected.error === undefined;
  const dirty = editable && !setsEqual(draft, stored);

  const toggle: ToggleContext | undefined = selected
    ? {
        // Built-ins (and broken files) render inert switches that still show
        // membership; a saved profile's switches edit the draft.
        stateFor: (id) => ({
          checked: (editable ? draft : stored).has(id),
          disabled: !editable || saving,
        }),
        onToggle: (id, checked) => {
          if (!editable) return;
          setJustSaved(false);
          setDraft((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          });
        },
      }
    : undefined;

  async function save() {
    if (!selected || !editable || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = (await client.mutateProfile({
        op: 'update',
        name: selected.name,
        workflows: [...draft],
      })) as { profile: WireProfileEntry };
      // Re-seed from the normalized definition so a closure-re-added workflow
      // snaps back ON visibly (design D5).
      const normalizedList = res.profile.workflows ?? [];
      const normalized = new Set(normalizedList);
      setStored(normalized);
      setDraft(normalized);
      setJustSaved(true);
      // Keep the in-memory listing authoritative WITHOUT a full re-fetch: patch
      // the saved profile's entry with the normalized membership. Otherwise
      // `profilesData` stays at the pre-save snapshot, and switching away and
      // back (or Duplicate/create seeding, which read `selected.workflows`)
      // would re-seed from the stale list and silently revert the save.
      setProfilesData((prev) =>
        prev
          ? {
              profiles: prev.profiles.map((p) =>
                p.name === selected.name ? { ...p, workflows: normalizedList } : p
              ),
            }
          : prev
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSaveError(err instanceof ApiError ? err.message : 'Failed to save the profile.');
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(new Set(stored));
    setSaveError(null);
    setJustSaved(false);
  }

  return (
    <div class="profiles-page" data-testid="profiles-page">
      <PageHeader
        title="Profiles"
        actions={
          <>
            <button
              type="button"
              class="btn--primary"
              data-testid="profile-new"
              onClick={() => setDialog({ kind: 'create', seedFrom: selectedName })}
            >
              New profile
            </button>
            <button
              type="button"
              class="btn--ghost"
              data-testid="profiles-refresh"
              disabled={dirty}
              title={dirty ? 'Save or discard your changes before refreshing' : undefined}
              onClick={refresh}
            >
              Refresh
            </button>
          </>
        }
      />

      <p class="profiles-page__hint" data-testid="profiles-switch-hint">
        Profiles are named lists of workflows. Editing one changes only the list — to actually switch a space to a
        profile (installing and removing workflows), use that space's Config → Local → Project tab.
      </p>

      <div class="profiles-toolbar">
        <label class="profiles-toolbar__picker">
          <span>Profile</span>
          <select
            data-testid="profiles-picker"
            value={selectedName ?? ''}
            onChange={(e) => setSelectedName((e.target as HTMLSelectElement).value || null)}
          >
            <option value="">Choose a profile…</option>
            <optgroup label="Built-in">
              {profiles.filter((p) => p.builtIn).map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </optgroup>
            <optgroup label="Saved">
              {profiles.filter((p) => !p.builtIn).map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.error ? ' (broken)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {selected && !selected.builtIn && (
          <button
            type="button"
            class="btn--danger"
            data-testid="profile-delete"
            onClick={() => setDialog({ kind: 'delete', name: selected.name })}
          >
            Delete…
          </button>
        )}
        {selected && (
          <button
            type="button"
            data-testid="profile-duplicate"
            onClick={() => setDialog({ kind: 'create', seedFrom: selected.name })}
          >
            Duplicate to edit…
          </button>
        )}
      </div>

      {selected?.error && (
        <p class="profiles-page__error" role="alert" data-testid="profiles-broken">
          This profile file could not be read: {selected.error}
        </p>
      )}

      {selected && selected.builtIn && (
        <p class="profiles-page__readonly" data-testid="profiles-readonly-note">
          {selected.name} is a built-in profile and is read-only. Duplicate it to create an editable copy.
        </p>
      )}

      {editable && (
        <div class="profiles-editbar" data-testid="profiles-editbar">
          {dirty ? (
            <span class="profiles-editbar__dirty" data-testid="profiles-dirty">Unsaved changes</span>
          ) : justSaved ? (
            <span class="profiles-editbar__saved" data-testid="profiles-saved-note">
              Saved. This only updates the list — any space locked to this profile picks up the change on its next apply.
            </span>
          ) : (
            <span class="profiles-editbar__clean">All changes saved</span>
          )}
          <button
            type="button"
            class="btn--primary"
            data-testid="profile-save"
            disabled={!dirty || saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" data-testid="profile-discard" disabled={!dirty || saving} onClick={discard}>
            Discard
          </button>
          {saveError && (
            <span class="profiles-editbar__error" role="alert" data-testid="profile-save-error">{saveError}</span>
          )}
        </div>
      )}

      {selected && selected.error === undefined && (
        <ProfileMembership workflows={workflows} toggle={toggle} />
      )}

      {dialog?.kind === 'create' && (
        <CreateProfileDialog
          seedMembers={[...(profiles.find((p) => p.name === dialog.seedFrom)?.workflows ?? [])]}
          existingNames={profiles.map((p) => p.name)}
          onClose={() => setDialog(null)}
          onCreated={(name) => {
            setDialog(null);
            setSelectedName(name);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteProfileDialog
          name={dialog.name}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            setDialog(null);
            setSelectedName(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

type Dialog =
  | { kind: 'create'; seedFrom: string | null }
  | { kind: 'delete'; name: string };

function ProfileMembership({
  workflows,
  toggle,
}: {
  workflows: WorkflowListEntry[];
  toggle?: ToggleContext;
}) {
  const drivers = workflows.filter((w) => w.kind === 'driver');
  const internalWorkflows = workflows.filter((w) => w.kind === 'internal');
  const tasks = workflows.filter((w) => w.kind === 'task');
  const experts = workflows.filter((w) => w.kind === 'expert');
  const noop = () => {};
  return (
    <div data-testid="profiles-membership">
      <WorkflowSection heading="Driver" testid="workflows-section-driver" entries={drivers} internal={internalWorkflows} onOpen={noop} onExport={noop} onDelete={noop} toggle={toggle} />
      <WorkflowSection heading="Task" testid="workflows-section-task" entries={tasks} onOpen={noop} onExport={noop} onDelete={noop} toggle={toggle} />
      <WorkflowSection heading="Expert" testid="workflows-section-expert" entries={experts} onOpen={noop} onExport={noop} onDelete={noop} toggle={toggle} />
    </div>
  );
}

function ProfileDialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="workflow-dialog__overlay" data-testid="profile-dialog">
      <div class="workflow-dialog" role="dialog" aria-label={title}>
        <h3 class="workflow-dialog__title">{title}</h3>
        {children}
        <div class="workflow-dialog__dismiss">
          <button type="button" class="btn--ghost" data-testid="profile-dialog-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CreateProfileDialog({
  seedMembers,
  existingNames,
  onClose,
  onCreated,
}: {
  seedMembers: string[];
  existingNames: string[];
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientError = useMemo(() => {
    if (name.length === 0) return null;
    const nameError = validateProfileName(name);
    if (nameError) return nameError;
    if (existingNames.includes(name)) return `A profile named "${name}" already exists.`;
    return null;
  }, [name, existingNames]);

  async function submit(event: Event) {
    event.preventDefault();
    if (submitting || name.length === 0 || clientError) return;
    setSubmitting(true);
    setError(null);
    try {
      await client.mutateProfile({ op: 'create', name, workflows: seedMembers });
      onCreated(name);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : 'Failed to create the profile.');
    }
  }

  return (
    <ProfileDialogShell title="New profile" onClose={onClose}>
      <form class="workflow-dialog__form" onSubmit={submit}>
        <label class="workflow-dialog__field">
          <span>Profile name</span>
          <input
            type="text"
            data-testid="profile-create-name"
            value={name}
            disabled={submitting}
            required
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        <p class="workflow-dialog__hint" data-testid="profile-create-seed">
          Starts with {seedMembers.length} workflow{seedMembers.length === 1 ? '' : 's'} from the selected profile — adjust after creating.
        </p>
        {clientError && <p class="workflow-dialog__error" role="alert" data-testid="profile-create-client-error">{clientError}</p>}
        {error && <p class="workflow-dialog__error" role="alert" data-testid="profile-create-error">{error}</p>}
        <div class="workflow-dialog__actions">
          <button type="submit" class="btn--primary" data-testid="profile-create-submit" disabled={submitting || name.length === 0 || clientError !== null}>
            {submitting ? 'Creating…' : 'Create profile'}
          </button>
        </div>
      </form>
    </ProfileDialogShell>
  );
}

function DeleteProfileDialog({ name, onClose, onDeleted }: { name: string; onClose: () => void; onDeleted: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await client.mutateProfile({ op: 'delete', name });
      onDeleted();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : 'Failed to delete the profile.');
    }
  }

  return (
    <ProfileDialogShell title={`Delete ${name}`} onClose={onClose}>
      <div class="workflow-dialog__form">
        <p data-testid="profile-delete-warning">
          Delete profile <strong>{name}</strong>? Any space currently locked to it will fall back to the user-wide
          profile the next time that space applies its selection.
        </p>
        {error && <p class="workflow-dialog__error" role="alert" data-testid="profile-delete-error">{error}</p>}
        <div class="workflow-dialog__actions">
          <button type="button" class="btn--danger" data-testid="profile-delete-confirm" disabled={submitting} onClick={run}>
            {submitting ? 'Deleting…' : 'Delete profile'}
          </button>
        </div>
      </div>
    </ProfileDialogShell>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
