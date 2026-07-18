import type { ApiErrorBody } from '../../src/api/types.js';

export interface RecordedErrorCase {
  status: number;
  body: ApiErrorBody;
}

/** Error strings copied verbatim from `src/core/config-api/router.ts` / `config-keys.ts`'s `sendError` call sites. */
export const errorsFixture: Record<
  'invalid_scope' | 'scope_required' | 'project_required' | 'invalid_value' | 'unauthorized',
  RecordedErrorCase
> = {
  invalid_scope: {
    status: 400,
    body: {
      error: {
        code: 'invalid_scope',
        message: '"repoMode" is only settable in scope "global", not "project".',
        fix: 'Use scope: "global" instead.',
      },
    },
  },
  scope_required: {
    status: 400,
    body: {
      error: {
        code: 'scope_required',
        message: 'Body must include "scope": "global" or "project".',
      },
    },
  },
  project_required: {
    status: 400,
    body: {
      error: {
        code: 'project_required',
        message:
          'Scope "project" requires a resolvable project; pass ?project=<id|root> or run "rasen config ui" inside a Rasen project.',
      },
    },
  },
  invalid_value: {
    status: 400,
    body: {
      error: {
        code: 'invalid_value',
        message:
          'threshold must be a number in (0, 1], or an object { remainingTokens: <positive integer> }',
      },
    },
  },
  unauthorized: {
    status: 401,
    body: {
      error: {
        code: 'unauthorized',
        message: 'Missing or invalid bearer token.',
      },
    },
  },
};
