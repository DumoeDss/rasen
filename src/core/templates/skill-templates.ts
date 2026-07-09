/**
 * Agent Skill Templates
 *
 * Compatibility facade that re-exports split workflow template modules.
 */

export type { SkillTemplate, CommandTemplate } from './types.js';

export { getExploreSkillTemplate, getOpsxExploreCommandTemplate } from './workflows/explore.js';
export { getNewChangeSkillTemplate, getOpsxNewCommandTemplate } from './workflows/new-change.js';
export { getContinueChangeSkillTemplate, getOpsxContinueCommandTemplate } from './workflows/continue-change.js';
export { getApplyChangeSkillTemplate, getOpsxApplyCommandTemplate } from './workflows/apply-change.js';
export { getFfChangeSkillTemplate, getOpsxFfCommandTemplate } from './workflows/ff-change.js';
export { getSyncSpecsSkillTemplate, getOpsxSyncCommandTemplate } from './workflows/sync-specs.js';
export { getArchiveChangeSkillTemplate, getOpsxArchiveCommandTemplate } from './workflows/archive-change.js';
export { getBulkArchiveChangeSkillTemplate, getOpsxBulkArchiveCommandTemplate } from './workflows/bulk-archive-change.js';
export { getVerifyChangeSkillTemplate, getOpsxVerifyCommandTemplate } from './workflows/verify-change.js';
export { getOnboardSkillTemplate, getOpsxOnboardCommandTemplate } from './workflows/onboard.js';
export { getOpsxProposeSkillTemplate, getOpsxProposeCommandTemplate } from './workflows/propose.js';
export { getFeedbackSkillTemplate } from './workflows/feedback.js';

// Rasen fusion workflow commands
export { getOfficeHoursCommandSkillTemplate, getOpsxOfficeHoursCommandTemplate } from './workflows/office-hours.js';
export { getVerifyEnhancedSkillTemplate, getOpsxVerifyEnhancedCommandTemplate } from './workflows/verify-enhanced.js';
export { getShipCommandSkillTemplate, getOpsxShipCommandTemplate } from './workflows/ship.js';
export { getRetroCommandSkillTemplate, getOpsxRetroCommandTemplate } from './workflows/retro.js';
export { getAutoCommandSkillTemplate, getOpsxAutoCommandTemplate } from './workflows/auto.js';
export { getReviewCycleSkillTemplate, getOpsxReviewCycleCommandTemplate } from './workflows/review-cycle.js';
export { getHandoffSkillTemplate, getOpsxHandoffCommandTemplate } from './workflows/handoff.js';
export { getGoalPlanSkillTemplate } from './workflows/goal-plan.js';
export { getGoalIterateSkillTemplate } from './workflows/goal-iterate.js';
export { getGoalReportSkillTemplate } from './workflows/goal-report.js';
export { getGoalCommandSkillTemplate, getOpsxGoalCommandTemplate } from './workflows/goal-command.js';

// Expert skill templates (migrated from gstack)
export {
  getBenchmarkSkillTemplate,
  getCarefulSkillTemplate,
  getChromeUseSkillTemplate,
  getCodebaseDesignSkillTemplate,
  getCodexSkillTemplate,
  getCsoSkillTemplate,
  getDesignConsultationSkillTemplate,
  getDesignReviewSkillTemplate,
  getFreezeSkillTemplate,
  getGuardSkillTemplate,
  getInvestigateSkillTemplate,
  getNavigatorSkillTemplate,
  getOfficeHoursSkillTemplate,
  getPrototypeSkillTemplate,
  getQaOnlySkillTemplate,
  getQaSkillTemplate,
  getReviewSkillTemplate,
  getTddSkillTemplate,
  getUnfreezeSkillTemplate,
} from './experts/index.js';
