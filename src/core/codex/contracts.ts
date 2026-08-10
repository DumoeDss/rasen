/**
 * Backward-compatible Codex contract surface.
 *
 * The canonical definitions live in the runtime-neutral core module so Codex
 * and Claude bridges consume the same objects and parsers.
 */
export {
  LEAF_RETURN_SCHEMA,
  CONSULTABLE_LEAF_RETURN_SCHEMA,
  EVALUATE_GATE_SCHEMA,
  LeafReturnZodSchema,
  ConsultableLeafReturnZodSchema,
  EvaluateGateZodSchema,
  workerContractJsonSchema,
  parseLeafReturn,
  parseConsultableLeafReturn,
  parseEvaluateGate,
  parseLeafReturnValue,
  parseConsultableLeafReturnValue,
  parseEvaluateGateValue,
  parseWorkerContractValue,
  type LeafReturn,
  type ConsultableLeafReturn,
  type EvaluateGateResult,
  type WorkerContract,
  type WorkerContractResult,
} from '../worker-contracts.js';
