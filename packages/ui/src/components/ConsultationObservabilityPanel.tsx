/**
 * Read-only consultation observability panel. Renders projection facts only —
 * state badges, counters, identities, and failure reasons from the canonical
 * `consultation/1` view section. Does NOT render advice bodies, question
 * content, evidence content, session diagnostics, or backend-private
 * references. Does NOT offer continuation, retry, cancel, or any interactive
 * execution control.
 */
import type { ConsultationViewSection } from '../api/types.js';

const STATE_LABELS: Record<string, string> = {
  requested: 'requested',
  'teacher-active': 'teacher-active',
  'advice-committed': 'advice-committed',
  'continuation-granted': 'continuation-granted',
  continued: 'continued',
  unavailable: 'unavailable',
  'continuation-outcome-unknown': 'continuation-outcome-unknown',
  closed: 'closed',
};

const ADVICE_DECISION_LABELS: Record<string, string> = {
  plan: 'plan',
  correction: 'correction',
  stop: 'stop',
};

function shortId(fullId: string): string {
  return fullId.slice(0, 12);
}

export function ConsultationObservabilityPanel({
  section,
}: {
  section: ConsultationViewSection;
}) {
  return (
    <div
      class="ops-run__consultation"
      data-testid="consultation-observability-panel"
    >
      <span class="ops-run__section-label">Consultation</span>
      <ul class="ops-run__consultation-list">
        {section.entries.map((entry) => (
          <li
            key={entry.consultationId}
            class={`ops-run__consultation-entry ops-run__consultation-entry--${entry.state}`}
            data-testid="consultation-observability-entry"
            data-state={entry.state}
            data-ordinal={entry.ordinal}
          >
            <div class="ops-run__consultation-header">
              <span
                class={`ops-run__consultation-state ops-run__consultation-state--${entry.state}`}
                data-testid="consultation-state-badge"
              >
                {STATE_LABELS[entry.state] ?? entry.state}
              </span>
              <span class="ops-run__consultation-id" title={entry.consultationId}>
                {shortId(entry.consultationId)}
              </span>
              <span class="ops-run__consultation-ordinal">
                #{entry.ordinal}
              </span>
            </div>

            <dl class="ops-run__consultation-meta">
              <dt>Source</dt>
              <dd data-testid="consultation-source-model">
                {entry.source.model} / {entry.source.runtime}
              </dd>

              {entry.teacher.model && (
                <>
                  <dt>Teacher</dt>
                  <dd data-testid="consultation-teacher-model">
                    {entry.teacher.model} / {entry.teacher.runtime}
                  </dd>
                </>
              )}

              {entry.teacher.adviceDecision && (
                <>
                  <dt>Advice</dt>
                  <dd
                    class={`ops-run__consultation-advice ops-run__consultation-advice--${entry.teacher.adviceDecision}`}
                    data-testid="consultation-advice-decision"
                  >
                    {ADVICE_DECISION_LABELS[entry.teacher.adviceDecision] ??
                      entry.teacher.adviceDecision}
                  </dd>
                </>
              )}

              <dt>Consultations</dt>
              <dd data-testid="consultation-counter-consultations">
                {entry.counters.consultations.used} / {entry.counters.consultations.max}
              </dd>

              <dt>Teacher attempts</dt>
              <dd data-testid="consultation-counter-attempts">
                {entry.counters.teacherAttempts.used} / {entry.counters.teacherAttempts.max}
              </dd>

              {entry.continuation && (
                <>
                  <dt>Continuation</dt>
                  <dd
                    class={`ops-run__consultation-continuation ops-run__consultation-continuation--${entry.continuation.state}`}
                    data-testid="consultation-continuation-state"
                  >
                    {entry.continuation.state}
                  </dd>
                </>
              )}

              {entry.failure && (
                <>
                  <dt>Failure</dt>
                  <dd
                    class="ops-run__consultation-failure"
                    data-testid="consultation-failure"
                  >
                    {entry.failure.code}
                    {entry.failure.detail ? `: ${entry.failure.detail}` : ''}
                  </dd>
                </>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
