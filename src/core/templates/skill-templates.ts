/**
 * Agent Skill Templates
 *
 * Compatibility facade that re-exports split workflow template modules.
 */

export type { SkillTemplate } from './types.js';

export { getExploreSkillTemplate } from './workflows/explore.js';
export { getNewChangeSkillTemplate } from './workflows/new-change.js';
export { getContinueChangeSkillTemplate } from './workflows/continue-change.js';
export { getApplyChangeSkillTemplate } from './workflows/apply-change.js';
export { getSyncSpecsSkillTemplate } from './workflows/sync-specs.js';
export { getArchiveChangeSkillTemplate } from './workflows/archive-change.js';
export { getBulkArchiveChangeSkillTemplate } from './workflows/bulk-archive-change.js';
export { getVerifyChangeSkillTemplate } from './workflows/verify-change.js';
export { getOnboardSkillTemplate } from './workflows/onboard.js';
export { getHelpSkillTemplate } from './workflows/help.js';
export { getOpsxProposeSkillTemplate } from './workflows/propose.js';
export { getFeedbackSkillTemplate } from './workflows/feedback.js';

// Rasen fusion workflow commands
export { getOfficeHoursCommandSkillTemplate } from './workflows/office-hours.js';
export { getVerifyEnhancedSkillTemplate } from './workflows/verify-enhanced.js';
export { getShipCommandSkillTemplate } from './workflows/ship.js';
export { getRetroCommandSkillTemplate } from './workflows/retro.js';
export { getAutoCommandSkillTemplate } from './workflows/auto.js';
export { getReviewCycleSkillTemplate } from './workflows/review-cycle.js';
export { getHandoffSkillTemplate } from './workflows/handoff.js';
export { getGoalPlanSkillTemplate } from './workflows/goal-plan.js';
export { getGoalIterateSkillTemplate } from './workflows/goal-iterate.js';
export { getGoalReportSkillTemplate } from './workflows/goal-report.js';
export { getGoalCommandSkillTemplate } from './workflows/goal-command.js';

// Expert skill templates (inlined prompts)
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
  getWorkflowAuthorSkillTemplate,
  getWorkflowReviewSkillTemplate,
} from './experts/index.js';
