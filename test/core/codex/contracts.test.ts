import { describe, expect, it } from 'vitest';
import {
  EVALUATE_GATE_SCHEMA,
  LEAF_RETURN_SCHEMA,
  parseEvaluateGate,
  parseLeafReturn,
} from '../../../src/core/codex/contracts.js';

describe('parseLeafReturn', () => {
  it('parses a conforming DONE fixture', () => {
    const result = parseLeafReturn('{"status":"DONE"}');
    expect(result).toEqual({ status: 'DONE' });
  });

  it('parses a conforming fixture with summary and handoffReason', () => {
    const result = parseLeafReturn(
      '{"status":"HANDOFF","summary":"nearly done","handoffReason":"context limit"}'
    );
    expect(result).toEqual({
      status: 'HANDOFF',
      summary: 'nearly done',
      handoffReason: 'context limit',
    });
  });

  it('normalizes Codex required-but-nullable optional fields', () => {
    const result = parseLeafReturn(
      '{"status":"DONE","summary":null,"handoffReason":null}'
    );
    expect(result).toEqual({ status: 'DONE' });
  });

  it('fails on an empty last-message file', () => {
    expect(() => parseLeafReturn('')).toThrow(/empty/i);
  });

  it('fails on non-JSON content', () => {
    expect(() => parseLeafReturn('not json at all')).toThrow(/not valid JSON/i);
  });

  it('fails on a missing required status field', () => {
    expect(() => parseLeafReturn('{"summary":"no status"}')).toThrow(/status/i);
  });

  it('fails on an invalid status enum value', () => {
    expect(() => parseLeafReturn('{"status":"MAYBE"}')).toThrow();
  });

  it('fails on an extra unknown property (additionalProperties: false)', () => {
    expect(() => parseLeafReturn('{"status":"DONE","extra":"nope"}')).toThrow();
  });
});

describe('parseEvaluateGate', () => {
  it("rejects the dossier's captured leaf-return fixture (E10) — it is DONE/HANDOFF-shaped, not {satisfied, gaps}-shaped", () => {
    // E10's captured output ({"gaps":[...],"status":"HANDOFF"}) demonstrates the
    // leaf-return contract, not the evaluate-gate one: it lacks `satisfied` and
    // carries the evaluate-gate-foreign `status` key, so it must be rejected here.
    expect(() =>
      parseEvaluateGate('{"gaps":["missing tests","no docs"],"status":"HANDOFF"}')
    ).toThrow();
  });

  it('parses a conforming satisfied=true fixture', () => {
    const result = parseEvaluateGate('{"satisfied":true,"gaps":[]}');
    expect(result).toEqual({ satisfied: true, gaps: [] });
  });

  it('parses a conforming satisfied=false fixture with gaps and summary', () => {
    const result = parseEvaluateGate(
      '{"satisfied":false,"gaps":["missing tests","no docs"],"summary":"two gaps found"}'
    );
    expect(result).toEqual({
      satisfied: false,
      gaps: ['missing tests', 'no docs'],
      summary: 'two gaps found',
    });
  });

  it('normalizes the Codex nullable evaluate summary', () => {
    const result = parseEvaluateGate(
      '{"satisfied":true,"gaps":[],"summary":null}'
    );
    expect(result).toEqual({ satisfied: true, gaps: [] });
  });

  it('fails on empty input', () => {
    expect(() => parseEvaluateGate('   ')).toThrow(/empty/i);
  });

  it('fails on malformed JSON', () => {
    expect(() => parseEvaluateGate('{satisfied: true')).toThrow(/not valid JSON/i);
  });

  it('fails when required fields are missing', () => {
    expect(() => parseEvaluateGate('{"satisfied":true}')).toThrow(/gaps/i);
  });

  it('fails on extra unknown properties', () => {
    expect(() => parseEvaluateGate('{"satisfied":true,"gaps":[],"extra":1}')).toThrow();
  });
});

describe('Codex-compatible JSON Schema and backwards-compatible parsing', () => {
  const leafAccept = [
    { status: 'DONE' },
    { status: 'HANDOFF', summary: 's' },
    { status: 'HANDOFF', handoffReason: 'r' },
  ];
  const leafReject = [
    {},
    { status: 'MAYBE' },
    { status: 'DONE', extra: true },
    { summary: 'no status' },
  ];

  it('requires every leaf property and represents optional values as nullable', () => {
    expect(new Set(LEAF_RETURN_SCHEMA.required)).toEqual(
      new Set(Object.keys(LEAF_RETURN_SCHEMA.properties))
    );
    expect(LEAF_RETURN_SCHEMA.properties.status.enum).toEqual(['DONE', 'HANDOFF']);
    expect(LEAF_RETURN_SCHEMA.properties.summary.type).toEqual(['string', 'null']);
    expect(LEAF_RETURN_SCHEMA.properties.handoffReason.type).toEqual(['string', 'null']);
    expect(LEAF_RETURN_SCHEMA.additionalProperties).toBe(false);

    for (const fixture of leafAccept) {
      expect(() => parseLeafReturn(JSON.stringify(fixture))).not.toThrow();
    }
    for (const fixture of leafReject) {
      expect(() => parseLeafReturn(JSON.stringify(fixture))).toThrow();
    }
  });

  const gateAccept = [
    { satisfied: true, gaps: [] },
    { satisfied: false, gaps: ['a', 'b'], summary: 's' },
  ];
  const gateReject = [{}, { satisfied: true }, { gaps: [] }, { satisfied: true, gaps: [], extra: 1 }];

  it('requires every evaluate property and represents its optional summary as nullable', () => {
    expect(new Set(EVALUATE_GATE_SCHEMA.required)).toEqual(
      new Set(Object.keys(EVALUATE_GATE_SCHEMA.properties))
    );
    expect(EVALUATE_GATE_SCHEMA.properties.summary.type).toEqual(['string', 'null']);
    expect(EVALUATE_GATE_SCHEMA.additionalProperties).toBe(false);

    for (const fixture of gateAccept) {
      expect(() => parseEvaluateGate(JSON.stringify(fixture))).not.toThrow();
    }
    for (const fixture of gateReject) {
      expect(() => parseEvaluateGate(JSON.stringify(fixture))).toThrow();
    }
  });
});
