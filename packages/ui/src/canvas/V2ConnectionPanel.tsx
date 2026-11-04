import { useEffect, useState } from 'preact/hooks';
import type { WireDefinitionConnection } from '../api/types.js';

/**
 * Properties panel for a selected v2 connection. Reuses the `.stage-panel`
 * class (design D5) so it inherits the same constrained, independently
 * scrolling treatment as the node and stage panels. Renders and decides
 * nothing beyond its own local input draft state — `spliceConditionOntoConnection`
 * in `draft.ts` owns every refusal rule; a refusal surfaces through the
 * caller's toast, not here.
 */
export function V2ConnectionPanel({
  connection,
  onSpliceCondition,
  onClose,
}: {
  connection: WireDefinitionConnection;
  onSpliceCondition: (connectionId: string, expression: string) => void;
  onClose: () => void;
}) {
  const [expressionDraft, setExpressionDraft] = useState('');
  useEffect(() => {
    setExpressionDraft('');
  }, [connection.id]);

  return (
    <aside
      class="stage-panel v2-connection-panel"
      data-testid="v2-connection-panel"
      data-connection={connection.id}
    >
      <div class="stage-panel__header">
        <h3 class="stage-panel__title">Connection</h3>
        <button
          type="button"
          class="stage-panel__close"
          aria-label="Close connection properties"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <p class="stage-panel__muted" data-testid="v2-connection-panel-endpoints">
        <span data-testid="v2-connection-panel-from">{connection.from.node}</span>
        {' → '}
        <span data-testid="v2-connection-panel-to">{connection.to.node}</span>
      </p>

      <label class="stage-panel__field">
        <span>Branch condition</span>
        <input
          data-testid="v2-connection-panel-condition"
          value={expressionDraft}
          placeholder="Add a condition to split this connection into a branch"
          onInput={(event) =>
            setExpressionDraft((event.target as HTMLInputElement).value)
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              (event.currentTarget as HTMLInputElement).blur();
            }
          }}
          onBlur={() => {
            const trimmed = expressionDraft.trim();
            if (!trimmed) return;
            onSpliceCondition(connection.id, trimmed);
          }}
        />
      </label>
      <p class="stage-panel__muted">
        Splicing a condition replaces this connection with a Choice node; edit
        or remove the condition afterward from the Choice node's properties.
      </p>
    </aside>
  );
}
