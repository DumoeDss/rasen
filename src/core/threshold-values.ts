import { z } from 'zod';

/** Pipeline roles that may carry a handoff threshold override. */
export const THRESHOLD_ROLES = [
  'planner',
  'implementer',
  'reviewer',
  'fixer',
  'shipper',
] as const;
export type ThresholdRole = (typeof THRESHOLD_ROLES)[number];

/** The only roles whose workers may be reused across child changes. */
export const REUSE_THRESHOLD_ROLES = ['planner', 'implementer'] as const;
export type ReuseThresholdRole = (typeof REUSE_THRESHOLD_ROLES)[number];

/** A context-window fraction or an absolute remaining-token threshold. */
export type ThresholdValue = number | { remainingTokens: number };

/** Build the strict dual-form threshold schema shared by every threshold family. */
export function thresholdSchema(label: string) {
  return z.union([
    z.number().gt(0, { error: `${label} must be in (0, 1]` }).lte(1, {
      error: `${label} must be in (0, 1]`,
    }),
    z
      .object({
        remainingTokens: z
          .number()
          .int({ error: `${label} remainingTokens must be a positive integer` })
          .positive({ error: `${label} remainingTokens must be a positive integer` }),
      })
      .strict(),
  ]);
}
