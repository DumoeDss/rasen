const RANDOM_ID_KEYS = new Set(['sessionId', 'requestId', 'nonce', 'ownerToken']);
const PID_KEYS = new Set(['pid', 'rootPid']);

/**
 * Normalizes only declared replay nondeterminism. Array order, lifecycle
 * states, event types, backend identities, request/result digests, argv, and
 * cwd remain byte-for-byte comparable.
 */
export function normalizeSessionHostReplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSessionHostReplay);
  if (typeof value !== 'object' || value === null) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (RANDOM_ID_KEYS.has(key)) normalized[key] = '<random-id>';
    else if (PID_KEYS.has(key)) normalized[key] = '<pid>';
    else if (key === 'timestamp' || key.endsWith('At')) normalized[key] = '<timestamp>';
    else normalized[key] = normalizeSessionHostReplay(child);
  }
  return normalized;
}
