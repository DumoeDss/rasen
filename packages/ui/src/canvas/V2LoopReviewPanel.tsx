/**
 * Review dialog for turning a drawn back-edge into a bounded loop
 * (canvas-backedge-loop-inference design D6): the author sees the drawn
 * endpoints and the enclosed region (read-only — the region is computed, the
 * author who wants a different region draws a different back-edge), edits the
 * derived declaration contract rows, sets the iteration bound and the exit
 * outcome, and confirms. Presentational — the page computed the region and
 * defaults via `backedgeRegion`/`deriveSubgraphContract`, the model
 * (`synthesizeBoundedLoopFromBackedge`) re-validates every rule on confirm,
 * and the model's thrown message comes back as the `error` prop (the same
 * overlay pattern as `V2ExtractReviewPanel`, whose rows UX this reuses via
 * the exported `PortListEditor`/`NameListField`).
 *
 * The iteration bound rides the authoring-draft-errors discipline through
 * `IntegerContractField`: invalid text lives outside the Definition wire
 * draft and BLOCKS confirm (`integerDraftError` non-null disables the submit)
 * until repaired. The page owns the `loop-review:maxIterations` error scope
 * and clears it when the review closes.
 *
 * Refusals (`subgraphExtractionRefusals` computed at open against the live
 * draft) render in place of the Confirm button — an unextractable region
 * offers no confirm, only cancel. Mounted fresh per open (conditionally
 * rendered), so local state never carries across openings; modal by
 * construction.
 *
 * The definition's outcomes arrive as a prop read LIVE from the draft
 * (canvas-root-contract-editor design D5), and while that list is empty the
 * review renders its inline declare affordance (design D3's one carve-out:
 * this modal's overlay covers the contract panel, the single home for
 * declaring, so the review borrows a thin write instead of blocking it) — a
 * name plus confirm that hands the page one `onDeclareOutcome(name)` call;
 * the panel decides nothing (no local append, no rule copy).
 */
import { useEffect, useState } from 'preact/hooks';
import type {
  WireDefinitionArtifact,
  WireDefinitionPort,
} from '../api/types.js';
import { NameListField, PortListEditor } from './DeclarationsPanel.js';
import {
  IntegerContractField,
  type IntegerContractDraftError,
} from './IntegerContractField.js';

/** What the review confirmed — `synthesizeBoundedLoopFromBackedge`'s input half. */
export interface BoundedLoopSynthesisReview {
  id: string;
  inputs: WireDefinitionPort[];
  artifacts: WireDefinitionArtifact[];
  outcomes: string[];
  maxIterations: number;
  exitOutcome: string;
}

export function V2LoopReviewPanel({
  from,
  to,
  regionNodeIds,
  definitionOutcomes,
  defaultId,
  derived,
  defaultMaxIterations,
  refusals,
  integerDraftError,
  onIntegerDraftError,
  onDeclareOutcome,
  error,
  onConfirm,
  onCancel,
}: {
  /** The drawn back-edge's endpoints (`from -> to`; never written to the draft). */
  from: string;
  to: string;
  /** The enclosed region, in `backedgeRegion` order — read-only. */
  regionNodeIds: readonly string[];
  /**
   * The definition's CURRENT outcomes (a live prop, design D5) — the
   * exit-outcome select's option set, and the flag for the inline declare.
   */
  definitionOutcomes: readonly string[];
  /** `loop-body`, `loop-body-2`, … — minted by the page via `isDeclarationIdUnique`. */
  defaultId: string;
  /** The derivation the dialog opened with (`deriveSubgraphContract`). */
  derived: {
    inputs: WireDefinitionPort[];
    artifacts: WireDefinitionArtifact[];
    outcomes: string[];
  };
  /** The iteration bound the dialog opens with (the gesture's default, 3). */
  defaultMaxIterations: number;
  /** Why the region cannot be extracted right now — non-empty hides Confirm. */
  refusals: readonly string[];
  /** The page's authoring-draft error for `loop-review:maxIterations`, if any. */
  integerDraftError: IntegerContractDraftError | null;
  onIntegerDraftError: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  /**
   * The inline declare's thin callback (design D3): the page performs one
   * `declareDefinitionOutcome` transaction; the panel keeps no model logic.
   */
  onDeclareOutcome: (name: string) => void;
  /** The model's last confirm-time refusal, if confirm was refused. */
  error: string | null;
  onConfirm: (review: BoundedLoopSynthesisReview) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(defaultId);
  const [inputs, setInputs] = useState(derived.inputs);
  const [artifacts, setArtifacts] = useState(derived.artifacts);
  const [outcomes, setOutcomes] = useState(derived.outcomes);
  const [maxIterations, setMaxIterations] = useState(defaultMaxIterations);
  const [exitOutcome, setExitOutcome] = useState(definitionOutcomes[0] ?? '');
  const [declareName, setDeclareName] = useState('');
  // The exit select initialized empty (no outcomes declared at open); once
  // the inline declare lands one, adopt it so the select shows — and confirm
  // submits — the outcome the author just declared.
  useEffect(() => {
    if (!exitOutcome && definitionOutcomes.length > 0) {
      setExitOutcome(definitionOutcomes[0] ?? '');
    }
  }, [definitionOutcomes, exitOutcome]);
  const blocked = integerDraftError !== null || refusals.length > 0;
  return (
    <div class="pipeline-canvas__dialog-overlay" data-testid="v2-loop-review-panel">
      <form
        class="pipeline-canvas__dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (blocked) return;
          onConfirm({ id, inputs, artifacts, outcomes, maxIterations, exitOutcome });
        }}
      >
        <h3>Turn back-edge into bounded loop</h3>
        <p class="stage-panel__muted" data-testid="v2-loop-review-endpoints">
          Drawn back-edge: {from} → {to}
        </p>
        <p class="stage-panel__muted" data-testid="v2-loop-review-region">
          Enclosed region ({regionNodeIds.length}): {regionNodeIds.join(', ')}
        </p>
        <label>
          <span>Declaration id</span>
          <input
            type="text"
            data-testid="v2-loop-review-id"
            value={id}
            onInput={(event) => setId((event.target as HTMLInputElement).value)}
          />
        </label>
        <IntegerContractField
          label="Max iterations"
          value={maxIterations}
          minimum={1}
          allowClear={false}
          field="loop-review:maxIterations"
          resetKey={defaultId}
          testId="v2-loop-review-max-iterations"
          className="definition-contract__field"
          draftError={integerDraftError ?? undefined}
          onDraftError={onIntegerDraftError}
          onValue={(value) => {
            if (value !== null) setMaxIterations(value);
          }}
        />
        <label>
          <span>Exit outcome</span>
          <select
            data-testid="v2-loop-review-exit-outcome"
            value={exitOutcome}
            onChange={(event) =>
              setExitOutcome((event.target as HTMLSelectElement).value)
            }
          >
            {definitionOutcomes.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </label>
        {definitionOutcomes.length === 0 && (
          <div
            class="stage-panel__section"
            data-testid="v2-loop-review-declare"
          >
            <p class="stage-panel__muted">
              The definition declares no outcomes, so there is nothing to exit
              on. Declare one here (the definition contract panel, the usual
              home, is behind this dialog) and the exit choice above picks it
              up:
            </p>
            <input
              type="text"
              data-testid="v2-loop-review-declare-name"
              aria-label="Declare outcome name"
              value={declareName}
              onInput={(event) =>
                setDeclareName((event.target as HTMLInputElement).value)
              }
            />
            <button
              type="button"
              data-testid="v2-loop-review-declare-confirm"
              disabled={!declareName.trim()}
              onClick={() => onDeclareOutcome(declareName.trim())}
            >
              Declare outcome
            </button>
          </div>
        )}
        <PortListEditor
          label="Inputs"
          testIdPrefix="v2-loop-review-input"
          ports={inputs}
          onCommit={setInputs}
        />
        <PortListEditor
          label="Artifacts"
          testIdPrefix="v2-loop-review-artifact"
          ports={artifacts}
          onCommit={setArtifacts}
        />
        <NameListField
          label="Outcomes"
          testId="v2-loop-review-outcomes"
          value={outcomes}
          onCommit={setOutcomes}
        />
        {error && (
          <p
            class="pipeline-canvas__dialog-error"
            role="alert"
            data-testid="v2-loop-review-error"
          >
            {error}
          </p>
        )}
        {refusals.length > 0 ? (
          <div
            class="stage-panel__muted"
            data-testid="v2-loop-review-refusals"
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
              data-testid="v2-loop-review-confirm"
              disabled={blocked}
            >
              Create loop
            </button>
          )}
          <button type="button" data-testid="v2-loop-review-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
