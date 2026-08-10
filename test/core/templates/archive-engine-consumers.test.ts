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

  it('single archive preserves canonical interactive PR overrides before preview and apply', () => {
    const instructions = getArchiveChangeSkillTemplate().instructions;
    const verification = instructions.indexOf(
      'gh pr view <url> --json state,mergedAt'
    );
    const preview = instructions.indexOf(REQUIRED_PLAN_COMMAND);
    const mergeOnlyAdmission = instructions.indexOf(
      'exactly one blocker with the typed code `archive_merge_confirmation_required`'
    );
    const apply = instructions.indexOf(REQUIRED_APPLY_COMMAND);

    expect(verification).toBeGreaterThanOrEqual(0);
    expect(preview).toBeGreaterThan(verification);
    expect(mergeOnlyAdmission).toBeGreaterThan(preview);
    expect(apply).toBeGreaterThan(mergeOnlyAdmission);
    expect(instructions).toContain(
      `After admitting either a zero-blocker preview or the sole typed merge blocker permitted above, run \`${REQUIRED_APPLY_COMMAND}\``
    );
    expect(instructions).toContain(
      'reject that code when accompanied by any other blocker, and reject every other blocker'
    );
    expect(instructions).toContain(
      'separate explicit override that names this PR\'s known OPEN/unmerged condition'
    );
    expect(instructions).toContain(
      'ask the human to explicitly confirm that this recorded PR is merged and treat that answer as the check'
    );
    expect(instructions).toContain(
      'In a non-interactive or dispatched context, REFUSE outright'
    );
    expect(instructions).toContain(
      'Only in the sole-merge-blocker case does the generated apply command\'s `--yes` supply the saved merge-gate assertion; on a zero-blocker plan it admits no blocker'
    );
  });

  it('bulk archive resolves each PR independently before sync, preview, and apply', () => {
    const instructions = getBulkArchiveChangeSkillTemplate().instructions;
    const verification = instructions.indexOf(
      'gh pr view <url> --json state,mergedAt'
    );
    const sync = instructions.indexOf(
      '**Sync specs** after that item\'s PR gate is satisfied'
    );
    const preview = instructions.indexOf(REQUIRED_PLAN_COMMAND);
    const apply = instructions.indexOf(REQUIRED_APPLY_COMMAND);

    expect(verification).toBeGreaterThanOrEqual(0);
    expect(sync).toBeGreaterThan(verification);
    expect(preview).toBeGreaterThan(sync);
    expect(apply).toBeGreaterThan(preview);
    expect(instructions).toContain(
      'separate explicit override naming this item\'s PR and its known OPEN/unmerged condition'
    );
    expect(instructions).toContain(
      'ask separately whether that recorded PR is merged and treat only that explicit item-specific confirmation as the check'
    );
    expect(instructions).toContain(
      'One answer MUST NOT satisfy another item or waive another blocker'
    );
    expect(instructions).toContain(
      'Require zero blockers except that a PR item whose gate was satisfied in step 8a may contain exactly one typed `archive_merge_confirmation_required` blocker'
    );
    expect(instructions).toContain(
      'Preserve every returned recovery or abort command exactly, including `--yes` when present'
    );
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
