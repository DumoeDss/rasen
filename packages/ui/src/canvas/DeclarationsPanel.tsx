import { useState } from 'preact/hooks';
import type {
  WireCompositeDeclaration,
  WireDefinitionArtifact,
  WireDefinitionPort,
  WirePipelineDefinitionV2,
} from '../api/types.js';
import { V2_BODY_PALETTE_KINDS } from './draft.js';

/**
 * Custom Composite declaration authoring (ECP-2 tasks 8.5 and 8.6, delivered
 * by ECP-5 as a user-approved scope addition).
 *
 * ECP-2's shipped `executable-custom-composite` delta requires that "The Canvas
 * SHALL allow the user to create a new `CompositeDeclaration` with a unique id,
 * provenance `custom`, declared inputs, artifacts, outcomes, and a body graph",
 * that its contract fields be editable ("Requirement: Canvas edits composite
 * declaration scalar fields"), that body `AtomicStage` nodes be addable and
 * removable, and that "The Canvas SHALL NOT allow deleting a declaration that
 * is still referenced by a root-level `CompositeRef` or `BoundedLoop`".
 *
 * The pure model for all of that already existed and was unit-tested in
 * `draft.ts` (`addDeclaration`, `updateDeclaration`, `removeDeclaration`,
 * `addBodyStage`, `removeBodyStage`) — it had ZERO callers in `src`, so the
 * requirement was unreachable. This panel is the missing affordance; it holds
 * no model logic of its own, and every mutation is delegated to the caller so
 * the draft stays the single source of truth (the same discipline the rest of
 * the canvas follows).
 *
 * The body palette reads {@link V2_BODY_PALETTE_KINDS} rather than listing
 * kinds itself — task 8.6's constraint is a fact about the vocabulary, and this
 * canvas has already been bitten by four independent encodings of "which kinds
 * may be edited" drifting apart.
 */
export function DeclarationsPanel({
  definition,
  selectedId,
  capabilityAvailable,
  onSelect,
  onCreate,
  onDelete,
  onPatch,
  onAddBodyStage,
  onRemoveBodyStage,
}: {
  definition: WirePipelineDefinitionV2;
  selectedId: string | null;
  /** Whether the trusted catalog can supply an exact capability revision. */
  capabilityAvailable: boolean;
  onSelect: (id: string | null) => void;
  onCreate: (id: string) => void;
  onDelete: (id: string) => void;
  onPatch: (
    id: string,
    patch: Partial<{
      inputs: WireDefinitionPort[];
      artifacts: WireDefinitionArtifact[];
      outcomes: string[];
    }>
  ) => void;
  onAddBodyStage: (declarationId: string) => void;
  onRemoveBodyStage: (declarationId: string, stageId: string) => void;
}) {
  const [newId, setNewId] = useState('');
  const declarations = definition.declarations ?? [];
  const selected = declarations.find((d) => d.id === selectedId) ?? null;

  return (
    <aside class="declarations-panel" data-testid="declarations-panel">
      <h3 class="declarations-panel__title">Declarations</h3>

      <div class="declarations-panel__new">
        <input
          type="text"
          data-testid="declaration-new-id"
          placeholder="new declaration id"
          value={newId}
          onInput={(event) => setNewId((event.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          data-testid="declaration-create"
          // A blank id cannot be a declaration id; uniqueness is the model's
          // call (`addDeclaration` throws) and is surfaced as a toast, not
          // pre-judged here — one owner of the rule.
          disabled={newId.trim().length === 0}
          onClick={() => {
            onCreate(newId.trim());
            setNewId('');
          }}
        >
          Add declaration
        </button>
      </div>

      <ul class="declarations-panel__list">
        {declarations.map((declaration) => (
          <li
            key={declaration.id}
            class={`declarations-panel__item${
              declaration.id === selectedId ? ' declarations-panel__item--selected' : ''
            }`}
            data-testid="declaration-row"
            data-declaration-id={declaration.id}
            data-provenance={declaration.provenance}
          >
            <button
              type="button"
              class="declarations-panel__select"
              data-testid="declaration-select"
              data-declaration-id={declaration.id}
              onClick={() =>
                onSelect(declaration.id === selectedId ? null : declaration.id)
              }
            >
              {declaration.id}
              {declaration.provenance === 'built-in' ? ' (built-in)' : ''}
            </button>
            <button
              type="button"
              class="declarations-panel__delete"
              data-testid="declaration-delete"
              data-declaration-id={declaration.id}
              onClick={() => onDelete(declaration.id)}
            >
              Delete
            </button>
          </li>
        ))}
        {declarations.length === 0 && (
          <li class="declarations-panel__empty" data-testid="declarations-empty">
            No declarations yet.
          </li>
        )}
      </ul>

      {selected && (
        <DeclarationEditor
          key={selected.id}
          declaration={selected}
          capabilityAvailable={capabilityAvailable}
          onPatch={(patch) => onPatch(selected.id, patch)}
          onAddBodyStage={() => onAddBodyStage(selected.id)}
          onRemoveBodyStage={(stageId) => onRemoveBodyStage(selected.id, stageId)}
        />
      )}
    </aside>
  );
}

/** One editable comma-separated name list (outcomes). */
function NameListField({
  label,
  testId,
  value,
  onCommit,
}: {
  label: string;
  testId: string;
  value: readonly string[];
  onCommit: (next: string[]) => void;
}) {
  const authoritative = value.join(',');
  const [draft, setDraft] = useState(authoritative);
  return (
    <label class="declaration-editor__field">
      <span>{label}</span>
      <input
        type="text"
        data-testid={testId}
        value={draft}
        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
        // Commit on blur, like the Gate/Choice outcomes editor: a raw draft
        // survives intermediate keystrokes (typing "a," must not drop the
        // trailing separator) and only the canonical parse reaches the model.
        onBlur={() => {
          const next = Array.from(
            new Set(
              draft
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            )
          );
          onCommit(next);
          setDraft(next.join(','));
        }}
      />
    </label>
  );
}

/**
 * Editable `name: type` port rows with add/remove/rename, used for both the
 * declared inputs and the declared artifacts (identical shape on the wire).
 */
function PortListEditor({
  label,
  testIdPrefix,
  ports,
  onCommit,
}: {
  label: string;
  testIdPrefix: string;
  ports: readonly { name: string; type: string }[];
  onCommit: (next: { name: string; type: string }[]) => void;
}) {
  return (
    <div class="declaration-editor__field" data-testid={`${testIdPrefix}-list`}>
      <span>
        {label} ({ports.length})
      </span>
      <ul class="declaration-editor__ports">
        {ports.map((port, index) => (
          <li key={`${index}`} data-testid={`${testIdPrefix}-row`} data-port-name={port.name}>
            <input
              type="text"
              data-testid={`${testIdPrefix}-name`}
              data-port-index={index}
              value={port.name}
              onInput={(event) => {
                const next = ports.map((entry, i) =>
                  i === index
                    ? { ...entry, name: (event.target as HTMLInputElement).value }
                    : entry
                );
                onCommit(next);
              }}
            />
            <input
              type="text"
              data-testid={`${testIdPrefix}-type`}
              data-port-index={index}
              value={port.type}
              onInput={(event) => {
                const next = ports.map((entry, i) =>
                  i === index
                    ? { ...entry, type: (event.target as HTMLInputElement).value }
                    : entry
                );
                onCommit(next);
              }}
            />
            <button
              type="button"
              data-testid={`${testIdPrefix}-remove`}
              data-port-index={index}
              onClick={() => onCommit(ports.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        data-testid={`${testIdPrefix}-add`}
        onClick={() => onCommit([...ports, { name: `${testIdPrefix}-${ports.length + 1}`, type: 'artifact/text' }])}
      >
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}

/**
 * The declaration editor sub-panel: contract fields (inputs, artifacts,
 * outcomes) plus the body graph navigator and its constrained palette.
 */
function DeclarationEditor({
  declaration,
  capabilityAvailable,
  onPatch,
  onAddBodyStage,
  onRemoveBodyStage,
}: {
  declaration: WireCompositeDeclaration;
  capabilityAvailable: boolean;
  onPatch: (
    patch: Partial<{
      inputs: WireDefinitionPort[];
      artifacts: WireDefinitionArtifact[];
      outcomes: string[];
    }>
  ) => void;
  onAddBodyStage: () => void;
  onRemoveBodyStage: (stageId: string) => void;
}) {
  const inputs = declaration.inputs ?? [];
  const artifacts = declaration.artifacts ?? [];
  const outcomes = declaration.outcomes ?? [];
  const bodyNodes = (declaration.graph?.nodes ?? []) as ReadonlyArray<{
    id: string;
    kind: string;
    capability?: { id: string; version: string };
  }>;

  return (
    <div
      class="declaration-editor"
      data-testid="declaration-editor"
      data-declaration-id={declaration.id}
    >
      <h4 class="declaration-editor__title">{declaration.id}</h4>

      <PortListEditor
        label="Inputs"
        testIdPrefix="declaration-input"
        ports={inputs}
        onCommit={(next) => onPatch({ inputs: next as WireDefinitionPort[] })}
      />
      <PortListEditor
        label="Artifacts"
        testIdPrefix="declaration-artifact"
        ports={artifacts}
        onCommit={(next) => onPatch({ artifacts: next as WireDefinitionArtifact[] })}
      />
      <NameListField
        label="Outcomes"
        testId="declaration-outcomes"
        value={outcomes}
        onCommit={(next) => onPatch({ outcomes: next })}
      />

      {/* Body graph navigator + the constrained body palette (task 8.6). */}
      <div class="declaration-editor__body" data-testid="declaration-body">
        <span>Body stages ({bodyNodes.length})</span>
        <ol class="declaration-editor__body-stages">
          {bodyNodes.map((node) => (
            <li
              key={node.id}
              data-testid="declaration-body-stage"
              data-stage-id={node.id}
              data-stage-kind={node.kind}
            >
              <span class="declaration-editor__body-stage-id">{node.id}</span>
              <span class="declaration-editor__body-stage-kind">{node.kind}</span>
              {node.capability && (
                <span class="declaration-editor__body-stage-capability">
                  {node.capability.id}
                </span>
              )}
              <button
                type="button"
                data-testid="declaration-body-stage-remove"
                data-stage-id={node.id}
                onClick={() => onRemoveBodyStage(node.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
        <div class="declaration-editor__body-palette" data-testid="declaration-body-palette">
          {V2_BODY_PALETTE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`v2-body-palette-add-${kind}`}
              // Same rule as the root palette's AtomicStage entry: a body stage
              // must bind an exact capability revision, so without one the
              // action is unavailable rather than failing on click.
              disabled={!capabilityAvailable}
              onClick={onAddBodyStage}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
