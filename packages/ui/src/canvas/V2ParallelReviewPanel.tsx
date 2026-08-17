/**
 * Review dialog for turning a drawn fan-out/reconverge shape into a parallel
 * frontier pair (canvas-parallel-frontier-inference design D3): the author
 * sees the drawn source and target read-only (detection computed them — the
 * author who wants a different shape draws different connections), the clean
 * branch list with a required-versus-optional choice each (default all
 * required, `createParallelPair`'s own default), the concurrency cap and
 * budget, and the proceed and failed outcome picks from the definition's
 * outcomes. Presentational — the page computed the detection defaults, the
 * model (`synthesizeParallelFrontier`) re-validates every rule on confirm,
 * and the model's thrown message comes back as the `error` prop (the same
 * overlay pattern as `V2LoopReviewPanel`).
 *
 * Cap and budget ride the authoring-draft-errors discipline through
 * `IntegerContractField`: invalid text lives outside the Definition wire
 * draft and BLOCKS confirm until repaired. The page owns the
 * `parallel-review:concurrencyCap` / `parallel-review:budget` error scopes
 * and clears them when the review closes.
 *
 * Refusals (re-detection at open against the live draft) render in place of
 * the Confirm button — a shape that is no longer a clean frontier offers no
 * confirm, only cancel. Mounted fresh per open (conditionally rendered), so
 * local state never carries across openings; modal by construction.
 */
import { useState } from 'preact/hooks';
import {
  IntegerContractField,
  type IntegerContractDraftError,
} from './IntegerContractField.js';

/** What the review confirmed — `synthesizeParallelFrontier`'s input half. */
export interface ParallelFrontierReview {
  members: Array<{ id: string; required: boolean }>;
  concurrencyCap: number;
  budget: number;
  outcomes: { proceed: string; failed: string };
}

export function V2ParallelReviewPanel({
  source,
  target,
  branchIds,
  definitionOutcomes,
  defaultConcurrencyCap,
  defaultBudget,
  refusals,
  capDraftError,
  budgetDraftError,
  onIntegerDraftError,
  error,
  onConfirm,
  onCancel,
}: {
  /** The drawn sandwich's outer endpoints — read-only. */
  source: string;
  target: string;
  /** The clean branches, in `detectParallelFrontiers` order — read-only. */
  branchIds: readonly string[];
  /** The definition's outcomes — the outcome selects' option set. */
  definitionOutcomes: readonly string[];
  /** The cap the dialog opens with (`addParallelFrontier`'s default). */
  defaultConcurrencyCap: number;
  /** The budget the dialog opens with (`addParallelFrontier`'s default). */
  defaultBudget: number;
  /** Why the frontier cannot be synthesized right now — non-empty hides Confirm. */
  refusals: readonly string[];
  /** The page's authoring-draft error for `parallel-review:concurrencyCap`. */
  capDraftError: IntegerContractDraftError | null;
  /** The page's authoring-draft error for `parallel-review:budget`. */
  budgetDraftError: IntegerContractDraftError | null;
  onIntegerDraftError: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  /** The model's last confirm-time refusal, if confirm was refused. */
  error: string | null;
  onConfirm: (review: ParallelFrontierReview) => void;
  onCancel: () => void;
}) {
  const [requiredByMember, setRequiredByMember] = useState<Record<string, boolean>>(
    () => Object.fromEntries(branchIds.map((id) => [id, true]))
  );
  const [concurrencyCap, setConcurrencyCap] = useState(defaultConcurrencyCap);
  const [budget, setBudget] = useState(defaultBudget);
  const [proceedOutcome, setProceedOutcome] = useState(
    definitionOutcomes[0] ?? 'done'
  );
  const [failedOutcome, setFailedOutcome] = useState(
    definitionOutcomes[1] ?? 'failed'
  );
  const resetKey = `${source}->${target}`;
  const blocked =
    capDraftError !== null || budgetDraftError !== null || refusals.length > 0;
  return (
    <div class="pipeline-canvas__dialog-overlay" data-testid="v2-parallel-review-panel">
      <form
        class="pipeline-canvas__dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked) return;
          onConfirm({
            members: branchIds.map((id) => ({
              id,
              required: requiredByMember[id] !== false,
            })),
            concurrencyCap,
            budget,
            outcomes: { proceed: proceedOutcome, failed: failedOutcome },
          });
        }}
      >
        <h3>Run branches in parallel</h3>
        <p class="stage-panel__muted" data-testid="v2-parallel-review-route">
          {source} → fan-out → {branchIds.length} branches → barrier → {target}
        </p>
        {branchIds.map((id) => (
          <label
            key={id}
            data-testid="v2-parallel-review-member"
            data-member-id={id}
          >
            <input
              type="checkbox"
              data-testid="v2-parallel-review-member-required"
              data-member-id={id}
              checked={requiredByMember[id] !== false}
              onChange={(event) =>
                setRequiredByMember((current) => ({
                  ...current,
                  [id]: (event.target as HTMLInputElement).checked,
                }))
              }
            />
            <span>{id}</span>
            <span class="stage-panel__muted">
              {requiredByMember[id] !== false ? 'required' : 'optional'}
            </span>
          </label>
        ))}
        <IntegerContractField
          label="Concurrency cap"
          value={concurrencyCap}
          minimum={1}
          allowClear={false}
          field="parallel-review:concurrencyCap"
          resetKey={resetKey}
          testId="v2-parallel-review-concurrency-cap"
          className="definition-contract__field"
          draftError={capDraftError ?? undefined}
          onDraftError={onIntegerDraftError}
          onValue={(value) => {
            if (value !== null) setConcurrencyCap(value);
          }}
        />
        <IntegerContractField
          label="Budget"
          value={budget}
          minimum={1}
          allowClear={false}
          field="parallel-review:budget"
          resetKey={resetKey}
          testId="v2-parallel-review-budget"
          className="definition-contract__field"
          draftError={budgetDraftError ?? undefined}
          onDraftError={onIntegerDraftError}
          onValue={(value) => {
            if (value !== null) setBudget(value);
          }}
        />
        <label>
          <span>Proceed outcome</span>
          <select
            data-testid="v2-parallel-review-proceed-outcome"
            value={proceedOutcome}
            onChange={(event) =>
              setProceedOutcome((event.target as HTMLSelectElement).value)
            }
          >
            {definitionOutcomes.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Failed outcome</span>
          <select
            data-testid="v2-parallel-review-failed-outcome"
            value={failedOutcome}
            onChange={(event) =>
              setFailedOutcome((event.target as HTMLSelectElement).value)
            }
          >
            {definitionOutcomes.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p
            class="pipeline-canvas__dialog-error"
            role="alert"
            data-testid="v2-parallel-review-error"
          >
            {error}
          </p>
        )}
        {refusals.length > 0 ? (
          <div
            class="stage-panel__muted"
            data-testid="v2-parallel-review-refusals"
          >
            {refusals.map((refusal, index) => (
              <p key={index}>{refusal}</p>
            ))}
          </div>
        ) : null}
        <div class="pipeline-canvas__dialog-actions">
          {refusals.length === 0 && (
            <button
              type="submit"
              data-testid="v2-parallel-review-confirm"
              disabled={blocked}
            >
              Create parallel frontier
            </button>
          )}
          <button type="button" data-testid="v2-parallel-review-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
