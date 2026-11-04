/**
 * Shared Utilities
 *
 * Common code shared between init and update commands.
 */

export {
  SKILL_NAMES,
  type SkillName,
  COMMAND_IDS,
  type CommandId,
  type ToolSkillStatus,
  type ToolVersionStatus,
  type ResolvedConfiguredTools,
  getToolsWithSkillsDir,
  isKnownUnadaptedTool,
  resolveToolSkillsRoot,
  getToolSkillStatus,
  getToolStates,
  extractGeneratedByVersion,
  getToolVersionStatus,
  getConfiguredTools,
  getAllToolVersionStatus,
  resolveConfiguredTools,
} from './tool-detection.js';

export {
  type SkillTemplateEntry,
  getSkillTemplates,
  generateSkillContent,
  copySkillSidecars,
} from './skill-generation.js';

export {
  type LocalBuildInfo,
  localBuildInfoPath,
  readLocalBuildInfo,
  formatCliVersion,
} from './build-info.js';
