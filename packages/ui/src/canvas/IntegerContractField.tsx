import { useEffect, useRef, useState } from 'preact/hooks';

export interface IntegerContractDraftError {
  raw: string;
  message: string;
}

/**
 * Raw authoring state for an integer-backed wire field.
 *
 * Invalid text deliberately lives outside the Definition wire draft: the last
 * valid number remains authoritative until the user repairs the text. The
 * caller may retain that small error state across panel remounts, but it is
 * not a second Definition model and can never be serialized.
 */
export function IntegerContractField({
  label,
  value,
  minimum,
  allowClear,
  field,
  resetKey,
  testId,
  className,
  draftError,
  errorTestId = 'integer-contract-error',
  errorOwner,
  onDraftError,
  onValue,
}: {
  label: string;
  value: number | undefined;
  minimum: 0 | 1;
  allowClear: boolean;
  field: string;
  resetKey: string;
  testId: string;
  className: string;
  draftError?: IntegerContractDraftError;
  errorTestId?: string;
  errorOwner?: string;
  onDraftError: (
    field: string,
    error: IntegerContractDraftError | null
  ) => void;
  onValue: (value: number | null) => void;
}) {
  const [raw, setRaw] = useState(
    draftError?.raw ?? (value === undefined ? '' : String(value))
  );
  const [error, setError] = useState<string | null>(
    draftError?.message ?? null
  );
  const previousAuthority = useRef({ resetKey, value });
  const onDraftErrorRef = useRef(onDraftError);
  onDraftErrorRef.current = onDraftError;

  useEffect(() => {
    const previous = previousAuthority.current;
    previousAuthority.current = { resetKey, value };
    if (previous.resetKey === resetKey && previous.value === value) return;
    setRaw(value === undefined ? '' : String(value));
    setError(null);
    onDraftErrorRef.current(field, null);
  }, [field, resetKey, value]);

  const errorId = `integer-contract-${testId}-${field.replace(/[^a-zA-Z0-9_-]/g, '-')}-error`;
  const minimumDescription = minimum === 0 ? 'a non-negative integer' : 'a positive integer';

  return (
    <label
      class={`${className}${
        error ? ' definition-contract__field--invalid' : ''
      }`}
    >
      <span>{label}</span>
      <input
        type="number"
        min={minimum}
        step={1}
        data-testid={testId}
        value={raw}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onInput={(event) => {
          const nextRaw = (event.target as HTMLInputElement).value;
          setRaw(nextRaw);
          if (!nextRaw.trim()) {
            if (allowClear) {
              setError(null);
              onDraftError(field, null);
              onValue(null);
              return;
            }
            const message = `${label} is required.`;
            setError(message);
            onDraftError(field, { raw: nextRaw, message });
            return;
          }
          const parsed = Number(nextRaw);
          if (!Number.isSafeInteger(parsed) || parsed < minimum) {
            const message = `${label} must be ${minimumDescription}.`;
            setError(message);
            onDraftError(field, { raw: nextRaw, message });
            return;
          }
          setError(null);
          onDraftError(field, null);
          onValue(parsed);
        }}
      />
      {error && (
        <span
          id={errorId}
          class="definition-contract__error"
          data-testid={errorTestId}
          data-limit={errorOwner}
          data-field={field}
          role="alert"
        >
          {error}
        </span>
      )}
    </label>
  );
}
