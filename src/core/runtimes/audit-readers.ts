/**
 * The shipped token auditors, one per audit-capable runtime.
 *
 * A sibling of `session-stores.ts`; see that module's header for why the four
 * implementation registries are separate modules and why every adapter member
 * is an arrow rather than a bare function reference. This is the registry
 * that reaches the Zed reader's WASM SQLite engine, so it is also the reason
 * they are separate: nothing on the context-probe path imports it.
 *
 * The map is checked against `AuditRuntime`, the union derived from
 * `canAudit`. Zed is auditable and has no transcript file at all, which is
 * exactly why recognition lives on the session store rather than here
 * (design D3).
 */
import type { AuditReader, AuditRuntime } from '../runtime-adapters.js';
import { runClaudeAudit, runCodexAudit, runZedAudit } from '../token-audit/audit.js';

export const AUDIT_READERS = {
  claude: {
    id: 'claude',
    run: (target, options) => runClaudeAudit(target, options),
  },
  codex: {
    id: 'codex',
    run: (target, options) => runCodexAudit(target, options),
  },
  zed: {
    id: 'zed',
    run: (target, options) => runZedAudit(target, options),
  },
} satisfies { [Id in AuditRuntime]: AuditReader<Id> };
