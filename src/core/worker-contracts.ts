/**
 * Runtime-neutral structured worker return contracts.
 *
 * Both the Codex exec bridge and the Claude print bridge pass these exact JSON
 * Schema objects to their CLIs and validate the returned value with the same
 * Zod parsers. Keeping the contracts outside either runtime prevents route-
 * specific drift.
 */
import { z } from 'zod';

/** JSON Schema for a leaf-worker DONE/HANDOFF return. */
export const LEAF_RETURN_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'HANDOFF'] },
    summary: { type: ['string', 'null'] },
    handoffReason: { type: ['string', 'null'] },
  },
  // Codex structured output requires every declared object property to be
  // listed in `required`. Nullable values retain the runtime-neutral
  // contract's optional-field semantics at the provider boundary.
  required: ['status', 'summary', 'handoffReason'],
  additionalProperties: false,
} as const;

/** JSON Schema for an evaluate-gate return. */
export const EVALUATE_GATE_SCHEMA = {
  type: 'object',
  properties: {
    satisfied: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: ['string', 'null'] },
  },
  required: ['satisfied', 'gaps', 'summary'],
  additionalProperties: false,
} as const;

export const LeafReturnZodSchema = z
  .object({
    status: z.enum(['DONE', 'HANDOFF']),
    summary: z.string().optional(),
    handoffReason: z.string().optional(),
  })
  .strict();
export type LeafReturn = z.infer<typeof LeafReturnZodSchema>;

export const EvaluateGateZodSchema = z
  .object({
    satisfied: z.boolean(),
    gaps: z.array(z.string()),
    summary: z.string().optional(),
  })
  .strict();
export type EvaluateGateResult = z.infer<typeof EvaluateGateZodSchema>;

export type WorkerContract = 'leaf' | 'evaluate';
export type WorkerContractResult = LeafReturn | EvaluateGateResult;

export function workerContractJsonSchema(
  contract: WorkerContract
): typeof LEAF_RETURN_SCHEMA | typeof EVALUATE_GATE_SCHEMA {
  return contract === 'leaf' ? LEAF_RETURN_SCHEMA : EVALUATE_GATE_SCHEMA;
}

function parseJson(text: string, contractName: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`Cannot parse ${contractName}: input is empty.`);
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Cannot parse ${contractName}: input is not valid JSON. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

export function parseLeafReturnValue(value: unknown): LeafReturn {
  const result = LeafReturnZodSchema.safeParse(
    normalizeNullableOptionalFields(value, ['summary', 'handoffReason'])
  );
  if (!result.success) {
    throw new Error(
      `Leaf return does not conform to the DONE/HANDOFF contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

export function parseEvaluateGateValue(value: unknown): EvaluateGateResult {
  const result = EvaluateGateZodSchema.safeParse(
    normalizeNullableOptionalFields(value, ['summary'])
  );
  if (!result.success) {
    throw new Error(
      `Evaluate-gate result does not conform to the {satisfied, gaps} contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

/**
 * Provider schemas encode optional values as required-but-nullable. Remove
 * only those known null sentinels before applying the existing strict Zod
 * contracts so callers continue to receive omitted optional properties.
 * Unknown keys and non-null invalid values remain visible to strict parsing.
 */
function normalizeNullableOptionalFields(
  value: unknown,
  optionalFields: readonly string[]
): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const normalized = { ...(value as Record<string, unknown>) };
  for (const field of optionalFields) {
    if (normalized[field] === null) delete normalized[field];
  }
  return normalized;
}

/** Parse JSON text as a leaf DONE/HANDOFF return. */
export function parseLeafReturn(text: string): LeafReturn {
  return parseLeafReturnValue(parseJson(text, 'leaf return'));
}

/** Parse JSON text as an evaluate-gate return. */
export function parseEvaluateGate(text: string): EvaluateGateResult {
  return parseEvaluateGateValue(parseJson(text, 'evaluate-gate result'));
}

export function parseWorkerContractValue(
  contract: WorkerContract,
  value: unknown
): WorkerContractResult {
  return contract === 'leaf'
    ? parseLeafReturnValue(value)
    : parseEvaluateGateValue(value);
}
