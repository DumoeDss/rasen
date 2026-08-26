import { useEffect, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import type {
  PipelineCatalogResponse,
  WireAtomicStageNode,
  WireCompositeDeclaration,
  WireDefinitionArtifact,
  WireDefinitionPort,
  WireGoalCyclePhase,
  WirePipelineDefinitionV2,
  WireReviewCyclePhase,
} from '../api/types.js';
import {
  V2_BODY_PALETTE_KINDS,
  isReferenceableDeclaration,
  type AtomicStageExecutionPatch,
} from './draft.js';
import { V2ExecutionEditor } from './V2ExecutionEditor.js';

interface SelectedBodyConnectionIssue {
  declarationId: string;
  id: string;
  field: string | null;
  severity: 'error' | 'warning';
}

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
  selectedIssueDeclarationId,
  selectedBodyStageId,
  selectedBodyStageSeverity,
  selectedBodyConnectionIssue,
  focusedField,
  catalog,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onPatch,
  onAddBodyStage,
  onRemoveBodyStage,
  onPatchBodyStage,
  onPatchBodyExecution,
  onAddBodyConnection,
  onRemoveBodyConnection,
  onInsertRef,
}: {
  definition: WirePipelineDefinitionV2;
  selectedId: string | null;
  selectedIssueDeclarationId?: string | null;
  selectedBodyStageId?: string | null;
  selectedBodyStageSeverity?: 'error' | 'warning' | null;
  selectedBodyConnectionIssue?: SelectedBodyConnectionIssue | null;
  focusedField?: string | null;
  /**
   * The trusted catalog's enabled exact capability revisions — the same list
   * the root graph's node panel offers. Whether a body stage CAN be added and
   * which capability it may carry are one fact, so they read from one prop:
   * `capabilities.length > 0` is exactly "the catalog can supply a revision".
   */
  catalog: PipelineCatalogResponse | null;
  onSelect: (id: string | null) => void;
  onCreate: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, nextId: string) => void;
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
  onPatchBodyStage: (
    declarationId: string,
    stageId: string,
    patch: Partial<{
      id: string;
      capability: { id: string; version: string };
      reviewCyclePhase?: WireReviewCyclePhase;
      goalCyclePhase?: WireGoalCyclePhase;
    }>
  ) => void;
  onPatchBodyExecution: (
    declarationId: string,
    stageId: string,
    patch: AtomicStageExecutionPatch
  ) => void;
  onAddBodyConnection: (declarationId: string, from: string, to: string) => void;
  onRemoveBodyConnection: (declarationId: string, connectionId: string) => void;
  /** Appends a `CompositeRef` targeting this declaration to the root graph
   * (design D6) — the replacement affordance for the withdrawn CompositeRef
   * palette entry. Absent `isReferenceableDeclaration(declaration)`, the row
   * action is disabled rather than failing on click. */
  onInsertRef?: (declarationId: string) => void;
}) {
  const [newId, setNewId] = useState('');
  const declarations = definition.declarations ?? [];
  const capabilities = (catalog?.skills ?? [])
    .filter((skill) => skill.enabled && skill.capability)
    .map((skill) => skill.capability!);
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
          // Blankness and uniqueness are BOTH the model's call
          // (`addDeclaration` throws for either) and are surfaced as toasts,
          // exactly like the reference guard on delete. The panel pre-judges
          // nothing — one owner per rule.
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
              class="declarations-panel__insert-ref"
              data-testid="declaration-insert-ref"
              data-declaration-id={declaration.id}
              disabled={!isReferenceableDeclaration(declaration)}
              onClick={() => onInsertRef?.(declaration.id)}
            >
              Insert into graph
            </button>
            <button
              type="button"
              class="declarations-panel__delete"
              data-testid="declaration-delete"
              data-declaration-id={declaration.id}
              disabled={declaration.provenance === 'built-in'}
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
          selectedIssueDeclarationId={selectedIssueDeclarationId ?? null}
          selectedBodyStageId={selectedBodyStageId ?? null}
          selectedBodyStageSeverity={selectedBodyStageSeverity ?? null}
          selectedBodyConnectionIssue={selectedBodyConnectionIssue ?? null}
          focusedField={focusedField ?? null}
          catalog={catalog}
          capabilities={capabilities}
          onRename={(nextId) => onRename(selected.id, nextId)}
          onPatch={(patch) => onPatch(selected.id, patch)}
          onAddBodyStage={() => onAddBodyStage(selected.id)}
          onRemoveBodyStage={(stageId) => onRemoveBodyStage(selected.id, stageId)}
          onPatchBodyStage={(stageId, patch) => onPatchBodyStage(selected.id, stageId, patch)}
          onPatchBodyExecution={(stageId, patch) =>
            onPatchBodyExecution(selected.id, stageId, patch)
          }
          onAddBodyConnection={(from, to) => onAddBodyConnection(selected.id, from, to)}
          onRemoveBodyConnection={(connectionId) =>
            onRemoveBodyConnection(selected.id, connectionId)
          }
        />
      )}
    </aside>
  );
}

/**
 * One editable comma-separated name list (outcomes). Exported for the
 * extraction review dialog (`V2ExtractReviewPanel`), which reuses the exact
 * row UX — one implementation of "how an author edits a contract list".
 * `inputRef`, when given, aliases the text input so a host page can focus it
 * (the sink offer's locate action focuses the definition outcomes field).
 */
export function NameListField({
  label,
  testId,
  value,
  onCommit,
  focused = false,
  inputRef,
}: {
  label: string;
  testId: string;
  value: readonly string[];
  onCommit: (next: string[]) => void;
  focused?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const authoritative = value.join(',');
  const [draft, setDraft] = useState(authoritative);
  return (
    <label class={`declaration-editor__field${focused ? ' declaration-editor__field--focused' : ''}`}>
      <span>{label}</span>
      <input
        ref={inputRef}
        type="text"
        data-testid={testId}
        value={draft}
        onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
        // Commit on blur, like the Gate/Choice outcomes editor: a raw draft
        // survives intermediate keystrokes (typing "a," must not drop the
        // trailing separator) and only the canonical parse reaches the model.
        // An unchanged canonical value commits NOTHING: the commit path's
        // bookkeeping (a draft-change that wipes the validation result) must
        // not fire for a blur that changed no contract value (review m2).
        onBlur={() => {
          const next = Array.from(
            new Set(
              draft
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            )
          );
          setDraft(next.join(','));
          if (next.join(',') !== authoritative) onCommit(next);
        }}
      />
    </label>
  );
}

/**
 * Editable `name: type` port rows with add/remove/rename, used for both the
 * declared inputs and the declared artifacts (identical shape on the wire).
 * Exported for the extraction review dialog (`V2ExtractReviewPanel`), which
 * reuses the exact row UX.
 */
export function PortListEditor({
  label,
  testIdPrefix,
  ports,
  onCommit,
  focused = false,
}: {
  label: string;
  testIdPrefix: string;
  ports: readonly { name: string; type: string }[];
  onCommit: (next: { name: string; type: string }[]) => void;
  focused?: boolean;
}) {
  return (
    <div class={`declaration-editor__field${focused ? ' declaration-editor__field--focused' : ''}`} data-testid={`${testIdPrefix}-list`}>
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
 * Editable stable id for one body stage. Commit-on-blur, and the authoritative
 * value is restored if the model rejects the rename (blank, duplicate) — the
 * same contract `V2NodePanel`'s root id editor follows.
 */
function BodyStageIdField({
  stageId,
  onCommit,
}: {
  stageId: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(stageId);
  useEffect(() => {
    setDraft(stageId);
  }, [stageId]);
  return (
    <input
      type="text"
      class="declaration-editor__body-stage-id"
      data-testid="declaration-body-stage-id"
      data-stage-id={stageId}
      value={draft}
      onInput={(event) => setDraft((event.target as HTMLInputElement).value)}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== stageId) onCommit(next);
        // A rejected rename leaves the prop unchanged; restore it rather than
        // leaving the input showing an id the definition does not have.
        setDraft(stageId);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * Body connection authoring: pick a source and a target body stage, add the
 * edge, or remove an existing one.
 *
 * This deliberately does NOT pre-filter the target list to "stages that would
 * not create a cycle". Legality is the model's judgement — `addBodyConnection`
 * refuses unknown stages, duplicate edges and cycles, and the page surfaces
 * that refusal. A select box that quietly hid illegal targets would be a
 * second implementation of the cycle rule, and the one the user could not see.
 */
function BodyConnections({
  stageIds,
  connections,
  selectedIssue,
  onAdd,
  onRemove,
}: {
  stageIds: readonly string[];
  connections: readonly {
    id: string;
    from: { node: string; port: string };
    to: { node: string; port: string };
  }[];
  selectedIssue: SelectedBodyConnectionIssue | null;
  onAdd: (from: string, to: string) => void;
  onRemove: (connectionId: string) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const options = ['', ...stageIds];

  return (
    <div class="declaration-editor__connections" data-testid="declaration-connections">
      <span>Body connections ({connections.length})</span>
      <ul class="declaration-editor__connection-list">
        {connections.map((connection) => {
          const issue =
            selectedIssue?.id === connection.id ? selectedIssue : null;
          const endpointIssue = (endpoint: 'from' | 'to') =>
            issue?.field === endpoint || issue?.field?.startsWith(`${endpoint}/`)
              ? issue.severity
              : undefined;
          return (
            <li
              key={connection.id}
              class={`declaration-editor__connection-row${
                issue
                  ? ` declaration-editor__connection-row--issue-${issue.severity}`
                  : ''
              }`}
              data-testid="declaration-body-connection"
              data-connection-id={connection.id}
              data-from={connection.from.node}
              data-to={connection.to.node}
              data-focused-field={issue?.field ?? undefined}
              data-issue={issue?.severity}
            >
              <span class="declaration-editor__connection-label">
                <span
                  data-testid="declaration-body-connection-endpoint"
                  data-endpoint="from"
                  data-focused-field={
                    endpointIssue('from') ? issue?.field ?? undefined : undefined
                  }
                  data-issue={endpointIssue('from')}
                >
                  {connection.from.node}:{connection.from.port}
                </span>
                {' → '}
                <span
                  data-testid="declaration-body-connection-endpoint"
                  data-endpoint="to"
                  data-focused-field={
                    endpointIssue('to') ? issue?.field ?? undefined : undefined
                  }
                  data-issue={endpointIssue('to')}
                >
                  {connection.to.node}:{connection.to.port}
                </span>
              </span>
              <button
                type="button"
                data-testid="declaration-body-connection-remove"
                data-connection-id={connection.id}
                onClick={() => onRemove(connection.id)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <div class="declaration-editor__connection-add">
        <select
          data-testid="declaration-connection-from"
          value={from}
          onChange={(event) => setFrom((event.target as HTMLSelectElement).value)}
        >
          {options.map((id) => (
            <option key={`from-${id}`} value={id}>
              {id || 'from…'}
            </option>
          ))}
        </select>
        <select
          data-testid="declaration-connection-to"
          value={to}
          onChange={(event) => setTo((event.target as HTMLSelectElement).value)}
        >
          {options.map((id) => (
            <option key={`to-${id}`} value={id}>
              {id || 'to…'}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="declaration-connection-add"
          // Only "both endpoints chosen" is a UI concern — you cannot submit a
          // form with empty selects. Everything about whether the EDGE is legal
          // belongs to the model.
          disabled={from === '' || to === ''}
          onClick={() => onAdd(from, to)}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

/**
 * The declaration editor sub-panel: contract fields (inputs, artifacts,
 * outcomes) plus the body graph navigator and its constrained palette.
 */
function DeclarationEditor({
  declaration,
  selectedIssueDeclarationId,
  selectedBodyStageId,
  selectedBodyStageSeverity,
  selectedBodyConnectionIssue,
  focusedField,
  catalog,
  capabilities,
  onRename,
  onPatch,
  onAddBodyStage,
  onRemoveBodyStage,
  onPatchBodyStage,
  onPatchBodyExecution,
  onAddBodyConnection,
  onRemoveBodyConnection,
}: {
  declaration: WireCompositeDeclaration;
  selectedIssueDeclarationId: string | null;
  selectedBodyStageId: string | null;
  selectedBodyStageSeverity: 'error' | 'warning' | null;
  selectedBodyConnectionIssue: SelectedBodyConnectionIssue | null;
  focusedField: string | null;
  catalog: PipelineCatalogResponse | null;
  capabilities: readonly Readonly<{ id: string; version: string }>[];
  onRename: (nextId: string) => void;
  onPatch: (
    patch: Partial<{
      inputs: WireDefinitionPort[];
      artifacts: WireDefinitionArtifact[];
      outcomes: string[];
    }>
  ) => void;
  onAddBodyStage: () => void;
  onRemoveBodyStage: (stageId: string) => void;
  onPatchBodyStage: (
    stageId: string,
    patch: Partial<{
      id: string;
      capability: { id: string; version: string };
      reviewCyclePhase?: WireReviewCyclePhase;
      goalCyclePhase?: WireGoalCyclePhase;
    }>
  ) => void;
  onPatchBodyExecution: (stageId: string, patch: AtomicStageExecutionPatch) => void;
  onAddBodyConnection: (from: string, to: string) => void;
  onRemoveBodyConnection: (connectionId: string) => void;
}) {
  const inputs = declaration.inputs ?? [];
  const artifacts = declaration.artifacts ?? [];
  const outcomes = declaration.outcomes ?? [];
  const bodyNodes = (declaration.graph?.nodes ?? []).filter(
    (node): node is WireAtomicStageNode => node.kind === 'AtomicStage'
  );
  const bodyConnections = (declaration.graph?.connections ?? []) as ReadonlyArray<{
    id: string;
    from: { node: string; port: string };
    to: { node: string; port: string };
  }>;
  const [idDraft, setIdDraft] = useState(declaration.id);
  const ownsSelectedIssue = selectedIssueDeclarationId === declaration.id;
  const ownedFocusedField = ownsSelectedIssue ? focusedField : null;
  const ownedSelectedBodyStageId = ownsSelectedIssue
    ? selectedBodyStageId
    : null;
  const ownedSelectedBodyConnectionIssue =
    ownsSelectedIssue &&
    selectedBodyConnectionIssue?.declarationId === declaration.id
      ? selectedBodyConnectionIssue
      : null;

  return (
    <div
      class="declaration-editor"
      data-testid="declaration-editor"
      data-declaration-id={declaration.id}
      data-focused-field={ownedFocusedField ?? ''}
    >
      <h4 class="declaration-editor__title">{declaration.id}</h4>
      <label class={`declaration-editor__field${ownedFocusedField === 'id' ? ' declaration-editor__field--focused' : ''}`}>
        <span>Stable declaration id</span>
        <input
          data-testid="declaration-id"
          value={idDraft}
          disabled={declaration.provenance === 'built-in'}
          onInput={(event) => setIdDraft((event.target as HTMLInputElement).value)}
          onBlur={() => {
            const next = idDraft.trim();
            if (next && next !== declaration.id) onRename(next);
            setIdDraft(declaration.id);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
          }}
        />
      </label>

      <PortListEditor
        label="Inputs"
        testIdPrefix="declaration-input"
        ports={inputs}
        onCommit={(next) => onPatch({ inputs: next as WireDefinitionPort[] })}
        focused={ownedFocusedField === 'inputs' || ownedFocusedField?.startsWith('inputs/')}
      />
      <PortListEditor
        label="Artifacts"
        testIdPrefix="declaration-artifact"
        ports={artifacts}
        onCommit={(next) => onPatch({ artifacts: next as WireDefinitionArtifact[] })}
        focused={ownedFocusedField === 'artifacts' || ownedFocusedField?.startsWith('artifacts/')}
      />
      <NameListField
        label="Outcomes"
        testId="declaration-outcomes"
        value={outcomes}
        onCommit={(next) => onPatch({ outcomes: next })}
        focused={ownedFocusedField === 'outcomes' || ownedFocusedField?.startsWith('outcomes/')}
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
              data-focused-field={ownedSelectedBodyStageId === node.id ? ownedFocusedField ?? '' : ''}
            >
              {/* The spec's "edit" verb. Committed on blur like every other id
                  editor in this canvas, so an intermediate keystroke never
                  reaches the model; a rename rewrites incident connections
                  inside `updateBodyStage`, not here. */}
              <BodyStageIdField
                stageId={node.id}
                onCommit={(next) => onPatchBodyStage(node.id, { id: next })}
              />
              <span class="declaration-editor__body-stage-kind">{node.kind}</span>
              <V2ExecutionEditor
                node={node}
                catalog={catalog}
                fieldIssues={
                  ownedSelectedBodyStageId === node.id && ownedFocusedField
                    ? { [ownedFocusedField]: selectedBodyStageSeverity ?? 'error' }
                    : {}
                }
                testIdPrefix="declaration-body-execution"
                capabilityTestId="declaration-body-stage-capability"
                showPhases
                onCapabilityPatch={(capability) =>
                  onPatchBodyStage(node.id, { capability })
                }
                onExecutionPatch={(patch) => onPatchBodyExecution(node.id, patch)}
                onPhasePatch={(patch) => onPatchBodyStage(node.id, patch)}
              />
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

        {/* Body connections — the half of "Canvas edits composite body stages"
            that had no affordance: "connects it to an existing body stage" and
            "draws a connection ... cycle rejected". Without this a
            Canvas-authored multi-stage body is disconnected stages, which the
            reconciler admits in PARALLEL — a different pipeline than authored. */}
        <BodyConnections
          stageIds={bodyNodes.map((node) => node.id)}
          connections={bodyConnections}
          selectedIssue={ownedSelectedBodyConnectionIssue}
          onAdd={onAddBodyConnection}
          onRemove={onRemoveBodyConnection}
        />
        <div class="declaration-editor__body-palette" data-testid="declaration-body-palette">
          {V2_BODY_PALETTE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              data-testid={`v2-body-palette-add-${kind}`}
              // Same rule as the root palette's AtomicStage entry: a body stage
              // must bind an exact capability revision, so without one the
              // action is unavailable rather than failing on click.
              disabled={capabilities.length === 0}
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
