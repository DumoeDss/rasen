import { describe, expect, it } from 'vitest';

import {
  getAutoCommandSkillTemplate,
  getQaSkillTemplate,
  getVerifyEnhancedSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { ORCHESTRATION_PLAYBOOK } from '../../../src/core/templates/workflows/_orchestration.js';

describe('unified QA expert modes', () => {
  const qa = getQaSkillTemplate().instructions;

  it('keeps the standalone test/fix/verify loop while making report-only mode explicitly non-mutating', () => {
    expect(getQaSkillTemplate().name).toBe('rasen-qa');
    expect(qa).toContain('default standalone mode');
    expect(qa).toContain('## Phase 8: Fix Loop');
    expect(qa).toContain('explicit report-only/non-UI modes');
    expect(qa).toContain('never edit code, ask fix-oriented questions, commit, or enter the fix loop');
    expect(qa).toContain('skip this clean-tree check entirely');
    expect(qa).toContain('Report-only modes never bootstrap or modify test infrastructure');
    expect(qa).toContain('skip this phase because it edits the repository');
  });

  it('keeps report-only QA browser-first with the bounded source-reading carve-out and canonical report', () => {
    expect(qa).toContain('Every QA mode, including explicit report-only/non-UI mode, is browser-based testing');
    expect(qa).toContain('may read source only for bounded diff-aware triage');
    expect(qa).toContain('write one report document to the mode-aware `REPORT_PATH`');
    expect(qa).toContain('canonical severity');
    expect(qa).toContain('Blocker');
  });

  it('initializes a safe mode-aware REPORT_DIR before every shared screenshot command', () => {
    const setupIndex = qa.indexOf('Resolve the report and browser-evidence destinations');
    const methodologyIndex = qa.indexOf('## Phases 1-6: QA Baseline');
    expect(setupIndex).toBeGreaterThan(-1);
    expect(setupIndex).toBeLessThan(methodologyIndex);
    expect(qa).toContain('REPORT_DIR="$WORK_DIR/qa-evidence"');
    expect(qa).toContain('REPORT_PATH="$WORK_DIR/qa-report.md"');
    expect(qa).toContain('mktemp -d "${TMPDIR:-/tmp}/rasen-qa-report-only.XXXXXX"');
    expect(qa).toContain('test -n "$REPORT_DIR" && test "$REPORT_DIR" != "/"');
    expect(qa).toContain('mkdir -p "$REPORT_DIR/screenshots"');
    expect(qa).toContain('Do not fall back to `/screenshots`');
    expect(qa).toContain('skip the standalone dated report and project-docs paths');
    expect(qa).not.toContain('mkdir -p .rasen/qa-reports/screenshots');
  });

  it('routes verification and LEAD dispatch through one QA identity and an explicit mode', () => {
    const verify = getVerifyEnhancedSkillTemplate().instructions;
    const auto = getAutoCommandSkillTemplate().instructions;
    expect(verify).toContain('Invoke `rasen-qa` with an explicit `report-only/non-UI` instruction');
    expect(verify).not.toContain('rasen-qa-only');
    expect(auto).toContain('qa-report-only (non-UI; dispatch `rasen-qa` with an explicit report-only instruction)');
    expect(ORCHESTRATION_PLAYBOOK).toContain('For a `qa-report-only` stage');
    expect(ORCHESTRATION_PLAYBOOK).toContain('invoke `rasen-qa` in report-only/non-UI mode');
  });
});
