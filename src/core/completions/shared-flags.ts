import type { FlagDefinition } from './types.js';

/**
 * Common flags used across multiple commands.
 */
export const COMMON_FLAGS = {
  json: {
    name: 'json',
  } as FlagDefinition,
  jsonValidation: {
    name: 'json',
  } as FlagDefinition,
  strict: {
    name: 'strict',
  } as FlagDefinition,
  noInteractive: {
    name: 'no-interactive',
  } as FlagDefinition,
  type: {
    name: 'type',
    takesValue: true,
    completionValues: ['change', 'spec'],
  } as FlagDefinition,
  store: {
    name: 'store',
    takesValue: true,
  } as FlagDefinition,
  project: {
    name: 'project',
    takesValue: true,
  } as FlagDefinition,
} as const;
