import { useEffect, useState } from 'preact/hooks';
import type {
  PipelineCatalogResponse,
  WireDefinitionNode,
} from '../api/types.js';
import { isV2EditableNodeKind } from './draft.js';

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
  fieldIssues,
  onRename,
  onPatch,
  onClose,
}: {
  node: WireDefinitionNode;
  catalog: PipelineCatalogResponse | null;
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
        </>
      )}
    </aside>
  );
}
