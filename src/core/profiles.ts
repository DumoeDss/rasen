/**
 * Profile System
 *
 * Defines workflow profiles that control which workflows are installed.
 * Profiles determine WHICH workflows; delivery (in global config) determines HOW.
 */

import type { Profile } from './global-config.js';
import {
  BUILT_IN_WORKFLOW_IDS,
  CORE_WORKFLOW_IDS,
  type BuiltInWorkflowId,
} from './workflow-registry/index.js';

/**
 * Core workflows included in the 'core' profile.
 * These provide the streamlined experience for new users.
 */
export const CORE_WORKFLOWS = CORE_WORKFLOW_IDS;

/**
 * All available workflows in the system.
 */
export const ALL_WORKFLOWS = BUILT_IN_WORKFLOW_IDS;

export type WorkflowId = BuiltInWorkflowId;
export type CoreWorkflowId = (typeof CORE_WORKFLOWS)[number];

/**
 * Resolves which workflows should be active for a given profile configuration.
 *
 * - 'full' profile always returns ALL_WORKFLOWS (the default)
 * - 'core' profile always returns CORE_WORKFLOWS
 * - 'custom' profile returns the provided customWorkflows, or empty array if not provided
 */
export function getProfileWorkflows(
  profile: Profile,
  customWorkflows?: string[]
): readonly string[] {
  if (profile === 'custom') {
    return customWorkflows ?? [];
  }
  if (profile === 'core') {
    return CORE_WORKFLOWS;
  }
  return ALL_WORKFLOWS;
}
