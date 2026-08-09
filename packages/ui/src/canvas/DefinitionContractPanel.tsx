import type {
  WireDefinitionArtifact,
  WireDefinitionPort,
  WirePipelineDefinitionV2,
} from '../api/types.js';
import type { DefinitionContractPatch } from './draft.js';
import {
  IntegerContractField,
  type IntegerContractDraftError,
} from './IntegerContractField.js';

function fieldClass(focusedField: string | null, field: string): string {
  return `definition-contract__field${
    focusedField === field || focusedField?.startsWith(`${field}/`)
      ? ' definition-contract__field--focused'
      : ''
  }`;
}

function NamedTypeRows({
  kind,
  rows,
  focusedField,
  onChange,
}: {
  kind: 'input' | 'artifact';
  rows: readonly { name: string; type: string; required?: boolean }[];
  focusedField: string | null;
  onChange: (rows: Array<{ name: string; type: string; required?: boolean }>) => void;
}) {
  const owner = kind === 'input' ? 'inputs' : 'artifacts';
  return (
    <div class={fieldClass(focusedField, owner)} data-testid={`definition-${kind}-list`}>
      <span>{kind === 'input' ? 'Typed inputs' : 'Artifacts'}</span>
      {rows.map((row, index) => (
        <div key={`${owner}:${index}`} class="definition-contract__row">
          <input
            data-testid={`definition-${kind}-name`}
            data-row-index={index}
            aria-label={`${kind} name`}
            value={row.name}
            onInput={(event) =>
              onChange(
                rows.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? { ...candidate, name: (event.target as HTMLInputElement).value }
                    : candidate
                )
              )
            }
          />
          <input
            data-testid={`definition-${kind}-type`}
            data-row-index={index}
            aria-label={`${kind} type`}
            value={row.type}
            onInput={(event) =>
              onChange(
                rows.map((candidate, candidateIndex) =>
                  candidateIndex === index
                    ? { ...candidate, type: (event.target as HTMLInputElement).value }
                    : candidate
                )
              )
            }
          />
          {kind === 'input' && (
            <label>
              <input
                type="checkbox"
                data-testid="definition-input-required"
                data-row-index={index}
                checked={row.required ?? false}
                onChange={(event) =>
                  onChange(
                    rows.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, required: (event.target as HTMLInputElement).checked }
                        : candidate
                    )
                  )
                }
              />
              Required
            </label>
          )}
          <button
            type="button"
            data-testid={`definition-${kind}-remove`}
            data-row-index={index}
            onClick={() => onChange(rows.filter((_, candidateIndex) => candidateIndex !== index))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid={`definition-${kind}-add`}
        onClick={() =>
          onChange([
            ...rows,
            {
              name: `${kind}-${rows.length + 1}`,
              type: 'artifact/text',
              ...(kind === 'input' ? { required: false } : {}),
            },
          ])
        }
      >
        Add {kind}
      </button>
    </div>
  );
}

function PositiveLimitField({
  limit,
  label,
  value,
  focusedField,
  definitionKey,
  draftError,
  onPatch,
  onInvalidChange,
}: {
  limit: 'maxActions' | 'budget';
  label: string;
  value: number | undefined;
  focusedField: string | null;
  definitionKey: string;
  draftError?: IntegerContractDraftError;
  onPatch: (value: number | null) => void;
  onInvalidChange: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
}) {
  const field = `limits/${limit}`;
  return (
    <IntegerContractField
      label={label}
      value={value}
      minimum={1}
      allowClear
      field={field}
      resetKey={definitionKey}
      testId={`definition-limit-${
        limit === 'maxActions' ? 'max-actions' : 'budget'
      }`}
      className={fieldClass(focusedField, field)}
      draftError={draftError}
      errorTestId="definition-limit-error"
      errorOwner={limit}
      onDraftError={onInvalidChange}
      onValue={onPatch}
    />
  );
}

export function DefinitionContractPanel({
  definition,
  focusedField,
  draftErrors = {},
  onPatch,
  onInvalidChange,
}: {
  definition: WirePipelineDefinitionV2;
  focusedField: string | null;
  draftErrors?: Readonly<Record<string, IntegerContractDraftError>>;
  onPatch: (patch: DefinitionContractPatch) => void;
  onInvalidChange: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
}) {
  const limits = definition.limits ?? {};
  const definitionKey = `${definition.name}\0${definition.id}\0${definition.sourceId}`;
  return (
    <aside
      class="definition-contract"
      data-testid="definition-contract-panel"
      data-focused-field={focusedField ?? ''}
    >
      <h3>Definition contract</h3>
      <NamedTypeRows
        kind="input"
        rows={definition.inputs}
        focusedField={focusedField}
        onChange={(inputs) => onPatch({ inputs: inputs as WireDefinitionPort[] })}
      />
      <NamedTypeRows
        kind="artifact"
        rows={definition.artifacts}
        focusedField={focusedField}
        onChange={(artifacts) => onPatch({ artifacts: artifacts as WireDefinitionArtifact[] })}
      />
      <label class={fieldClass(focusedField, 'outcomes')}>
        <span>Named outcomes</span>
        <input
          data-testid="definition-outcomes"
          value={definition.outcomes.join(',')}
          onChange={(event) =>
            onPatch({
              outcomes: Array.from(
                new Set(
                  (event.target as HTMLInputElement).value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean)
                )
              ),
            })
          }
        />
      </label>
      {(['maxActions', 'budget'] as const).map((key) => (
        <PositiveLimitField
          key={key}
          limit={key}
          label={key === 'maxActions' ? 'Maximum actions' : 'Budget'}
          value={limits[key]}
          focusedField={focusedField}
          definitionKey={definitionKey}
          draftError={draftErrors[`limits/${key}`]}
          onPatch={(value) => onPatch({ limits: { [key]: value } })}
          onInvalidChange={onInvalidChange}
        />
      ))}
    </aside>
  );
}
