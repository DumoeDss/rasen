import { describe, expect, it } from 'vitest';

import * as codexContracts from '../../src/core/codex/contracts.js';
import * as claude from '../../src/core/claude/index.js';
import {
  EVALUATE_GATE_SCHEMA,
  CONSULTABLE_LEAF_RETURN_SCHEMA,
  LEAF_RETURN_SCHEMA,
  parseEvaluateGate,
  parseConsultableLeafReturn,
  parseLeafReturn,
} from '../../src/core/worker-contracts.js';

describe('runtime-neutral worker contracts', () => {
  it('exports the same schema object identities through both runtimes', () => {
    expect(codexContracts.LEAF_RETURN_SCHEMA).toBe(LEAF_RETURN_SCHEMA);
    expect(claude.LEAF_RETURN_SCHEMA).toBe(LEAF_RETURN_SCHEMA);
    expect(codexContracts.EVALUATE_GATE_SCHEMA).toBe(EVALUATE_GATE_SCHEMA);
    expect(claude.EVALUATE_GATE_SCHEMA).toBe(EVALUATE_GATE_SCHEMA);
    expect(codexContracts.CONSULTABLE_LEAF_RETURN_SCHEMA).toBe(
      CONSULTABLE_LEAF_RETURN_SCHEMA
    );
    expect(claude.CONSULTABLE_LEAF_RETURN_SCHEMA).toBe(
      CONSULTABLE_LEAF_RETURN_SCHEMA
    );
  });

  it('keeps the existing Codex parsers compatible', () => {
    expect(codexContracts.parseLeafReturn).toBe(parseLeafReturn);
    expect(codexContracts.parseEvaluateGate).toBe(parseEvaluateGate);
    expect(parseLeafReturn('{"status":"DONE"}')).toEqual({ status: 'DONE' });
    expect(parseEvaluateGate('{"satisfied":false,"gaps":["x"]}')).toEqual({
      satisfied: false,
      gaps: ['x'],
    });
  });

  it('keeps leaf terminal-only while consultable-leaf accepts bounded CONSULT', () => {
    const consult = {
      status: 'CONSULT',
      problemSummary: 'stuck',
      question: 'What invariant was missed?',
      attemptedApproaches: ['reproduced'],
      constraints: ['read-only Teacher'],
      evidencePointers: ['test/output.txt'],
    } as const;
    expect(() => parseLeafReturn(JSON.stringify(consult))).toThrow(/DONE\/HANDOFF/);
    expect(parseConsultableLeafReturn(JSON.stringify(consult))).toEqual(consult);
    expect(() =>
      parseConsultableLeafReturn(JSON.stringify({ ...consult, model: 'override' }))
    ).toThrow(/unrecognized|contract/i);
  });
});
