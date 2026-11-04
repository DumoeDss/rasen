/**
 * Review dialog for packaging a selection into a reusable declaration
 * (canvas-subgraph-extraction design D4): the author names the declaration,
 * edits the derived input/artifact/outcome rows, sees the body summary, and
 * confirms. Presentational — the page computed the defaults via
 * `deriveSubgraphContract`, the model (`extractSubgraph`) re-validates every
 * rule on confirm, and the model's thrown message comes back as the `error`
 * prop (the `duplicateDialog` overlay pattern). The rows reuse the
 * declarations editor's own `PortListEditor`/`NameListField` so there is one
 * implementation of the contract-list editing UX.
 *
 * Mounted fresh per open (the page conditionally renders on its review
 * state), so local state initialized from the props never carries across
 * openings. Modal by construction: the overlay blocks interaction with the
 * canvas, so the selection cannot change underneath the review.
 */
import { useState } from 'preact/hooks';
import type {
  WireDefinitionArtifact,
  WireDefinitionPort,
} from '../api/types.js';
import { NameListField, PortListEditor } from './DeclarationsPanel.js';

/** What the review confirmed — `extractSubgraph`'s reviewed contract. */
export interface SubgraphExtractionReview {
  id: string;
  inputs: WireDefinitionPort[];
  artifacts: WireDefinitionArtifact[];
  outcomes: string[];
}

export function V2ExtractReviewPanel({
  defaultId,
  derived,
  bodySummary,
  error,
  onConfirm,
  onCancel,
}: {
  /** `block`, `block-2`, … — minted by the page via `isDeclarationIdUnique`. */
  defaultId: string;
  /** The derivation the dialog opened with (`deriveSubgraphContract`). */
  derived: {
    inputs: WireDefinitionPort[];
    artifacts: WireDefinitionArtifact[];
    outcomes: string[];
  };
  bodySummary: { stageCount: number; internalConnectionCount: number };
  /** The model's last refusal/validation message, if confirm was refused. */
  error: string | null;
  onConfirm: (review: SubgraphExtractionReview) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(defaultId);
  const [inputs, setInputs] = useState(derived.inputs);
  const [artifacts, setArtifacts] = useState(derived.artifacts);
  const [outcomes, setOutcomes] = useState(derived.outcomes);
  return (
    <div class="pipeline-canvas__dialog-overlay" data-testid="v2-extract-review-panel">
      <form
        class="pipeline-canvas__dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({ id, inputs, artifacts, outcomes });
        }}
      >
        <h3>Package into reusable block</h3>
        <label>
          <span>Declaration id</span>
          <input
            type="text"
            data-testid="v2-extract-review-id"
            value={id}
            onInput={(event) => setId((event.target as HTMLInputElement).value)}
          />
        </label>
        <p class="stage-panel__muted" data-testid="v2-extract-review-summary">
          {bodySummary.stageCount} stage{bodySummary.stageCount === 1 ? '' : 's'} ·{' '}
          {bodySummary.internalConnectionCount} internal connection
          {bodySummary.internalConnectionCount === 1 ? '' : 's'} · cut:{' '}
          {derived.inputs.length} input{derived.inputs.length === 1 ? '' : 's'},{' '}
          {derived.outcomes.length} outcome{derived.outcomes.length === 1 ? '' : 's'}
        </p>
        <PortListEditor
          label="Inputs"
          testIdPrefix="v2-extract-review-input"
          ports={inputs}
          onCommit={setInputs}
        />
        <PortListEditor
          label="Artifacts"
          testIdPrefix="v2-extract-review-artifact"
          ports={artifacts}
          onCommit={setArtifacts}
        />
        <NameListField
          label="Outcomes"
          testId="v2-extract-review-outcomes"
          value={outcomes}
          onCommit={setOutcomes}
        />
        {error && (
          <p
            class="pipeline-canvas__dialog-error"
            role="alert"
            data-testid="v2-extract-review-error"
          >
            {error}
          </p>
        )}
        <div class="pipeline-canvas__dialog-actions">
          <button type="submit" data-testid="v2-extract-review-confirm">
            Package
          </button>
          <button
            type="button"
            data-testid="v2-extract-review-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
