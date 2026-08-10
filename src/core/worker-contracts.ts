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
    summary: { type: 'string' },
    handoffReason: { type: 'string' },
  },
  required: ['status'],
  additionalProperties: false,
} as const;

/** JSON Schema for an evaluate-gate return. */
export const EVALUATE_GATE_SCHEMA = {
  type: 'object',
  properties: {
    satisfied: { type: 'boolean' },
    gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['satisfied', 'gaps'],
  additionalProperties: false,
} as const;

/** JSON Schema for a consultable leaf DONE/HANDOFF/CONSULT return. */
export const CONSULTABLE_LEAF_RETURN_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['DONE', 'HANDOFF', 'CONSULT'] },
    summary: { type: 'string' },
    handoffReason: { type: 'string' },
    problemSummary: { type: 'string', minLength: 1, maxLength: 65536 },
    question: { type: 'string', minLength: 1, maxLength: 65536 },
    attemptedApproaches: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
    constraints: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', minLength: 1, maxLength: 16384 },
    },
    evidencePointers: {
      type: 'array',
      maxItems: 64,
      items: { type: 'string', minLength: 1, maxLength: 4096 },
    },
  },
  required: ['status'],
  allOf: [
    {
      if: { properties: { status: { const: 'CONSULT' } } },
      then: {
        required: [
          'status',
          'problemSummary',
          'question',
          'attemptedApproaches',
          'constraints',
          'evidencePointers',
        ],
      },
    },
  ],
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

const ConsultReturnZodSchema = z
  .object({
    status: z.literal('CONSULT'),
    problemSummary: z.string().min(1).max(64 * 1024),
    question: z.string().min(1).max(64 * 1024),
    attemptedApproaches: z.array(z.string().min(1).max(16 * 1024)).max(32),
    constraints: z.array(z.string().min(1).max(16 * 1024)).max(32),
    evidencePointers: z.array(z.string().min(1).max(4096)).max(64),
  })
  .strict();

export const ConsultableLeafReturnZodSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('DONE'),
      summary: z.string().optional(),
      handoffReason: z.string().optional(),
    })
    .strict(),
  z
    .object({
      status: z.literal('HANDOFF'),
      summary: z.string().optional(),
      handoffReason: z.string().optional(),
    })
    .strict(),
  ConsultReturnZodSchema,
]);
export type ConsultableLeafReturn = z.infer<
  typeof ConsultableLeafReturnZodSchema
>;

export const EvaluateGateZodSchema = z
  .object({
    satisfied: z.boolean(),
    gaps: z.array(z.string()),
    summary: z.string().optional(),
  })
  .strict();
export type EvaluateGateResult = z.infer<typeof EvaluateGateZodSchema>;

export type WorkerContract = 'leaf' | 'consultable-leaf' | 'evaluate';
export type WorkerContractResult =
  | LeafReturn
  | ConsultableLeafReturn
  | EvaluateGateResult;

export function workerContractJsonSchema(
  contract: WorkerContract
):
  | typeof LEAF_RETURN_SCHEMA
  | typeof CONSULTABLE_LEAF_RETURN_SCHEMA
  | typeof EVALUATE_GATE_SCHEMA {
  if (contract === 'leaf') return LEAF_RETURN_SCHEMA;
  if (contract === 'consultable-leaf') return CONSULTABLE_LEAF_RETURN_SCHEMA;
  return EVALUATE_GATE_SCHEMA;
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
  const result = LeafReturnZodSchema.safeParse(value);
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
  const result = EvaluateGateZodSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Evaluate-gate result does not conform to the {satisfied, gaps} contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

export function parseConsultableLeafReturnValue(
  value: unknown
): ConsultableLeafReturn {
  const result = ConsultableLeafReturnZodSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Consultable leaf return does not conform to the DONE/HANDOFF/CONSULT contract: ${result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`
    );
  }
  if (
    result.data.status === 'CONSULT' &&
    Buffer.byteLength(JSON.stringify(result.data), 'utf8') > 64 * 1024
  ) {
    throw new Error('Consultable leaf CONSULT return exceeds the UTF-8 byte bound.');
  }
  return result.data;
}

/** Parse JSON text as a leaf DONE/HANDOFF return. */
export function parseLeafReturn(text: string): LeafReturn {
  return parseLeafReturnValue(parseJson(text, 'leaf return'));
}

/** Parse JSON text as an evaluate-gate return. */
export function parseEvaluateGate(text: string): EvaluateGateResult {
  return parseEvaluateGateValue(parseJson(text, 'evaluate-gate result'));
}

/** Parse JSON text as a consultable leaf DONE/HANDOFF/CONSULT return. */
export function parseConsultableLeafReturn(
  text: string
): ConsultableLeafReturn {
  return parseConsultableLeafReturnValue(
    parseJson(text, 'consultable leaf return')
  );
}

export function parseWorkerContractValue(
  contract: WorkerContract,
  value: unknown
): WorkerContractResult {
  if (contract === 'leaf') return parseLeafReturnValue(value);
  if (contract === 'consultable-leaf') {
    return parseConsultableLeafReturnValue(value);
  }
  return parseEvaluateGateValue(value);
}
