import { useEffect, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  AllowedControl,
  BoundedLoopLifecycleViewSection,
  ChangeRunView,
  ChoiceViewSection,
  GoalViewSection,
  ParallelViewSection,
  ReconcilerRunSummary,
  ReviewCycleViewSection,
  RunControlRequestBody,
  RunsResponse,
  TerminalView,
  UiControlCommand,
  WaitView,
} from '../api/types.js';
import {
  getBoundedLoopLifecycleSections,
  getChoiceSection,
  getConsultationSection,
  getGoalSection,
  getParallelSection,
  getReviewCycleSection,
  getRootDagSection,
  getUnsupportedBoundedLoopLifecycleSections,
} from '../api/types.js';
import { ConsultationObservabilityPanel } from './ConsultationObservabilityPanel.js';
import { useT } from '../i18n/store.js';

/** The translator signature `useT()` returns, threaded into leaf renderers. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Operations section for Task detail (design.md §14 of `ecp-run-spine`).
 *
 * Lists reconciler-engine Runs for each child Change WITHOUT mixing planning
 * spaces; opens one Run detail fetched from the server's read-only `inspect`
 * route; renders the server-projected core and `root-dag/1` frontier, active
 * invocations, domain-blocked/infrastructure/workspace/uncertain wait reasons,
 * terminal reason, source state, and definition/capability/policy/workspace
 * drift. When the Run's plan carries a FanOut or a Choice, the server-projected
 * `parallel/1` and `choice/1` sections render alongside it (ECP-4 task 8.6) —
 * this is the Operations plane of the parallel-frontier promise, next to the
 * CLI `pipeline status` and Management API planes.
 *
 * The UI CONSUMES server truth — it never re-derives frontier/status/waits/
 * terminal/drift client-side. Other-worktree Runs (`workspace.scope: 'other'`)
 * render read-only: the server already clears `allowedControls` and downgrades
 * `granted` → `admitted_undelivered` for those; the UI must not offer
 * controls or optimistic mutation for them.
 *
 * Control submit (14.5/14.6): the controls the server projects
 * (`allowedControls`) are rendered as INTERACTIVE elements. Gate decision
 * (per-wait, with the wait's decisionId + outcome options), resume,
 * escalate (with a required reason), and cancel (with confirmation) submit
 * the displayed `recordVersion` and exact `WaitId` via `postRunControl`.
 * On a 409 `record_version_conflict` the UI REFETCHES committed truth
 * (`getRunDetail`) and re-renders from the server projection — it NEVER
 * optimistically patches. `accept-workspace-revision` stays a read-only
 * badge (it requires EvidenceRefs the browser cannot produce). Agent/
 * command/host `complete` is a trusted CLI/host seam and is never offered
 * as a browser form.
 *
 * LOCALIZATION (ECP-5). Every string the UI itself authors comes from the
 * `operations.*` catalog namespace in all three shipped locales. Values the
 * SERVER projected — status, phase, outcome, severity, finding status, join
 * state, member status, wait/terminal codes, ids and digests — are rendered
 * verbatim and are never translated: they are the kernel's vocabulary, the
 * same tokens the CLI and the Management API print, and the cross-plane parity
 * suites assert them character-for-character. Translating one would make the
 * Operations plane disagree with the other two planes about what the Run says.
 */

/** Shortens an ID for display while preserving the full ID in a title attribute. */
function shortId(id: string, maxPrefix = 12): { label: string; full: string } {
  return { label: id.length > maxPrefix ? `${id.slice(0, maxPrefix)}…` : id, full: id };
}

/** Human-readable status label with a CSS modifier class. */
function statusClass(status: string): string {
  return `ops-run__status--${status}`;
}

/** Groups reconciler Run summaries by their changeId, preserving server order. */
function groupByChange(
  summaries: readonly ReconcilerRunSummary[]
): Map<string, ReconcilerRunSummary[]> {
  const map = new Map<string, ReconcilerRunSummary[]>();
  for (const s of summaries) {
    const list = map.get(s.changeId) ?? [];
    list.push(s);
    map.set(s.changeId, list);
  }
  return map;
}

/**
 * Renders a wait reason from the server-projected wait variant. The sentence
 * frame is localized; the codes it carries (`reasonCode`, `code`, `gateId`,
 * `decisionIds`) are server vocabulary and interpolate verbatim.
 */
function WaitReason({ wait, t }: { wait: WaitView; t: Translate }) {
  const id = shortId(wait.waitId);
  let label: string;
  switch (wait.kind) {
    case 'gate':
      label = t('operations.wait.gate', {
        gate: wait.gateId,
        decisions: wait.decisionIds.join(' | '),
      });
      break;
    case 'domain-blocked':
      label = t('operations.wait.domain_blocked', { code: wait.reasonCode });
      break;
    case 'human-required':
      label = t('operations.wait.human_required', {
        code: wait.reasonCode,
        outcome: wait.outcome,
      });
      break;
    case 'infrastructure':
      label = wait.retryable
        ? t('operations.wait.infrastructure_retryable', { code: wait.code })
        : t('operations.wait.infrastructure', { code: wait.code });
      break;
    case 'uncertain-effect':
      label = t('operations.wait.uncertain_effect');
      break;
    case 'capability-unavailable':
      label = t('operations.wait.capability_unavailable', { code: wait.code });
      break;
    case 'workspace-drift':
      label = t('operations.wait.workspace_drift');
      break;
    case 'workspace-reservation':
      label = t(
        wait.intents.length === 1
          ? 'operations.wait.workspace_reservation.one'
          : 'operations.wait.workspace_reservation.other',
        { count: wait.intents.length }
      );
      break;
  }
  return (
    <li
      class="ops-wait"
      data-testid="ops-wait"
      data-wait-kind={wait.kind}
      // Identifier tooltips name WIRE FIELDS (`WaitId`, `RunId`, `NodeId`, …)
      // and stay untranslated across the plane, exactly like the ids they
      // carry — a field name is not prose.
      title={`WaitId: ${id.full}`}
    >
      <span class="ops-wait__id">{id.label}</span>
      <span class="ops-wait__reason">{label}</span>
      {wait.kind === 'human-required' && (
        <div class="ops-wait__evidence" data-testid="ops-human-required-evidence">
          <span class="ops-wait__evidence-label">{t('operations.wait.evidence')}</span>
          {wait.evidence.length === 0 ? (
            <span data-testid="ops-human-required-evidence-empty">
              {t('operations.wait.evidence_none')}
            </span>
          ) : (
            <ul class="ops-wait__evidence-list">
              {wait.evidence.map((evidence) => (
                <li
                  key={evidence.evidenceDigest}
                  data-testid="ops-human-required-evidence-item"
                  title={evidence.evidenceDigest}
                >
                  <span>{evidence.observationKind}</span>
                  <span>{evidence.mediaType}</span>
                  <span>{evidence.size}</span>
                  <span>{evidence.producer.id}@{evidence.producer.version}</span>
                  <span>{shortId(evidence.contentDigest, 20).label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Renders a terminal outcome from the server projection. */
function TerminalReason({ terminal, t }: { terminal: TerminalView; t: Translate }) {
  let label: string;
  switch (terminal.kind) {
    case 'completed':
      label = t('operations.terminal.completed', { outcome: terminal.outcome });
      break;
    case 'escalated':
      label = terminal.reason
        ? t('operations.terminal.escalated_reason', {
            code: terminal.code,
            reason: terminal.reason,
          })
        : t('operations.terminal.escalated', { code: terminal.code });
      break;
    case 'failed':
      label = terminal.reason
        ? t('operations.terminal.failed_reason', { code: terminal.code, reason: terminal.reason })
        : t('operations.terminal.failed', { code: terminal.code });
      break;
    case 'cancelled':
      label = terminal.reason
        ? t('operations.terminal.cancelled_reason', { reason: terminal.reason })
        : t('operations.terminal.cancelled');
      break;
  }
  return (
    <p class="ops-run__terminal" data-testid="ops-run-terminal" data-terminal-kind={terminal.kind}>
      {label}
    </p>
  );
}

function BoundedLoopLifecycleSection({
  section,
  t,
}: {
  section: BoundedLoopLifecycleViewSection;
  t: Translate;
}) {
  const loop = shortId(section.loopPath, 32);
  return (
    <div
      class={`ops-run__loop-lifecycle ops-run__loop-lifecycle--${section.state}`}
      data-testid="ops-run-loop-lifecycle"
      data-loop-path={section.loopPath}
      data-body-kind={section.bodyKind}
      data-state={section.state}
    >
      <span class="ops-run__section-label">
        {t('operations.loop_lifecycle.title')}
      </span>
      <dl class="ops-run__loop-lifecycle-meta">
        <dt>{t('operations.loop_lifecycle.loop')}</dt>
        <dd title={section.loopPath}>{loop.label}</dd>
        <dt>{t('operations.loop_lifecycle.body')}</dt>
        <dd>{section.bodyKind}</dd>
        <dt>{t('operations.loop_lifecycle.state')}</dt>
        <dd>{section.state}</dd>
        <dt>{t('operations.loop_lifecycle.iteration')}</dt>
        <dd>{section.iteration}</dd>
        <dt>{t('operations.loop_lifecycle.phase')}</dt>
        <dd>{section.phase}</dd>
        <dt>{t('operations.loop_lifecycle.limits')}</dt>
        <dd data-testid="ops-loop-lifecycle-limits">
          {t('operations.loop_lifecycle.limit_values', {
            iterations: `${section.limits.iterations.used}/${section.limits.iterations.max}`,
            actions: `${section.limits.actions.used}/${section.limits.actions.max}`,
            budget: `${section.limits.budget.used}/${section.limits.budget.max}`,
          })}
        </dd>
        <dt>{t('operations.loop_lifecycle.streaks')}</dt>
        <dd>
          {t('operations.loop_lifecycle.streak_values', {
            stall: section.stallStreak,
            blocked: section.blockedStreak,
          })}
        </dd>
        <dt>{t('operations.loop_lifecycle.strategy')}</dt>
        <dd>
          {section.strategy.attempts}/{section.strategy.maxAttempts}
          {section.strategy.active === undefined
            ? ''
            : ` (${t('operations.loop_lifecycle.active', { attempt: section.strategy.active })})`}
        </dd>
        {section.wait !== undefined && (
          <>
            <dt>{t('operations.loop_lifecycle.wait')}</dt>
            <dd title={section.wait.waitId}>
              {section.wait.kind}
              {section.wait.reasonCode === undefined ? '' : `: ${section.wait.reasonCode}`}
            </dd>
          </>
        )}
        {section.outcome !== undefined && (
          <>
            <dt>{t('operations.loop_lifecycle.outcome')}</dt>
            <dd data-testid="ops-loop-lifecycle-outcome">
              {section.outcome.kind} / {section.outcome.disposition}
              {section.outcome.value === undefined ? '' : `: ${section.outcome.value}`}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * Renders the server-projected `parallel/1` section: every fan-out member with
 * its status, required/optional role and condition; the Join barrier state;
 * budget usage against the declared budget; and the member frontier as the
 * projector reports it (`activeCount` — the UI does not recompute which members
 * are in flight, exactly as it does not recompute the root-DAG frontier).
 */
function ParallelSection({ section, t }: { section: ParallelViewSection; t: Translate }) {
  const fanOut = shortId(section.fanOutPath, 32);
  return (
    <div
      class="ops-run__parallel"
      data-testid="ops-run-parallel"
      data-join-state={section.joinState}
    >
      <span class="ops-run__section-label">
        {t(
          section.members.length === 1
            ? 'operations.parallel.title.one'
            : 'operations.parallel.title.other',
          { count: section.members.length }
        )}
      </span>
      <dl class="ops-run__parallel-meta">
        <dt>{t('operations.parallel.fan_out')}</dt>
        <dd title={section.fanOutPath} data-testid="ops-parallel-fan-out">{fanOut.label}</dd>
        <dt>{t('operations.parallel.join')}</dt>
        <dd>
          <span
            class={`ops-run__join-state ops-run__join-state--${section.joinState}`}
            data-testid="ops-parallel-join-state"
          >
            {section.joinState}
          </span>
          {section.joinPath !== undefined && (
            <span
              class="ops-run__parallel-join-path"
              title={section.joinPath}
              data-testid="ops-parallel-join-path"
            >
              {shortId(section.joinPath, 32).label}
            </span>
          )}
        </dd>
        <dt>{t('operations.parallel.budget')}</dt>
        <dd data-testid="ops-parallel-budget">
          {section.budget.used}/{section.budget.max}
        </dd>
        <dt>{t('operations.parallel.cap')}</dt>
        <dd data-testid="ops-parallel-cap">{section.concurrencyCap}</dd>
        <dt>{t('operations.parallel.frontier')}</dt>
        {/* The projector's own counts, interpolated into a localized frame —
            the UI does not recompute which members are in flight. */}
        <dd data-testid="ops-parallel-counts">
          {t('operations.parallel.counts', {
            active: section.activeCount,
            succeeded: section.succeededCount,
            failed: section.failedCount,
          })}
        </dd>
      </dl>

      <ul class="ops-run__parallel-list">
        {section.members.map((member) => (
          <li
            key={member.path}
            class={`ops-run__parallel-member ops-run__parallel-member--${member.status}`}
            data-testid="ops-parallel-member"
            data-member-status={member.status}
            data-member-required={member.required ? 'true' : 'false'}
            title={`${member.path}\ncondition: ${member.condition}`}
          >
            <span class="ops-run__parallel-member-path">{shortId(member.path, 32).label}</span>
            <span class="ops-run__parallel-member-status">{member.status}</span>
            <span class="ops-run__parallel-member-role">
              {member.required
                ? t('operations.parallel.required')
                : t('operations.parallel.optional')}
            </span>
            <span class="ops-run__parallel-member-condition">{member.condition}</span>
          </li>
        ))}
      </ul>

      {section.keyBlockers.length > 0 && (
        <ul class="ops-run__parallel-blockers" data-testid="ops-parallel-blockers">
          {section.keyBlockers.map((blocker) => (
            <li key={blocker} class="ops-run__parallel-blocker" data-testid="ops-parallel-blocker">
              {blocker}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Renders the server-projected `choice/1` section: the selected outcome (or
 * that none is committed yet) and every declared branch marked active or
 * inactive exactly as the projector marked it.
 */
function ChoiceSection({ section, t }: { section: ChoiceViewSection; t: Translate }) {
  return (
    <div class="ops-run__choice" data-testid="ops-run-choice" data-outcome={section.outcome}>
      <span class="ops-run__section-label">{t('operations.choice.title')}</span>
      <dl class="ops-run__choice-meta">
        <dt>{t('operations.choice.node')}</dt>
        <dd title={section.choicePath} data-testid="ops-choice-path">
          {shortId(section.choicePath, 32).label}
        </dd>
        <dt>{t('operations.choice.outcome')}</dt>
        {/* The committed outcome is server vocabulary and renders verbatim;
            only the "nothing committed yet" placeholder is UI copy. */}
        <dd data-testid="ops-choice-outcome">
          {section.outcome ?? t('operations.choice.awaiting')}
        </dd>
      </dl>
      <ul class="ops-run__choice-list">
        {section.branches.map((branch) => (
          <li
            key={branch.outcome}
            class={`ops-run__choice-branch ops-run__choice-branch--${branch.active ? 'active' : 'inactive'}`}
            data-testid="ops-choice-branch"
            data-outcome={branch.outcome}
            data-active={branch.active ? 'true' : 'false'}
            title={branch.path}
          >
            <span class="ops-run__choice-branch-outcome">{branch.outcome}</span>
            <span class="ops-run__choice-branch-path">{shortId(branch.path, 32).label}</span>
            <span class="ops-run__choice-branch-state">
              {branch.active ? t('operations.choice.active') : t('operations.choice.inactive')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One projected ReviewCycle actor slot (fixer / verifier / last actor). */
type ReviewCycleActor = NonNullable<ReviewCycleViewSection['actors']['fixer']>;

/**
 * Localized label for an actor slot. Written as a switch over LITERAL catalog
 * keys rather than an interpolated `t(\`…${slot}\`)`, so the catalog test's
 * used-key scan can see them — a key it cannot see is a key a typo can break
 * silently.
 */
function actorSlotLabel(slot: string, t: Translate): string {
  switch (slot) {
    case 'fixer':
      return t('operations.review_cycle.actor.fixer');
    case 'verifier':
      return t('operations.review_cycle.actor.verifier');
    default:
      return t('operations.review_cycle.actor.last');
  }
}

/**
 * Renders the server-projected `review-cycle/1` section: the bounded loop's
 * round against its cap, the phase the kernel expects next, the terminal
 * outcome when the loop reached one, every finding with the severity and
 * status the kernel holds, the bound actors, and the projected wait reason.
 *
 * This is the Operations plane of ECP-1's cross-plane promise — the CLI
 * (`pipeline status`) and the Management API already render the SAME section
 * from the SAME projector, and this component closes the third plane.
 *
 * Nothing here is re-derived. In particular the UI does NOT decide whether the
 * cycle is clean by inspecting findings, does not count rounds from the
 * findings or actors, and does not infer "waiting" from the phase: the round
 * cap, the clean/exhausted determination, the author-≠-verifier rule and the
 * wait reason are all kernel judgements carried on the section. A UI that
 * recomputed any of them would be a second owner of mechanical progression —
 * exactly what this slice exists to delete.
 */
function ReviewCycleSection({
  section,
  t,
}: {
  section: ReviewCycleViewSection;
  t: Translate;
}) {
  const loop = shortId(section.loopPath, 32);
  const actors: readonly [string, ReviewCycleActor][] = (
    [
      ['fixer', section.actors.fixer],
      ['verifier', section.actors.verifier],
      ['last', section.actors.lastActor],
    ] as [string, ReviewCycleActor | undefined][]
  ).flatMap(([slot, actor]) => (actor === undefined ? [] : [[slot, actor] as [string, ReviewCycleActor]]));

  return (
    <div
      class="ops-run__review-cycle"
      data-testid="ops-run-review-cycle"
      data-phase={section.phase}
      data-outcome={section.outcome}
    >
      <span class="ops-run__section-label">
        {t(
          section.findings.length === 1
            ? 'operations.review_cycle.title.one'
            : 'operations.review_cycle.title.other',
          { count: section.findings.length }
        )}
      </span>
      <dl class="ops-run__review-cycle-meta">
        <dt>{t('operations.review_cycle.loop')}</dt>
        <dd title={section.loopPath} data-testid="ops-review-cycle-loop">
          {loop.label}
        </dd>
        <dt>{t('operations.review_cycle.round')}</dt>
        {/* The projected round against the projected cap — the bounded-loop
            reducer owns both; the UI never counts rounds itself. */}
        <dd data-testid="ops-review-cycle-round">
          {section.round}/{section.maxRounds}
        </dd>
        <dt>{t('operations.review_cycle.phase')}</dt>
        {/* Phase, outcome and waitReason are kernel tokens — rendered verbatim
            so this plane says exactly what `pipeline status` says. */}
        <dd data-testid="ops-review-cycle-phase">{section.phase}</dd>
        <dt>{t('operations.review_cycle.outcome')}</dt>
        {/* Absent outcome means the loop has not terminated. It is NOT derived
            from the findings — the kernel's ship guard is the only authority
            on whether a cycle may be called clean. */}
        <dd data-testid="ops-review-cycle-outcome">
          {section.outcome ?? t('operations.review_cycle.in_progress')}
        </dd>
        {section.waitReason !== undefined && (
          <>
            <dt>{t('operations.review_cycle.wait')}</dt>
            <dd data-testid="ops-review-cycle-wait">{section.waitReason}</dd>
          </>
        )}
      </dl>

      {section.findings.length > 0 && (
        <ul class="ops-run__review-cycle-findings">
          {section.findings.map((finding) => (
            <li
              key={finding.id}
              class={`ops-run__review-cycle-finding ops-run__review-cycle-finding--${finding.status}`}
              data-testid="ops-review-cycle-finding"
              data-finding-id={finding.id}
              data-severity={finding.severity}
              data-status={finding.status}
              title={finding.location ?? finding.id}
            >
              <span class="ops-run__review-cycle-finding-id">{finding.id}</span>
              <span class="ops-run__review-cycle-finding-severity">{finding.severity}</span>
              <span class="ops-run__review-cycle-finding-status">{finding.status}</span>
              <span class="ops-run__review-cycle-finding-claim">{finding.claim}</span>
              {finding.location !== undefined && (
                <span class="ops-run__review-cycle-finding-location">{finding.location}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {actors.length > 0 && (
        <ul class="ops-run__review-cycle-actors" data-testid="ops-review-cycle-actors">
          {actors.map(([slot, actor]) => {
            const identity = shortId(actor.identityDigest, 16);
            return (
              <li
                key={slot}
                class={`ops-run__review-cycle-actor ops-run__review-cycle-actor--${slot}`}
                data-testid="ops-review-cycle-actor"
                data-actor-slot={slot}
                data-actor-kind={actor.kind}
                data-actor-identity={actor.identityDigest}
                // The slot name here is UI copy, not a wire field (`lastActor`
                // is displayed as "last"), so it follows the visible label
                // rather than the untranslated-identifier rule — otherwise the
                // tooltip and the span beside it disagree about one string.
                title={`${actorSlotLabel(slot, t)}: ${actor.identityDigest}`}
              >
                <span class="ops-run__review-cycle-actor-slot">
                  {actorSlotLabel(slot, t)}
                </span>
                <span class="ops-run__review-cycle-actor-kind">{actor.kind}</span>
                <span class="ops-run__review-cycle-actor-identity">{identity.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Renders GoalLoop domain facts without duplicating lifecycle mechanics. */
function GoalSection({ section, t }: { section: GoalViewSection; t: Translate }) {
  const loop = shortId(section.loopPath, 32);
  return (
    <div
      class="ops-run__goal"
      data-testid="ops-run-goal"
      data-variant={section.variant}
      data-phase={section.phase}
      data-outcome={section.outcome}
    >
      <span class="ops-run__section-label">{t('operations.goal.title')}</span>
      <dl class="ops-run__goal-meta">
        <dt>{t('operations.goal.loop')}</dt>
        <dd title={section.loopPath} data-testid="ops-goal-loop">{loop.label}</dd>
        <dt>{t('operations.goal.variant')}</dt>
        <dd data-testid="ops-goal-variant">{section.variant}</dd>
        <dt>{t('operations.goal.round')}</dt>
        <dd data-testid="ops-goal-round">{section.round}</dd>
        <dt>{t('operations.goal.phase')}</dt>
        <dd data-testid="ops-goal-phase">{section.phase}</dd>
        <dt>{t('operations.goal.outcome')}</dt>
        <dd data-testid="ops-goal-outcome">
          {section.outcome ?? t('operations.goal.in_progress')}
        </dd>
        {section.lastScore !== undefined && (
          <>
            <dt>{t('operations.goal.score')}</dt>
            <dd data-testid="ops-goal-score">{section.lastScore}</dd>
          </>
        )}
        <dt>{t('operations.goal.gaps')}</dt>
        <dd data-testid="ops-goal-gaps">
          {section.lastGaps.length === 0
            ? t('operations.goal.gaps_none')
            : section.lastGaps.join(' | ')}
        </dd>
        {section.waitReason !== undefined && (
          <>
            <dt>{t('operations.goal.wait')}</dt>
            <dd data-testid="ops-goal-wait">{section.waitReason}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * Renders one allowed control that the browser CANNOT submit as a read-only
 * badge. Only `accept-workspace-revision` qualifies: it requires `EvidenceRef[]`
 * the browser cannot produce (no access to the bounded content-addressed
 * evidence staging store), so even when the server projects it as allowed it
 * stays non-interactive. A trusted CLI/host caller can still action it.
 */
function ControlBadge({ control }: { control: AllowedControl }) {
  let label: string;
  switch (control.kind) {
    case 'accept-workspace-revision':
      label = `accept-workspace-revision (${shortId(control.waitId).label})`;
      break;
    default:
      // Defensive: any other kind that ControlsSection does not handle lands
      // here rather than vanishing. This never runs for the four submittable
      // kinds (decision/resume/escalate/cancel) — ControlsSection owns those.
      label = `${control.kind}`;
      break;
  }
  return (
    <span class="ops-control-badge" data-testid="ops-control-badge" data-control-kind={control.kind}>
      {label}
    </span>
  );
}

/**
 * The four control kinds the UI submits over HTTP. Listed once so the render
 * path can partition `allowedControls` into interactive vs read-only without
 * duplicating the kind set. `accept-workspace-revision` is intentionally
 * absent — it stays a {@link ControlBadge}.
 */
const SUBMITTABLE_CONTROL_KINDS = new Set<AllowedControl['kind']>([
  'decision',
  'resume',
  'escalate',
  'cancel',
]);

function isSubmittable(control: AllowedControl): boolean {
  return SUBMITTABLE_CONTROL_KINDS.has(control.kind);
}

/**
 * Renders the server-projected `allowedControls` as interactive submit
 * elements plus read-only badges for the non-submittable variants. The
 * component builds the control request body from the displayed `recordVersion`
 * and the exact `waitId`/`decisionId` carried by each projected control — it
 * never derives or guesses values client-side.
 *
 * Submit contract (design §14):
 * - On success, replaces the local view from `response.view` (committed truth).
 * - On a 409 `record_version_conflict`, refetches via `getRunDetail` and
 *   replaces the view from the refetch — NEVER optimistically patches.
 * - On 403/other errors, surfaces the server's error inline and leaves the
 *   view unchanged.
 * - While a submit is in flight, EVERY submit target is disabled (duplicate
 *   suppression — concurrent control writes would conflict anyway).
 *
 * The `key` prop (runId) ensures local UI state (cancel confirm, escalate
 * reason, in-flight flag) resets when the selected Run changes.
 */
function ControlsSection({
  view,
  changeId,
  runId,
  selector,
  onViewReplaced,
  t,
}: {
  view: ChangeRunView;
  changeId: string;
  runId: string;
  selector?: string;
  onViewReplaced: (view: ChangeRunView) => void;
  t: Translate;
}) {
  const root = getRootDagSection(view);
  // Local UI state — keyed off runId by the parent so it resets on Run switch.
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [pendingCancel, setPendingCancel] = useState(false);
  const [escalateReason, setEscalateReason] = useState('');

  if (!root || root.allowedControls.length === 0) return null;

  const submittable = root.allowedControls.filter(isSubmittable);
  const readOnly = root.allowedControls.filter((c) => !isSubmittable(c));

  async function submit(command: UiControlCommand): Promise<void> {
    if (inFlight) return; // duplicate suppression
    setInFlight(true);
    setError(null);
    setPendingCancel(false);
    // Build the body from the DISPLAYED recordVersion + the projected control
    // fields. projectRoot is a structural schema requirement — the server
    // resolves the authoritative root from the space selector (the bridge
    // compares only changeId/runId; the CLI subprocess receives the
    // router-resolved root as its cwd). The UI sends its selector verbatim.
    const body: RunControlRequestBody = {
      control: {
        format: 'change-run-control/1',
        ref: {
          change: { projectRoot: selector ?? changeId, changeId },
          runId,
        },
        expectedRecordVersion: view.recordVersion,
        command,
      },
    };
    try {
      const response = await client.postRunControl(changeId, runId, body, selector);
      // Replace local view from committed truth — never optimistically mutate.
      onViewReplaced(response.view);
      setEscalateReason('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'record_version_conflict') {
        // The server says our expectedRecordVersion is stale. Refetch the
        // committed view and re-render from server projection. This is the
        // ONLY error path that replaces the view — every other error leaves
        // the displayed view unchanged.
        try {
          const fresh = await client.getRunDetail(changeId, runId, selector);
          onViewReplaced(fresh);
          setError(null);
          setEscalateReason('');
        } catch {
          setError({
            code: 'refetch_failed',
            message: t('operations.control.error.refetch_failed'),
          });
        }
      } else if (err instanceof ApiError) {
        // The server's own message — already localized by the server or
        // deliberately verbatim; the UI does not restate it.
        setError({ code: err.code, message: err.message });
      } else {
        setError({ code: 'unknown', message: t('operations.control.error.unknown') });
      }
    } finally {
      setInFlight(false);
    }
  }

  return (
    <div class="ops-run__controls-list" data-inflight={inFlight ? 'true' : 'false'}>
      {submittable.map((control) => {
        switch (control.kind) {
          case 'decision':
            return (
              <div
                key={`decision-${control.waitId}-${control.decisionId}`}
                class="ops-control ops-control--decision"
                data-testid="ops-control"
                data-control-kind="decision"
                title={`waitId: ${control.waitId}\ndecisionId: ${control.decisionId}`}
              >
                <span class="ops-control__label">
                  {t('operations.control.decision', {
                    decision: control.decisionId,
                    wait: shortId(control.waitId).label,
                  })}
                </span>
                <span class="ops-control__outcomes">
                  {control.outcomes.map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      class="ops-control__outcome"
                      data-testid="ops-control-decision-outcome"
                      data-outcome={outcome}
                      disabled={inFlight}
                      onClick={() =>
                        submit({
                          kind: 'decision',
                          waitId: control.waitId,
                          decisionId: control.decisionId,
                          outcome,
                        })
                      }
                    >
                      {outcome}
                    </button>
                  ))}
                </span>
              </div>
            );
          case 'resume': {
            const wait = root.waits.find(candidate => candidate.waitId === control.waitId);
            const retry = wait?.kind === 'infrastructure' && wait.retryable;
            return (
              <div
                key={`resume-${control.waitId}`}
                class="ops-control ops-control--resume"
                data-testid="ops-control"
                data-control-kind="resume"
                title={`waitId: ${control.waitId}`}
              >
                <span class="ops-control__label">
                  {t(retry ? 'operations.control.retry' : 'operations.control.resume', {
                    wait: shortId(control.waitId).label,
                  })}
                </span>
                <button
                  type="button"
                  class="ops-control__submit"
                  data-testid="ops-control-resume-submit"
                  disabled={inFlight}
                  onClick={() => submit({ kind: 'resume', waitId: control.waitId })}
                >
                  {t(retry ? 'operations.control.retry_action' : 'operations.control.resume_action')}
                </button>
              </div>
            );
          }
          case 'escalate':
            return (
              <div
                key="escalate"
                class="ops-control ops-control--escalate"
                data-testid="ops-control"
                data-control-kind="escalate"
              >
                <span class="ops-control__label">{t('operations.control.escalate')}</span>
                <input
                  type="text"
                  class="ops-control__reason"
                  data-testid="ops-control-escalate-reason"
                  placeholder={t('operations.control.escalate_reason_placeholder')}
                  value={escalateReason}
                  disabled={inFlight}
                  onInput={(e) => setEscalateReason((e.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="ops-control__submit"
                  data-testid="ops-control-escalate-submit"
                  // Schema requires reason: min(1). Client-side guard matches
                  // the server's own validation — never bypasses it.
                  disabled={inFlight || escalateReason.trim().length === 0}
                  onClick={() => submit({ kind: 'escalate', reason: escalateReason.trim() })}
                >
                  {t('operations.control.escalate_action')}
                </button>
              </div>
            );
          case 'cancel': {
            // Two-step confirm: the first click reveals Confirm/Dismiss;
            // only Confirm actually submits. This guards against an
            // accidental irreversible cancel.
            return (
              <div
                key="cancel"
                class="ops-control ops-control--cancel"
                data-testid="ops-control"
                data-control-kind="cancel"
              >
                <span class="ops-control__label">{t('operations.control.cancel')}</span>
                {!pendingCancel ? (
                  <button
                    type="button"
                    class="ops-control__submit ops-control__submit--danger"
                    data-testid="ops-control-cancel-submit"
                    disabled={inFlight}
                    onClick={() => setPendingCancel(true)}
                  >
                    {t('operations.control.cancel_action')}
                  </button>
                ) : (
                  <span class="ops-control__confirm">
                    <button
                      type="button"
                      class="ops-control__submit ops-control__submit--danger"
                      data-testid="ops-control-cancel-confirm"
                      disabled={inFlight}
                      onClick={() => submit({ kind: 'cancel' })}
                    >
                      {t('operations.control.cancel_confirm')}
                    </button>
                    <button
                      type="button"
                      class="ops-control__dismiss"
                      data-testid="ops-control-cancel-dismiss"
                      disabled={inFlight}
                      onClick={() => setPendingCancel(false)}
                    >
                      {t('operations.control.cancel_dismiss')}
                    </button>
                  </span>
                )}
              </div>
            );
          }
          // accept-workspace-revision is filtered into `readOnly` below —
          // it never reaches this switch. The exhaustiveness check ensures
          // a future allowed kind is handled deliberately, not silently.
          default:
            return null;
        }
      })}

      {readOnly.map((control) => (
        <ControlBadge key={`badge-${control.kind}-${'waitId' in control ? control.waitId : control.kind}`} control={control} />
      ))}

      {error && (
        <p
          class="ops-control__error"
          role="alert"
          data-testid="ops-control-error"
          data-error-code={error.code}
        >
          {error.message}
        </p>
      )}
    </div>
  );
}

/** Renders the projected root-DAG detail: frontier, invocations, actions, waits, drift. */
function RunDetailBody({
  view,
  changeId,
  runId,
  selector,
  onViewReplaced,
  t,
}: {
  view: ChangeRunView;
  changeId: string;
  runId: string;
  selector?: string;
  onViewReplaced: (view: ChangeRunView) => void;
  t: Translate;
}) {
  const root = getRootDagSection(view);
  const reviewCycle = getReviewCycleSection(view);
  const goal = getGoalSection(view);
  const loopLifecycles = getBoundedLoopLifecycleSections(view);
  const unsupportedLoopLifecycles = getUnsupportedBoundedLoopLifecycleSections(view);
  const parallel = getParallelSection(view);
  const choice = getChoiceSection(view);
  const consultation = getConsultationSection(view);
  const isOther = view.workspace.scope === 'other';
  const runIdShort = shortId(view.runId);

  if (!root) {
    return <p class="ops-run__no-section">{t('operations.detail.no_root_section')}</p>;
  }

  return (
    <div class="ops-run__body" data-testid="ops-run-detail-body">
      {/* Core identity row — full IDs in title attributes for copy. */}
      <dl class="ops-run__meta">
        <dt>{t('operations.detail.run')}</dt>
        <dd title={view.runId} data-testid="ops-run-id">{runIdShort.label}</dd>
        <dt>{t('operations.detail.status')}</dt>
        {/* status / sourceState / scope are server tokens — verbatim. */}
        <dd>
          <span class={`ops-run__status ${statusClass(view.status)}`} data-testid="ops-run-status">{view.status}</span>
        </dd>
        {/* ECP-5 (task 6.2): the Run's ENGINE OWNER. Carried on the view since
            run-spine and rendered by no plane until now. Server token —
            verbatim, never translated, so CLI/API/Operations read alike. */}
        <dt>{t('operations.detail.engine')}</dt>
        <dd>
          <span class="ops-run__engine" data-testid="ops-run-engine">{view.engine}</span>
        </dd>
        <dt>{t('operations.detail.record')}</dt>
        <dd>{t('operations.detail.record_version', { version: view.recordVersion })}</dd>
        <dt>{t('operations.detail.source')}</dt>
        <dd data-testid="ops-run-source-state">{view.sourceState}</dd>
        <dt>{t('operations.detail.workspace')}</dt>
        <dd>
          <span
            class={`ops-run__scope ops-run__scope--${view.workspace.scope}`}
            data-testid="ops-run-scope"
          >
            {view.workspace.scope}
          </span>
          {isOther && (
            <span
              class="ops-run__readonly-notice"
              title={t('operations.detail.readonly_title')}
            >
              {t('operations.detail.readonly')}
            </span>
          )}
        </dd>
      </dl>

      {/* root-dag/1 frontier — the server-projected ready nodes. */}
      {root.frontier.length > 0 && (
        <div class="ops-run__frontier" data-testid="ops-run-frontier">
          <span class="ops-run__section-label">{t('operations.detail.frontier')}</span>
          <ul class="ops-run__frontier-list">
            {root.frontier.map((nodeId) => {
              const short = shortId(nodeId);
              return (
                <li key={nodeId} class="ops-run__frontier-node" title={nodeId}>
                  {short.label}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Active invocations — server-projected, with action/effect bindings. */}
      {root.activeInvocations.length > 0 && (
        <div class="ops-run__invocations" data-testid="ops-run-invocations">
          <span class="ops-run__section-label">{t('operations.detail.invocations')}</span>
          <ul class="ops-run__invocation-list">
            {root.activeInvocations.map((inv) => {
              const invShort = shortId(inv.invocationId);
              return (
                <li
                  key={inv.invocationId}
                  class="ops-run__invocation"
                  title={`InvocationId: ${inv.invocationId}\nNodeId: ${inv.nodeId}\nAttemptId: ${inv.attemptId}`}
                  data-testid="ops-run-invocation"
                >
                  <span class="ops-run__invocation-id">{invShort.label}</span>
                  <span class="ops-run__invocation-actions">
                    {t(
                      inv.actionIds.length === 1
                        ? 'operations.detail.action_count.one'
                        : 'operations.detail.action_count.other',
                      { count: inv.actionIds.length }
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Actions — diagnostic delivery states from the projection. */}
      {root.actions.length > 0 && (
        <div class="ops-run__actions" data-testid="ops-run-actions">
          <span class="ops-run__section-label">
            {t('operations.detail.actions', { count: root.actions.length })}
          </span>
          <ul class="ops-run__action-list">
            {root.actions.map((action) => {
              const actShort = shortId(action.actionId);
              return (
                <li
                  key={action.actionId}
                  class={`ops-run__action ops-run__action--${action.deliveryState}`}
                  title={`ActionId: ${action.actionId}\nKind: ${action.kind}\nInvocationId: ${action.invocationId}`}
                  data-testid="ops-run-action"
                  data-delivery={action.deliveryState}
                >
                  <span class="ops-run__action-kind">{action.kind}</span>
                  <span class="ops-run__action-id">{actShort.label}</span>
                  <span class="ops-run__delivery">{action.deliveryState}</span>
                  {action.effects.length > 0 && (
                    <ul class="ops-run__effect-list" data-testid="ops-run-effects">
                      {action.effects.map((effect) => (
                        <li
                          key={effect.effectId}
                          class={`ops-run__effect ops-run__effect--${effect.state}`}
                          data-testid="ops-run-effect"
                          data-effect-state={effect.state}
                          title={`EffectId: ${effect.effectId}\nSlot: ${effect.slot}`}
                        >
                          <span class="ops-run__effect-slot">{effect.slot}</span>
                          <span class="ops-run__effect-id">
                            {shortId(effect.effectId).label}
                          </span>
                          <span class="ops-run__effect-state">{effect.state}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Waits — the server-projected blocked reasons. */}
      {root.waits.length > 0 && (
        <div class="ops-run__waits" data-testid="ops-run-waits">
          <span class="ops-run__section-label">
            {t('operations.detail.waits', { count: root.waits.length })}
          </span>
          <ul class="ops-run__wait-list">
            {root.waits.map((wait) => (
              <WaitReason key={wait.waitId} wait={wait} t={t} />
            ))}
          </ul>
        </div>
      )}

      {/* Terminal — only on terminal Runs (mutually exclusive with actions/waits). */}
      {root.terminal && <TerminalReason terminal={root.terminal} t={t} />}

      {/* review-cycle/1, parallel/1 and choice/1 — additive sections the server
          projects only when the Run's plan carries a review-cycle BoundedLoop
          (ECP-1), a FanOut or a Choice node (ECP-4). Absent sections render
          nothing, exactly like an empty frontier. */}
      {loopLifecycles.map((section) => (
        <BoundedLoopLifecycleSection
          key={section.loopPath}
          section={section}
          t={t}
        />
      ))}
      {(reviewCycle || goal) && loopLifecycles.length === 0 && unsupportedLoopLifecycles.length === 0 && (
        <p class="ops-run__compatibility-notice" data-testid="ops-loop-lifecycle-missing">
          {t('operations.loop_lifecycle.missing')}
        </p>
      )}
      {unsupportedLoopLifecycles.map((section) => (
        <p
          key={`${section.kind}/${section.version}`}
          class="ops-run__compatibility-notice"
          data-testid="ops-loop-lifecycle-unsupported"
          data-version={section.version}
        >
          {t('operations.loop_lifecycle.unsupported', { version: section.version })}
        </p>
      ))}
      {reviewCycle && <ReviewCycleSection section={reviewCycle} t={t} />}
      {goal && <GoalSection section={goal} t={t} />}
      {parallel && <ParallelSection section={parallel} t={t} />}
      {choice && <ChoiceSection section={choice} t={t} />}
      {consultation && <ConsultationObservabilityPanel section={consultation} />}

      {/* Drift — definition/capability/policy/workspace/source comparison. The
          facet names are localized; the observer's verdict on each
          (unchanged/changed/unavailable) is server vocabulary. */}
      <div class="ops-run__drift" data-testid="ops-run-drift">
        <span class="ops-run__section-label">{t('operations.drift.title')}</span>
        <div class="ops-run__drift-grid">
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.definition}`}>
            {t('operations.drift.definition')}: {view.drift.definition}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.capability}`}>
            {t('operations.drift.capability')}: {view.drift.capability}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.policy}`}>
            {t('operations.drift.policy')}: {view.drift.policy}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.workspace}`}>
            {t('operations.drift.workspace')}: {view.drift.workspace}
          </span>
          <span class={`ops-run__drift-cell ops-run__drift-cell--${view.drift.sourceRevision.semantic}`}>
            {t('operations.drift.source')}: {view.drift.sourceRevision.semantic}
          </span>
        </div>
      </div>

      {/* Allowed controls — rendered from server projection only. Submittable
          kinds (decision/resume/escalate/cancel) become interactive controls;
          accept-workspace-revision renders as a read-only badge (needs evidence
          the browser cannot produce). Other-workspace and terminal Runs have
          an empty allowedControls array server-side, so this section is absent
          for them (same conditional as actions/waits above). */}
      {root.allowedControls.length > 0 && unsupportedLoopLifecycles.length === 0 && (
        <div class="ops-run__controls" data-testid="ops-run-controls">
          <span class="ops-run__section-label">{t('operations.control.title')}</span>
          <ControlsSection
            key={runId}
            view={view}
            changeId={changeId}
            runId={runId}
            selector={selector}
            onViewReplaced={onViewReplaced}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

/** One Run summary row. Clicking opens its detail in the panel below. */
function RunSummaryRow({
  summary,
  isSelected,
  onSelect,
  t,
}: {
  summary: ReconcilerRunSummary;
  isSelected: boolean;
  onSelect: (runId: string) => void;
  t: Translate;
}) {
  const runIdShort = shortId(summary.runId);
  const hasError = !!summary.error;
  return (
    <li class="ops-summary-row" data-testid="ops-summary-row">
      <button
        type="button"
        class={`ops-summary-row__button${isSelected ? ' ops-summary-row__button--selected' : ''}`}
        data-testid="ops-summary-select"
        data-run-id={summary.runId}
        title={`RunId: ${summary.runId}`}
        disabled={hasError}
        onClick={() => onSelect(summary.runId)}
      >
        <span class="ops-summary-row__id">{runIdShort.label}</span>
        {hasError ? (
          <span class={`ops-run__status ops-run__status--error`} data-testid="ops-summary-error">
            {t('operations.summary.error', { code: summary.error!.code })}
          </span>
        ) : (
          <span class={`ops-run__status ${statusClass(summary.status)}`}>
            {summary.status}
          </span>
        )}
        <span class="ops-summary-row__source">{summary.sourceState}</span>
        {summary.waits !== undefined && summary.waits > 0 && (
          <span class="ops-summary-row__waits">
            {t(
              summary.waits === 1
                ? 'operations.summary.wait_count.one'
                : 'operations.summary.wait_count.other',
              { count: summary.waits }
            )}
          </span>
        )}
        {summary.terminal !== undefined && (
          <span class="ops-summary-row__terminal" data-testid="ops-summary-terminal">
            {t('operations.summary.terminal')}
          </span>
        )}
        <span class="ops-summary-row__version">
          {t('operations.detail.record_version', { version: summary.recordVersion })}
        </span>
      </button>
    </li>
  );
}

/** Fetches and displays the Run detail for the currently selected Run. */
function RunDetailPanel({
  changeId,
  runId,
  selector,
  onClose,
}: {
  changeId: string;
  runId: string;
  selector?: string;
  onClose: () => void;
}) {
  const t = useT();
  const [view, setView] = useState<ChangeRunView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
    client
      .getRunDetail(changeId, runId, selector)
      .then((v) => {
        if (cancelled) return;
        setView(v);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof ApiError ? err.message : t('operations.detail.load_error'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [changeId, runId, selector]);

  return (
    <div class="ops-run-detail" data-testid="ops-run-detail" data-run-id={runId}>
      <div class="ops-run-detail__header">
        <h4 class="ops-run-detail__title">
          {t('operations.detail.title')} <code title={runId}>{shortId(runId).label}</code>
        </h4>
        <button type="button" class="btn--ghost" data-testid="ops-run-detail-close" onClick={onClose}>
          {t('operations.detail.close')}
        </button>
      </div>
      {loading && <p class="ops-run-detail__loading">{t('operations.detail.loading')}</p>}
      {error && (
        <p class="ops-run-detail__error" role="alert" data-testid="ops-run-detail-error">
          {error}
        </p>
      )}
      {view && (
        <RunDetailBody
          view={view}
          changeId={changeId}
          runId={runId}
          selector={selector}
          onViewReplaced={setView}
          t={t}
        />
      )}
    </div>
  );
}

/**
 * The Operations section itself. Receives the full `RunsResponse` from the
 * page (which already polls `/api/v1/runs` alongside `/api/v1/tasks/:id`),
 * filters reconciler Runs to the Task's child change names, and groups them
 * per child without mixing planning spaces.
 */
export function RunOperationsPanel({
  runsResponse,
  selector,
  childNames,
  projectId,
  title,
}: {
  runsResponse: RunsResponse | null;
  selector?: string;
  /** The Task's child change names — used to group runs by child. */
  childNames: readonly string[];
  /** Exact Store member whose selector produced this response. */
  projectId?: string;
  title?: string;
}) {
  const t = useT();
  const [selectedRun, setSelectedRun] = useState<{ changeId: string; runId: string } | null>(null);

  const reconcilerRuns = runsResponse?.reconcilerRuns ?? [];
  // Group ALL reconciler runs by changeId — runs whose changeId matches a
  // child are shown under that child; any others (from other planning spaces
  // that happen to share the workspace) are grouped under "(other changes)".
  // The server already filters to the selected workspace, so this is a
  // safety net, not the primary filter.
  const byChange = groupByChange(reconcilerRuns);
  const childSet = new Set(childNames);
  const childGroups = Array.from(byChange.entries()).filter(([changeId]) =>
    childSet.has(changeId)
  );
  const otherGroups = Array.from(byChange.entries()).filter(
    ([changeId]) => !childSet.has(changeId)
  );

  if (reconcilerRuns.length === 0) {
    return null; // No reconciler runs — the section is absent, not empty.
  }

  return (
    <section
      class="task-detail__operations"
      aria-label={t('operations.aria')}
      data-testid="operations-section"
      data-project-id={projectId}
    >
      <h3 class="operations-section__title">{title ?? t('operations.title')}</h3>

      {childGroups.map(([changeId, summaries]) => (
        <div
          key={changeId}
          class="operations-section__group"
          data-testid="operations-group"
          data-change={changeId}
        >
          <h4 class="operations-section__group-title">{changeId}</h4>
          <ul class="operations-section__run-list">
            {summaries.map((s) => (
              <RunSummaryRow
                key={s.runId}
                summary={s}
                isSelected={
                  selectedRun?.runId === s.runId && selectedRun?.changeId === changeId
                }
                onSelect={(runId) =>
                  setSelectedRun({ changeId, runId })
                }
                t={t}
              />
            ))}
          </ul>
        </div>
      ))}

      {otherGroups.length > 0 && (
        <div class="operations-section__group operations-section__group--other" data-testid="operations-group-other">
          <h4 class="operations-section__group-title">{t('operations.group_other')}</h4>
          <ul class="operations-section__run-list">
            {otherGroups.flatMap(([, summaries]) =>
              summaries.map((s) => (
                <RunSummaryRow
                  key={s.runId}
                  summary={s}
                  isSelected={selectedRun?.runId === s.runId}
                  onSelect={(runId) =>
                    setSelectedRun({ changeId: s.changeId, runId })
                  }
                  t={t}
                />
              ))
            )}
          </ul>
        </div>
      )}

      {/* "Load more" pagination — uses the server's opaque cursor. */}
      {runsResponse?.hasMore && runsResponse.nextCursor && (
        <p class="operations-section__pagination" data-testid="operations-pagination">
          {t('operations.pagination')} <code>{runsResponse.nextCursor.slice(0, 16)}…</code>
        </p>
      )}

      {selectedRun && (
        <RunDetailPanel
          changeId={selectedRun.changeId}
          runId={selectedRun.runId}
          selector={selector}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </section>
  );
}

/** Task-detail compatibility wrapper over the reusable project-tagged panel. */
export function OperationsSection(props: {
  runsResponse: RunsResponse | null;
  selector?: string;
  childNames: readonly string[];
}) {
  return <RunOperationsPanel {...props} />;
}
