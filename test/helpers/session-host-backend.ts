import { randomUUID } from 'node:crypto';

import type {
  AgentSessionTransport,
  PreparedAgentSessionTransport,
} from '../../src/core/session-host/backend.js';
import { asProcessRef } from '../../src/core/session-host/process-scope.js';

export function prepareTestSessionTransport(
  transport: AgentSessionTransport & { rootPid?: number },
): PreparedAgentSessionTransport {
  const runtimeRef = asProcessRef(
    `rasen-process-scope/1:${Buffer.from(randomUUID()).toString('base64url')}`
  );
  Object.assign(transport, {
    runtimeRef,
    ...(transport.rootPid ? { displayPid: transport.rootPid } : {}),
  });
  return {
    runtimeRef,
    ...(transport.displayPid ? { displayPid: transport.displayPid } : {}),
    async activate() { return transport; },
    async abort() {
      const outcome = await transport.terminate('prepared-test-abort');
      return {
        state: outcome.closed ? 'closed' as const : 'retained' as const,
        gracefulAttempted: false,
        forced: outcome.closed,
      };
    },
  };
}
