import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const MAX_REGISTRY_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024;
const MAX_APPENDED_BYTES = 2 * 1024 * 1024;
const RUN_ID = /^run:[a-f0-9]{64}$/u;
const SESSION_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SCHEDULER_TOUCH_MESSAGE =
  'Keepalive touch. Reply with exactly: OK. Do not use any tools.';

function boundedRegularFile(filePath, maximumBytes, code) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`${code}_missing`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${code}_symlink`);
  if (!stat.isFile()) throw new Error(`${code}_not_regular`);
  if (stat.size > maximumBytes) throw new Error(`${code}_oversize`);
  const canonicalPath = fs.realpathSync.native(filePath);
  if (canonicalPath !== path.resolve(filePath)) {
    throw new Error(`${code}_identity`);
  }
  return { stat, canonicalPath };
}

function readBoundedJson(filePath, maximumBytes, code) {
  const checked = boundedRegularFile(filePath, maximumBytes, code);
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${code}_schema`);
  }
  return { value, checked };
}

function runDirectoryName(runId) {
  return runId.replace(/[^a-z0-9]/giu, '_');
}

function claudeProjectsDirectory(cwd, homeDir) {
  const slug = cwd.replace(/[:\\/.]/gu, '-');
  return path.join(homeDir, '.claude', 'projects', slug);
}

function validateClaudeSessionId(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value === '.'
    || value === '..'
    || path.basename(value) !== value
    || value.includes('/')
    || value.includes('\\')
  ) {
    throw new Error('claude_session_identity_invalid');
  }
  return value;
}

function exactRegistrySession(registry, identity) {
  if (
    registry.schema !== 'rasen-session-registry/1'
    || registry.runId !== identity.runId
    || !Array.isArray(registry.sessions)
  ) {
    throw new Error('registry_identity_mismatch');
  }
  const matches = registry.sessions.filter(
    (session) => session?.sessionKey === identity.sessionKey
  );
  if (matches.length !== 1) throw new Error('registry_session_identity_mismatch');
  const session = matches[0];
  if (
    typeof session !== 'object'
    || session === null
    || path.resolve(session.cwd) !== path.resolve(identity.cwd)
  ) {
    throw new Error('registry_cwd_identity_mismatch');
  }
  return session;
}

function usageFromEntry(entry) {
  if (entry?.type !== 'assistant') return null;
  const usage = entry?.message?.usage;
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    return null;
  }
  const sourceKeys = [
    'input_tokens',
    'cache_creation_input_tokens',
    'cache_read_input_tokens',
    'output_tokens',
  ];
  if (
    sourceKeys.some(
      (key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0
    )
  ) {
    throw new Error('transcript_usage_schema_invalid');
  }
  if (typeof entry.message.id !== 'string' || entry.message.id.length === 0) {
    throw new Error('transcript_message_identity_missing');
  }
  return {
    messageIdentity: entry.message.id,
    counters: {
      inputTokens: usage.input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      outputTokens: usage.output_tokens,
    },
  };
}

function readExactRange(filePath, start, length) {
  const flags =
    fs.constants.O_RDONLY
    | (typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0);
  const handle = fs.openSync(filePath, flags);
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || stat.size < start + length) {
      throw new Error('transcript_changed_during_read');
    }
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const read = fs.readSync(
        handle,
        buffer,
        offset,
        length - offset,
        start + offset
      );
      if (read === 0) throw new Error('transcript_changed_during_read');
      offset += read;
    }
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function transcriptPathFingerprint(filePath) {
  return createHash('sha256').update(filePath, 'utf8').digest('hex');
}

function transcriptFileIdentityFingerprint(stat) {
  return createHash('sha256')
    .update(JSON.stringify({
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeMs: stat.birthtimeMs,
    }), 'utf8')
    .digest('hex');
}

function exactRangeFingerprint(filePath, start, length) {
  return createHash('sha256')
    .update(readExactRange(filePath, start, length), 'utf8')
    .digest('hex');
}

export function captureExactTranscriptState(input) {
  if (!RUN_ID.test(input.identity.runId)) throw new Error('run_identity_invalid');
  if (!SESSION_KEY.test(input.identity.sessionKey)) {
    throw new Error('session_identity_invalid');
  }
  const cwd = fs.realpathSync.native(path.resolve(input.identity.cwd));
  if (cwd !== path.resolve(input.identity.cwd)) throw new Error('cwd_identity_mismatch');
  const rasenHome = fs.realpathSync.native(path.resolve(input.rasenHome));
  const registryPath = path.join(
    rasenHome,
    'runs',
    runDirectoryName(input.identity.runId),
    'sessions.json'
  );
  const { value: registry } = readBoundedJson(
    registryPath,
    MAX_REGISTRY_BYTES,
    'registry'
  );
  const session = exactRegistrySession(registry, { ...input.identity, cwd });
  const claudeSessionId = validateClaudeSessionId(session.claudeSessionId);
  if (
    input.expectedClaudeSessionId !== undefined
    && claudeSessionId !== input.expectedClaudeSessionId
  ) {
    throw new Error('claude_session_identity_changed');
  }
  const homeDir = path.resolve(input.claudeHome ?? os.homedir());
  const transcriptPath = path.join(
    claudeProjectsDirectory(cwd, homeDir),
    `${claudeSessionId}.jsonl`
  );
  const { stat, canonicalPath } = boundedRegularFile(
    transcriptPath,
    MAX_TRANSCRIPT_BYTES,
    'transcript'
  );
  return {
    runId: input.identity.runId,
    sessionKey: input.identity.sessionKey,
    cwd,
    claudeSessionId,
    transcriptPath: canonicalPath,
    transcriptFileIdentityFingerprint:
      transcriptFileIdentityFingerprint(stat),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function parseExactJsonLines(serialized, code) {
  if (!serialized.endsWith('\n')) throw new Error(`${code}_incomplete`);
  const entries = [];
  for (const line of serialized.split('\n')) {
    if (line.length === 0) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      throw new Error(`${code}_invalid_json`);
    }
  }
  return entries;
}

function exactTranscriptAppend(input) {
  const before = input.before;
  const after = captureExactTranscriptState({
    ...input,
    expectedClaudeSessionId: before.claudeSessionId,
  });
  if (
    before.runId !== after.runId
    || before.sessionKey !== after.sessionKey
    || before.cwd !== after.cwd
    || before.transcriptPath !== after.transcriptPath
    || before.transcriptFileIdentityFingerprint
      !== after.transcriptFileIdentityFingerprint
  ) {
    throw new Error('transcript_identity_changed');
  }
  if (after.size <= before.size) throw new Error('transcript_not_appended');
  const appendedBytes = after.size - before.size;
  if (appendedBytes > MAX_APPENDED_BYTES) {
    throw new Error('transcript_append_oversize');
  }
  const appended = readExactRange(after.transcriptPath, before.size, appendedBytes);
  const entries = parseExactJsonLines(appended, 'transcript_append');
  return {
    after,
    appended,
    entries,
    proof: {
      transcriptPathFingerprint: createHash('sha256')
        .update(after.transcriptPath, 'utf8')
        .digest('hex'),
      transcriptFileIdentityFingerprint:
        after.transcriptFileIdentityFingerprint,
      transcriptSizeBefore: before.size,
      transcriptSizeAfter: after.size,
      transcriptAppendedBytes: appendedBytes,
      transcriptAppendFingerprint: createHash('sha256')
        .update(appended, 'utf8')
        .digest('hex'),
    },
  };
}

function deduplicatedUsageRequests(entries) {
  const requests = [];
  const requestIndexes = new Map();
  let terminalAssistantRows = 0;
  for (const entry of entries) {
    const usage = usageFromEntry(entry);
    if (usage === null) continue;
    terminalAssistantRows += 1;
    const existingIndex = requestIndexes.get(usage.messageIdentity);
    if (existingIndex === undefined) {
      requestIndexes.set(usage.messageIdentity, requests.length);
      requests.push(usage);
    } else {
      const existing = requests[existingIndex];
      // Claude transcripts repeat a request once per content block. Preserve
      // the request's input counters and its final output ceiling.
      if (
        existing.counters.inputTokens !== usage.counters.inputTokens
        || existing.counters.cacheCreationInputTokens
          !== usage.counters.cacheCreationInputTokens
        || existing.counters.cacheReadInputTokens
          !== usage.counters.cacheReadInputTokens
      ) {
        throw new Error('transcript_usage_identity_drift');
      }
      const updated = {
        ...existing,
        counters: {
          ...existing.counters,
          outputTokens: Math.max(
            existing.counters.outputTokens,
            usage.counters.outputTokens
          ),
        },
      };
      requests[existingIndex] = updated;
    }
  }
  return { requests, terminalAssistantRows };
}

export function inspectExactTranscriptAppend(input) {
  const append = exactTranscriptAppend(input);
  const { requests, terminalAssistantRows } =
    deduplicatedUsageRequests(append.entries);
  // The cache boundary belongs to the first provider request entering this
  // wake. Later tool rounds may read a prefix that the first request just
  // rewrote and therefore cannot classify the idle boundary.
  const selected = requests[0] ?? null;
  if (selected === null) throw new Error('transcript_usage_missing');
  // Raw transcript rows and message identities remain process-local. Only the
  // four bounded integers cross the acceptance evidence boundary.
  return {
    counters: selected.counters,
    proof: {
      transcriptPathFingerprint: createHash('sha256')
        .update(append.after.transcriptPath, 'utf8')
        .digest('hex'),
      ...append.proof,
      terminalAssistantRows,
      distinctProviderRequests: requests.length,
    },
  };
}

function exactTimestamp(entry, code) {
  if (
    typeof entry?.timestamp !== 'string'
    || !Number.isFinite(new Date(entry.timestamp).valueOf())
  ) {
    throw new Error(`${code}_timestamp_invalid`);
  }
  return entry.timestamp;
}

function exactUserText(entry) {
  if (entry?.type !== 'user' || entry?.message?.role !== 'user') {
    throw new Error('scheduler_transcript_touch_user_missing');
  }
  const content = entry.message.content;
  if (typeof content === 'string') return content;
  if (
    Array.isArray(content)
    && content.length === 1
    && content[0]?.type === 'text'
    && typeof content[0].text === 'string'
  ) {
    return content[0].text;
  }
  throw new Error('scheduler_transcript_touch_user_invalid');
}

function schedulerTouchTextDigest(text) {
  const byteLength = Buffer.byteLength(text, 'utf8');
  return createHash('sha256')
    .update(`rasen-session-cache-touch-text/1\0${byteLength}:`, 'utf8')
    .update(text, 'utf8')
    .digest('hex');
}

export function inspectSchedulerTranscriptCausalAppend(input) {
  const append = exactTranscriptAppend(input);
  if (append.entries.length !== 3) {
    throw new Error('scheduler_transcript_unrelated_append');
  }
  const [user, assistant, result] = append.entries;
  const text = exactUserText(user);
  if (text !== SCHEDULER_TOUCH_MESSAGE) {
    throw new Error('scheduler_transcript_touch_text_mismatch');
  }
  const assistantUsage = usageFromEntry(assistant);
  if (assistantUsage === null) {
    throw new Error('scheduler_transcript_assistant_missing');
  }
  if (result?.type !== 'result') {
    throw new Error('scheduler_transcript_result_missing');
  }
  const claudeSessionId =
    result.session_id ?? result.sessionId;
  if (claudeSessionId !== input.expected.claudeSessionId) {
    throw new Error('scheduler_transcript_result_session_mismatch');
  }
  if (
    assistant.session_id !== undefined
    && assistant.session_id !== input.expected.claudeSessionId
  ) {
    throw new Error('scheduler_transcript_assistant_session_mismatch');
  }
  const transcriptTouchAt = exactTimestamp(
    user,
    'scheduler_transcript_touch'
  );
  const transcriptAssistantAt = exactTimestamp(
    assistant,
    'scheduler_transcript_assistant'
  );
  const transcriptResultAt = exactTimestamp(
    result,
    'scheduler_transcript_result'
  );
  const dispatch = new Date(input.expected.dispatchFenceAt).valueOf();
  const touch = new Date(transcriptTouchAt).valueOf();
  const assistantAt = new Date(transcriptAssistantAt).valueOf();
  const resultAt = new Date(transcriptResultAt).valueOf();
  const settled = new Date(input.expected.settledAt).valueOf();
  if (
    !Number.isFinite(dispatch)
    || !Number.isFinite(settled)
    || dispatch > touch
    || touch > assistantAt
    || assistantAt > resultAt
    || resultAt > settled
  ) {
    throw new Error('scheduler_transcript_causal_timing_invalid');
  }
  const transcriptResultDigest = createHash('sha256')
    .update(JSON.stringify(result), 'utf8')
    .digest('hex');
  if (transcriptResultDigest !== input.expected.resultDigest) {
    throw new Error('scheduler_transcript_result_digest_mismatch');
  }
  const transcriptTouchTextDigest = schedulerTouchTextDigest(text);
  const transcriptAssistantChainFingerprint = createHash('sha256')
    .update(JSON.stringify({
      claudeSessionIdDigest: createHash('sha256')
        .update(input.expected.claudeSessionId, 'utf8')
        .digest('hex'),
      transcriptTouchTextDigest,
      transcriptTouchAt,
      assistantMessageId: assistantUsage.messageIdentity,
      transcriptAssistantAt,
      transcriptResultDigest,
      transcriptResultAt,
    }), 'utf8')
    .digest('hex');
  return {
    counters: assistantUsage.counters,
    proof: {
      ...append.proof,
      terminalAssistantRows: 1,
      transcriptTouchTextDigest,
      transcriptAssistantChainFingerprint,
      transcriptResultDigest,
      transcriptTouchAt,
      transcriptAssistantAt,
      transcriptResultAt,
      claudeSessionIdDigest: createHash('sha256')
        .update(input.expected.claudeSessionId, 'utf8')
        .digest('hex'),
    },
  };
}

export function captureExactTranscriptBaseline(input) {
  const state = captureExactTranscriptState(input);
  return {
    claudeSessionId: state.claudeSessionId,
    transcriptPathFingerprint: transcriptPathFingerprint(state.transcriptPath),
    transcriptFileIdentityFingerprint:
      state.transcriptFileIdentityFingerprint,
    transcriptSize: state.size,
    transcriptPrefixFingerprint: exactRangeFingerprint(
      state.transcriptPath,
      0,
      state.size
    ),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export function captureExactTranscriptContextBaseline(input) {
  const state = captureExactTranscriptState(input);
  const serialized = readExactRange(state.transcriptPath, 0, state.size);
  const entries = parseExactJsonLines(
    serialized,
    'transcript_context_baseline'
  );
  const { requests } = deduplicatedUsageRequests(entries);
  const selected = requests.at(-1) ?? null;
  if (selected === null) {
    throw new Error('transcript_context_baseline_usage_missing');
  }
  const after = captureExactTranscriptState({
    ...input,
    expectedClaudeSessionId: state.claudeSessionId,
  });
  const serializedFingerprint = createHash('sha256')
    .update(serialized, 'utf8')
    .digest('hex');
  if (
    after.transcriptPath !== state.transcriptPath
    || after.transcriptFileIdentityFingerprint
      !== state.transcriptFileIdentityFingerprint
    || after.size !== state.size
    || exactRangeFingerprint(state.transcriptPath, 0, state.size)
      !== serializedFingerprint
  ) {
    throw new Error('transcript_context_baseline_changed');
  }
  const contextTokens = Object.values(selected.counters).reduce(
    (total, value) => total + value,
    0
  );
  if (!Number.isSafeInteger(contextTokens) || contextTokens <= 0) {
    throw new Error('transcript_context_baseline_invalid');
  }
  // Raw transcript rows, message identities, and individual bootstrap
  // counters remain process-local; only the bounded comparison scalar crosses
  // the acceptance evidence boundary.
  return { contextTokens };
}

export function restoreExactTranscriptBaseline(input) {
  const baseline = input.baseline;
  const current = captureExactTranscriptState({
    ...input,
    expectedClaudeSessionId: baseline.claudeSessionId,
  });
  if (
    transcriptPathFingerprint(current.transcriptPath)
      !== baseline.transcriptPathFingerprint
    || current.transcriptFileIdentityFingerprint
      !== baseline.transcriptFileIdentityFingerprint
    || current.size < baseline.transcriptSize
    || exactRangeFingerprint(
      current.transcriptPath,
      0,
      baseline.transcriptSize
    ) !== baseline.transcriptPrefixFingerprint
  ) {
    throw new Error('scheduler_transcript_baseline_drift');
  }
  return {
    ...current,
    size: baseline.transcriptSize,
    capturedAt: baseline.capturedAt,
  };
}

export function captureExactDurableSession(input) {
  if (!RUN_ID.test(input.identity.runId)) throw new Error('run_identity_invalid');
  if (!SESSION_KEY.test(input.identity.sessionKey)) {
    throw new Error('session_identity_invalid');
  }
  const cwd = fs.realpathSync.native(path.resolve(input.identity.cwd));
  if (cwd !== path.resolve(input.identity.cwd)) {
    throw new Error('cwd_identity_mismatch');
  }
  const rasenHome = fs.realpathSync.native(path.resolve(input.rasenHome));
  const registryPath = path.join(
    rasenHome,
    'runs',
    runDirectoryName(input.identity.runId),
    'sessions.json'
  );
  const { value: registry } = readBoundedJson(
    registryPath,
    MAX_REGISTRY_BYTES,
    'registry'
  );
  return structuredClone(
    exactRegistrySession(registry, { ...input.identity, cwd })
  );
}

export function extractExactAppendedUsage(input) {
  return inspectExactTranscriptAppend(input).counters;
}

export const transcriptUsageLimits = Object.freeze({
  maxRegistryBytes: MAX_REGISTRY_BYTES,
  maxTranscriptBytes: MAX_TRANSCRIPT_BYTES,
  maxAppendedBytes: MAX_APPENDED_BYTES,
});
