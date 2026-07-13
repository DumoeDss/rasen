/**
 * Structured worker return contracts.
 *
 * `codex exec --output-schema <file>` enforces strict-JSON final messages —
 * live-verified against codex-cli {@link CODEX_CLI_VERSION_PREMISE}: the
 * agent's final message IS the schema-conformant JSON, no prose wrapper or
 * markdown fence (`docs/codex-parity/experiments/E10`). This is strictly
 * better than the DONE/HANDOFF-marker-in-prose convention Claude Code workers
 * use today.
 *
 * Two contracts are needed: the leaf-worker DONE/HANDOFF return, and the
 * evaluate-gate `{satisfied, gaps}` shape. Each is hand-written twice — as a
 * JSON Schema literal (for `--output-schema`, serialized to a temp file by
 * the caller) and as a zod schema (for parsing the `-o` last-message file) —
 * kept side by side rather than generated one from the other (design D7):
 * that would add a dependency for two tiny schemas and produce a noisier
 * schema than the hand-written form Codex was actually tested against. Both
 * retain an optional free-text `summary` escape hatch so a model whose true
 * state is ambiguous has somewhere to put nuance without violating
 * `additionalProperties: false`.
 */
import { z } from 'zod';
import { CODEX_CLI_VERSION_PREMISE } from './codex-home.js';

/** JSON Schema for `codex exec --output-schema` — leaf-worker DONE/HANDOFF return. */
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

/** JSON Schema for `codex exec --output-schema` — evaluate-gate return. */
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

const LeafReturnZodSchema = z
  .object({
    status: z.enum(['DONE', 'HANDOFF']),
    summary: z.string().optional(),
    handoffReason: z.string().optional(),
  })
  .strict();
export type LeafReturn = z.infer<typeof LeafReturnZodSchema>;

const EvaluateGateZodSchema = z
  .object({
    satisfied: z.boolean(),
    gaps: z.array(z.string()),
    summary: z.string().optional(),
  })
  .strict();
export type EvaluateGateResult = z.infer<typeof EvaluateGateZodSchema>;

function parseJson(text: string, contractName: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      `Cannot parse ${contractName}: last-message file is empty (codex-cli ${CODEX_CLI_VERSION_PREMISE} premise).`
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `Cannot parse ${contractName}: last-message file is not valid JSON. ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Parse a worker's last-message file as a leaf DONE/HANDOFF return. Throws an
 * actionable error on empty/non-JSON/non-conforming input rather than
 * guessing a status.
 */
export function parseLeafReturn(text: string): LeafReturn {
  const json = parseJson(text, 'leaf return');
  const result = LeafReturnZodSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `Leaf return does not conform to the DONE/HANDOFF contract: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

/**
 * Parse a worker's last-message file as an evaluate-gate result. Throws an
 * actionable error on empty/non-JSON/non-conforming input.
 */
export function parseEvaluateGate(text: string): EvaluateGateResult {
  const json = parseJson(text, 'evaluate-gate result');
  const result = EvaluateGateZodSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `Evaluate-gate result does not conform to the {satisfied, gaps} contract: ${result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}
