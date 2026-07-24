import { useState } from 'preact/hooks';
import { Switch } from './ui/Switch.js';
import type { WorkflowListEntry } from '../api/types.js';

/**
 * Shared sectioned-card presentation for the workflow library
 * (ui-profile-workflow-split design D6, workflows-ui spec "Workflow cards share
 * a uniform anatomy"). Extracted from `WorkflowsPage.tsx` unchanged in
 * DOM/classes/testids so the Workflows page and the Profiles page cannot drift
 * apart: the Workflows page renders it with NO toggle context (pure library
 * view, empty switch slot); the Profiles page passes a `ToggleContext` bound to
 * a profile's draft membership.
 */

/**
 * The card's optional corner-switch driver (design D6). `stateFor(id)` returns
 * `null` for a unit that carries no switch on this surface, or the switch's
 * `{ checked, disabled, reason? }` state otherwise. Internal-kind units never
 * get a switch regardless of context (existing rule preserved).
 */
export interface ToggleContext {
  stateFor(id: string): { checked: boolean; disabled: boolean; reason?: string } | null;
  onToggle(id: string, checked: boolean): void;
}

/**
 * Optional per-card "enhances …" hint provider (profiles-ui spec / design D8).
 * Returns the workflow ids the given unit weakly enhances that are relevant on
 * this surface (i.e. present in the draft). Only the Profiles page supplies it;
 * the Workflows page leaves it undefined so its render is byte-identical.
 */
export type HintProvider = (id: string) => string[];

export function WorkflowSection({
  heading,
  testid,
  entries,
  internal,
  onOpen,
  onExport,
  onDelete,
  toggle,
  hintFor,
}: {
  heading: string;
  testid: string;
  entries: WorkflowListEntry[];
  /** Only the driver section passes internal-kind plumbing to nest behind a disclosure. */
  internal?: WorkflowListEntry[];
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  /** Optional corner-switch driver (design D6); absent = pure library view (empty switch slot). */
  toggle?: ToggleContext;
  /** Optional weak-enhancement hint provider (design D8); only the Profiles page supplies it. */
  hintFor?: HintProvider;
}) {
  const internalEntries = internal ?? [];
  // An empty category renders no section; the driver section still appears if
  // it has internal plumbing to host even when no top-level drivers exist.
  if (entries.length === 0 && internalEntries.length === 0) return null;
  return (
    <section class="workflows-group" data-testid={testid}>
      <h3 class="workflows-group__heading">{heading}</h3>
      <ul class="workflows-group__list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <WorkflowCard entry={entry} onOpen={onOpen} onExport={onExport} onDelete={onDelete} toggle={toggle} hintFor={hintFor} />
          </li>
        ))}
      </ul>
      {internalEntries.length > 0 && (
        // Internal plumbing never gets a corner switch (workflows-ui spec:
        // "internal workflows... carry no toggle") — no toggle context is
        // threaded to this disclosure's cards.
        <InternalDisclosure entries={internalEntries} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
      )}
    </section>
  );
}

/**
 * Internal workflows are driver plumbing (dependencies drivers pull in), so
 * they live inside the driver section behind a collapsed-by-default toggle,
 * mirroring the CLI's `--all` gating of the same group. The open state is plain
 * component state, not persisted.
 */
export function InternalDisclosure({
  entries,
  onOpen,
  onExport,
  onDelete,
}: {
  entries: WorkflowListEntry[];
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div class="workflows-internal">
      <button
        type="button"
        class="workflows-internal__toggle"
        data-testid="workflows-internal-toggle"
        aria-expanded={shown}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? `Hide internal (${entries.length})` : `Show internal (${entries.length})`}
      </button>
      {shown && (
        <ul class="workflows-group__list" data-testid="workflows-section-internal">
          {entries.map((entry) => (
            <li key={entry.id}>
              <WorkflowCard entry={entry} onOpen={onOpen} onExport={onExport} onDelete={onDelete} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function WorkflowCard({
  entry,
  onOpen,
  onExport,
  onDelete,
  toggle,
  hintFor,
}: {
  entry: WorkflowListEntry;
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  toggle?: ToggleContext;
  hintFor?: HintProvider;
}) {
  const isBuiltIn = entry.source === 'built-in';
  // Internal-kind units never get a switch (existing rule); otherwise the
  // context decides whether this unit is switchable on this surface.
  const toggleState = toggle && entry.kind !== 'internal' ? toggle.stateFor(entry.id) : null;
  const enhances = hintFor?.(entry.id) ?? [];
  return (
    <div class="workflow-card" data-testid="workflow-card" data-id={entry.id} data-source={entry.source}>
      <div class="workflow-card__header">
        <button
          type="button"
          class="workflow-card__open"
          data-testid="workflow-open"
          onClick={() => onOpen(entry.id)}
        >
          <span class="workflow-card__name">{entry.title ?? entry.skillName}</span>
          <span class="workflow-card__id">{entry.id}</span>
        </button>
        {/* The optional corner switch (design D6): the Workflows page passes no
            context, so the slot stays empty; the Profiles page binds it to the
            profile's draft membership. */}
        {toggleState && (
          <Switch
            checked={toggleState.checked}
            disabled={toggleState.disabled}
            label={`${entry.id} membership`}
            title={toggleState.reason}
            testid="workflow-card-toggle"
            onToggle={() => toggle!.onToggle(entry.id, !toggleState.checked)}
          />
        )}
      </div>
      <div class="workflow-card__meta">
        <span class="workflow-card__source">{isBuiltIn ? 'built-in' : 'user'}</span>
        <span class="workflow-card__digest" title={entry.digest}>{abbreviate(entry.digest)}</span>
        {entry.unused && (
          <span class="workflow-card__unused" data-testid="workflow-unused">unused</span>
        )}
        {isBuiltIn && (
          <span class="workflow-card__lock" data-testid="workflow-lock" title="Built-in — locked">
            locked
          </span>
        )}
        {toggleState?.reason && (
          <span class="workflow-card__toggle-reason" data-testid="workflow-card-toggle-reason">
            {toggleState.reason}
          </span>
        )}
        {enhances.length > 0 && (
          <span
            class="workflow-card__enhances"
            data-testid="workflow-card-enhances"
            title={`enhances ${enhances.join(', ')}`}
          >
            enhances {enhances[0]}
            {enhances.length > 1 ? ` +${enhances.length - 1}` : ''}
          </span>
        )}
      </div>
      {/* Category sections mix provenance, so export / delete are gated per card
          from the entry's source: only user-library cards expose them. Built-ins
          are pre-validated and locked; validation lives in the toolbar dialog.
          Pinned to a consistent footer position via margin-top:auto. */}
      {!isBuiltIn && (
        <div class="workflow-card__actions">
          <button type="button" class="btn--ghost" data-testid="workflow-export" onClick={() => onExport(entry.id)}>
            Export
          </button>
          <button type="button" class="btn--ghost" data-testid="workflow-delete" onClick={() => onDelete(entry.id)}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function abbreviate(digest: string): string {
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest;
}
