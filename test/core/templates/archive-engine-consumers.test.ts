import { describe, expect, it } from 'vitest';

import { getArchiveChangeSkillTemplate } from '../../../src/core/templates/workflows/archive-change.js';
import { getBulkArchiveChangeSkillTemplate } from '../../../src/core/templates/workflows/bulk-archive-change.js';
import { getShipCommandSkillTemplate } from '../../../src/core/templates/workflows/ship.js';
import { getSyncSpecsSkillTemplate } from '../../../src/core/templates/workflows/sync-specs.js';

const REQUIRED_INTENT_COMMAND = 'rasen archive "<name>" --intent-template --json';
const REQUIRED_PLAN_COMMAND =
  'rasen archive "<name>" --intent-file "<intent-path>" --dry-run --save-plan --json';
const REQUIRED_APPLY_COMMAND =
  'rasen archive --apply-plan "<planToken>" --json --yes';
const REQUIRED_ABORT_COMMAND =
  'rasen archive --abort-plan "<planToken>" --json --yes';
const FORBIDDEN_DIRECT_COMMANDS = [
  /(^|\s)mv\s+/m,
  /(^|\s)rm\s+-(?:r|rf|fr)\b/m,
  /(^|\s)mkdir\s+-p\b/m,
  />\s*["']?[^"' \n]*archive\.json\b/m,
];

function bashBlocks(instructions: string): string[] {
  return [...instructions.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map(match => match[1]);
}

describe('generated archive consumers use the authoritative engine', () => {
  const consumers = [
    ['single', getArchiveChangeSkillTemplate().instructions],
    ['bulk', getBulkArchiveChangeSkillTemplate().instructions],
    ['in-ship', getShipCommandSkillTemplate().instructions],
  ] as const;

  it.each(consumers)('%s contains plan and apply engine invocations', (_name, instructions) => {
    expect(instructions).toContain(REQUIRED_PLAN_COMMAND);
    expect(instructions).toContain(REQUIRED_APPLY_COMMAND);
    expect(instructions).toContain(REQUIRED_ABORT_COMMAND);
    expect(instructions).toContain(REQUIRED_INTENT_COMMAND);
    expect(instructions).not.toContain('rasen-sync-specs');
    expect(instructions).not.toContain('rasen archive "<name>" --json --yes');
  });

  it.each(consumers)('%s contains no direct archive filesystem command', (_name, instructions) => {
    for (const block of bashBlocks(instructions)) {
      for (const forbidden of FORBIDDEN_DIRECT_COMMANDS) {
        expect(block).not.toMatch(forbidden);
      }
    }
    expect(instructions).not.toContain('**Archive commit:**');
  });

  it('single archive emits strict versioned, change-bound handoff intent', () => {
    const instructions = getArchiveChangeSkillTemplate().instructions;
    expect(instructions).toContain('"schemaVersion":1');
    expect(instructions).toContain('"change":"<name>"');
    expect(instructions).toContain('"complete":true');
    expect(instructions).toContain('"outcome":"absorbed"|"preserved"');
    expect(instructions).toContain('Do not delete or move active handoff files');
  });

  it.each(consumers)('%s owns reserved-heading and recovery disposition guidance', (_name, instructions) => {
    expect(instructions).toContain('## Archive');
    expect(instructions.toLowerCase()).toContain('remove or rename');
    expect(instructions).toContain('manualRecoveryAction');
    expect(instructions).toContain('recoverable');
    expect(instructions).toContain('abort-required');
  });

  it('sync-specs requires complete replacement blocks and a clean shared preflight', () => {
    const instructions = getSyncSpecsSkillTemplate().instructions;
    expect(instructions).toContain('MODIFIED` is wholesale replacement');
    expect(instructions).toContain('complete surviving scenario inventory');
    expect(instructions).toContain('unchanged scenario blocks verbatim');
    expect(instructions).toContain('rasen validate "<name>" --type change --strict --json');
    expect(instructions).not.toContain('partial updates');
    expect(instructions).not.toContain("don't need to copy existing ones");
  });

  it('bulk summary describes only pre-hash archive facts', () => {
    const instructions = getBulkArchiveChangeSkillTemplate().instructions;
    expect(instructions).toContain(
      'recorded ship commit when known, archive path, timestamp, outcome, and transaction'
    );
    expect(instructions).toContain(
      'no post-hash commit identifier is written into evidence'
    );
    expect(instructions).not.toContain('ship commit, archive commit, outcome');
  });
});
