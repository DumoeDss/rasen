import { useEffect, useState } from 'preact/hooks';
import type {
  PipelineCatalogResponse,
  WireBoundedLoopNode,
  WireCompositeDeclaration,
  WireCompositeRefNode,
  WireDefinitionNode,
  WirePipelineDefinitionV2,
} from '../api/types.js';
import { isV2EditableNodeKind } from './draft.js';

/** The canonical 4-phase ReviewCycle body this Canvas slice supports. */
const REVIEW_CYCLE_PHASES = ['review', 'triage', 'fix', 're-review'] as const;

function listValue(values: readonly string[]): string {
  return values.join(',');
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function V2NodePanel({
  node,
  catalog,
  definition,
  fieldIssues,
  onRename,
  onPatch,
  onClose,
}: {
  node: WireDefinitionNode;
  catalog: PipelineCatalogResponse | null;
  definition?: WirePipelineDefinitionV2 | null;
  fieldIssues: Record<string, 'error' | 'warning'>;
  onRename: (id: string) => void;
  onPatch: (patch: Partial<WireDefinitionNode>) => boolean | void;
  onClose: () => void;
}) {
  const supported = isV2EditableNodeKind(node.kind);
  const [idDraft, setIdDraft] = useState(node.id);
  const authoritativeOutcomes =
    node.kind === 'Gate' || node.kind === 'Choice'
      ? listValue(node.outcomes)
      : '';
  const [outcomesDraft, setOutcomesDraft] = useState(authoritativeOutcomes);
  useEffect(() => {
    setIdDraft(node.id);
  }, [node.id]);
  useEffect(() => {
    setOutcomesDraft(authoritativeOutcomes);
  }, [node.id, authoritativeOutcomes]);
  const commitRename = () => {
    const next = idDraft.trim();
    if (next && next !== node.id) {
      onRename(next);
      // A rejected rename (for example, a duplicate id) leaves the node prop
      // unchanged; restore its authoritative value just like the prior
      // prop-controlled editor did. A successful rename remounts under its new
      // stable key and initializes from that new id.
      setIdDraft(node.id);
      return;
    }
    setIdDraft(node.id);
  };
  const commitOutcomes = () => {
    const outcomes = parseList(outcomesDraft);
    const accepted = onPatch({ outcomes });
    setOutcomesDraft(
      accepted === false ? authoritativeOutcomes : listValue(outcomes)
    );
  };
  const fieldClass = (field: string) =>
    `stage-panel__field${
      fieldIssues[field]
        ? ` stage-panel__field--issue-${fieldIssues[field]}`
        : ''
    }`;

  return (
    <aside
      class="stage-panel v2-node-panel"
      data-testid="v2-node-panel"
      data-node={node.id}
      data-kind={node.kind}
    >
      <div class="stage-panel__header">
        <h3 class="stage-panel__title">{node.kind}</h3>
        <button
          type="button"
          class="stage-panel__close"
          aria-label="Close node properties"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {!supported ? (
        <>
          <p data-testid="v2-node-panel-unsupported">
            This known Definition kind is preserved exactly and is read-only in
            this editor slice.
          </p>
          <pre class="stage-panel__json">{JSON.stringify(node, null, 2)}</pre>
        </>
      ) : (
        <>
          <label class={fieldClass('id')}>
            <span>Stable id</span>
            <input
              data-testid="v2-node-panel-id"
              value={idDraft}
              onInput={(event) =>
                setIdDraft((event.target as HTMLInputElement).value)
              }
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
          </label>

          {node.kind === 'AtomicStage' && (
            <label class={fieldClass('capability')}>
              <span>Exact capability revision</span>
              <select
                data-testid="v2-node-panel-capability"
                value={`${node.capability.id}\0${node.capability.version}`}
                onChange={(event) => {
                  const selected = (event.target as HTMLSelectElement).value;
                  const capability = (catalog?.skills ?? [])
                    .map((skill) => skill.capability)
                    .find(
                      (candidate) =>
                        candidate &&
                        `${candidate.id}\0${candidate.version}` === selected
                    );
                  if (capability) {
                    onPatch({
                      capability: {
                        id: capability.id,
                        version: capability.version,
                      },
                    });
                  }
                }}
              >
                {(catalog?.skills ?? [])
                  .filter((skill) => skill.enabled && skill.capability)
                  .map((skill) => (
                    <option
                      key={`${skill.capability!.id}\0${skill.capability!.version}`}
                      value={`${skill.capability!.id}\0${skill.capability!.version}`}
                    >
                      {skill.capability!.id} @ {skill.capability!.version}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {(node.kind === 'Gate' || node.kind === 'Choice') && (
            <label class={fieldClass('outcomes')}>
              <span>Branch outcomes</span>
              <input
                data-testid="v2-node-panel-outcomes"
                value={outcomesDraft}
                onInput={(event) =>
                  setOutcomesDraft(
                    (event.target as HTMLInputElement).value
                  )
                }
                onBlur={commitOutcomes}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>
          )}

          {node.kind === 'Finish' && (
            <label class={fieldClass('outcome')}>
              <span>Terminal outcome</span>
              <input
                data-testid="v2-node-panel-outcome"
                value={node.outcome}
                onInput={(event) =>
                  onPatch({
                    outcome: (event.target as HTMLInputElement).value,
                  })
                }
              />
            </label>
          )}

          {node.kind === 'BoundedLoop' && (
            <BoundedLoopDetails
              node={node as WireBoundedLoopNode}
              definition={definition}
              onPatch={onPatch}
            />
          )}

          {node.kind === 'CompositeRef' && (
            <CompositeRefDetails
              node={node as WireCompositeRefNode}
              definition={definition}
              onPatch={onPatch}
            />
          )}
        </>
      )}
    </aside>
  );
}

/**
 * BoundedLoop detail renderer (task 9.1/9.3): shows the body phases, exit
 * outcomes, and a configurable maxRounds scalar. Shape editing (add/remove/
 * reorder phases) is NOT enabled — the 4-phase ReviewCycle body is read-only.
 */
/**
 * BoundedLoop detail renderer: shows the body phases/stages, exit outcomes,
 * and a configurable maxRounds scalar. For ReviewCycle bodies the 4 phases
 * are listed read-only. For non-ReviewCycle (composite) bodies, the body
 * declaration's stages are listed read-only.
 */
function BoundedLoopDetails({
  node,
  definition,
  onPatch,
}: {
  node: WireBoundedLoopNode;
  definition?: WirePipelineDefinitionV2 | null;
  onPatch: (patch: Partial<WireDefinitionNode>) => boolean | void;
}) {
  const currentMaxRounds = node.limits.maxIterations;
  const [roundsDraft, setRoundsDraft] = useState(String(currentMaxRounds));

  const exitEntries = Object.entries(node.exits);
  const cleanExit = exitEntries.find(([, v]) => v.action === 'continue');
  const exhaustedExit = exitEntries.find(([, v]) => v.action === 'exit');

  const commitRounds = () => {
    const parsed = parseInt(roundsDraft, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
      onPatch({
        limits: { ...node.limits, maxIterations: parsed },
      });
    } else {
      setRoundsDraft(String(currentMaxRounds));
    }
  };

  // Look up the declaration to determine body kind.
  const declaration = (definition?.declarations ?? []).find(
    (d) => d.id === node.body
  );
  const bodyNodes = (declaration?.graph?.nodes ?? []) as Array<{
    id: string;
    kind: string;
    reviewCyclePhase?: string;
    capability?: { id: string };
  }>;
  const isReviewCycle = bodyNodes.some(
    (n) => typeof n.reviewCyclePhase === 'string'
  );

  return (
    <div
      class="stage-panel__bounded-loop"
      data-testid="v2-node-panel-bounded-loop"
    >
      <div class="stage-panel__field">
        <span>Body kind</span>
        <strong>{isReviewCycle ? 'Review Cycle (4 phases)' : 'Composite'}</strong>
      </div>
      <div
        class="stage-panel__bounded-loop-phases"
        data-testid="v2-node-panel-phases"
      >
        {isReviewCycle ? (
          <>
            <span>Phases (read-only):</span>
            <ol>
              {REVIEW_CYCLE_PHASES.map((phase) => (
                <li key={phase}>{phase}</li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <span>Body stages (read-only):</span>
            <ol>
              {bodyNodes.map((n) => (
                <li key={n.id}>
                  {n.id}
                  {n.capability ? ` (${n.capability.id})` : ''}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
      <label class="stage-panel__field">
        <span>Max rounds</span>
        <input
          type="number"
          min={1}
          max={100}
          data-testid="v2-node-panel-max-rounds"
          value={roundsDraft}
          onInput={(event) =>
            setRoundsDraft((event.target as HTMLInputElement).value)
          }
          onBlur={commitRounds}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
      </label>
      <div class="stage-panel__field">
        <span>Exits</span>
        <div class="stage-panel__exits">
          {cleanExit && (
            <span class="stage-panel__exit stage-panel__exit--clean">
              {cleanExit[0]}: continue
            </span>
          )}
          {exhaustedExit && (
            <span class="stage-panel__exit stage-panel__exit--exhausted">
              {exhaustedExit[0]}: {(exhaustedExit[1] as { outcome: string }).outcome}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * CompositeRef detail renderer (design D5): shows the referenced declaration
 * (editable via dropdown), the declaration's contract (inputs/artifacts/
 * outcomes read-only summary), the body stages list, and the port mapping
 * between root-level connections and the declaration's declared ports.
 */
function CompositeRefDetails({
  node,
  definition,
  onPatch,
}: {
  node: WireCompositeRefNode;
  definition?: WirePipelineDefinitionV2 | null;
  onPatch: (patch: Partial<WireDefinitionNode>) => boolean | void;
}) {
  const declarations = definition?.declarations ?? [];
  const selectedDeclaration = declarations.find(
    (d) => d.id === node.declarationId
  );

  return (
    <div
      class="stage-panel__composite-ref"
      data-testid="v2-node-panel-composite-ref"
    >
      <label class="stage-panel__field">
        <span>Declaration</span>
        <select
          data-testid="v2-node-panel-declaration"
          value={node.declarationId}
          onChange={(event) => {
            const value = (event.target as HTMLSelectElement).value;
            onPatch({ declarationId: value });
          }}
        >
          {declarations.length === 0 && (
            <option value="">(no declarations)</option>
          )}
          {declarations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id}
              {d.provenance === 'built-in' ? ' (built-in)' : ''}
            </option>
          ))}
        </select>
      </label>

      {selectedDeclaration && (
        <DeclarationSummary declaration={selectedDeclaration} />
      )}
    </div>
  );
}

/**
 * Read-only declaration contract summary: inputs, artifacts, outcomes, and
 * body stage list. Also shows the port mapping surface.
 */
function DeclarationSummary({
  declaration,
}: {
  declaration: WireCompositeDeclaration;
}) {
  const inputs = declaration.inputs ?? [];
  const artifacts = declaration.artifacts ?? [];
  const outcomes = declaration.outcomes ?? [];
  const bodyNodes = (declaration.graph?.nodes ?? []) as Array<{
    id: string;
    kind: string;
    capability?: { id: string };
  }>;
  const bodyConnections = declaration.graph?.connections ?? [];

  return (
    <div
      class="stage-panel__declaration-summary"
      data-testid="v2-node-panel-declaration-summary"
    >
      {inputs.length > 0 && (
        <div class="stage-panel__field">
          <span>Inputs</span>
          <ul class="stage-panel__port-list">
            {inputs.map((port) => (
              <li key={port.name}>
                {port.name}: {port.type}
              </li>
            ))}
          </ul>
        </div>
      )}
      {artifacts.length > 0 && (
        <div class="stage-panel__field">
          <span>Artifacts</span>
          <ul class="stage-panel__port-list">
            {artifacts.map((art) => (
              <li key={art.name}>
                {art.name}: {art.type}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="stage-panel__field">
        <span>Outcomes</span>
        <div class="stage-panel__outcomes-list">
          {outcomes.join(', ') || '(none)'}
        </div>
      </div>
      <div class="stage-panel__field">
        <span>Body stages ({bodyNodes.length})</span>
        <ol class="stage-panel__body-stages">
          {bodyNodes.map((n) => (
            <li key={n.id} data-testid="v2-node-panel-body-stage">
              {n.id} ({n.kind})
              {n.capability ? ` → ${n.capability.id}` : ''}
            </li>
          ))}
        </ol>
      </div>
      {bodyConnections.length > 0 && (
        <div class="stage-panel__field">
          <span>Body connections ({bodyConnections.length})</span>
          <ul class="stage-panel__port-list">
            {bodyConnections.map((c, i) => (
              <li key={i}>
                {c.from.node}:{c.from.port} → {c.to.node}:{c.to.port}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div class="stage-panel__field stage-panel__port-mapping">
        <span>Port mapping</span>
        <div class="stage-panel__port-mapping-grid" data-testid="v2-node-panel-port-mapping">
          {inputs.map((port) => (
            <div key={`in:${port.name}`} class="stage-panel__port-mapping-row">
              <span class="stage-panel__port-mapping-root">root:{port.name}</span>
              <span class="stage-panel__port-mapping-arrow">→</span>
              <span class="stage-panel__port-mapping-decl">{port.name}</span>
            </div>
          ))}
          {outcomes.map((outcome) => (
            <div key={`out:${outcome}`} class="stage-panel__port-mapping-row">
              <span class="stage-panel__port-mapping-decl">{outcome}</span>
              <span class="stage-panel__port-mapping-arrow">→</span>
              <span class="stage-panel__port-mapping-root">root:{outcome}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
