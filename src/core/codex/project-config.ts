/**
 * Project-local Codex multi-agent wait policy reconciler.
 *
 * Rasen's Codex orchestration uses one long, event-driven `wait_agent` call as a
 * dependency barrier. Codex's generic guidance discourages waits longer than 60
 * seconds, which produced repeated one-minute polls in live sessions. Raising the
 * `[features.multi_agent_v2]` wait bounds to one hour in the *project-local*
 * `.codex/config.toml` aligns Codex's tool schema so a single interruptible wait
 * returns the moment a worker posts activity — it never sleeps the full hour.
 *
 * Rasen owns ONLY these three fields under `[features.multi_agent_v2]`:
 *
 * ```toml
 * min_wait_timeout_ms = 3600000
 * default_wait_timeout_ms = 3600000
 * max_wait_timeout_ms = 3600000
 * ```
 *
 * Every other byte of `.codex/config.toml` (other tables, keys, comments,
 * ordering, newline style, the user's `multi_agent_mode_hint_text`, a leading
 * BOM) is preserved. Editing is surgical and AST-range-based so unrelated
 * content is never re-serialized. When the target structure cannot be edited
 * unambiguously the reconciler refuses (`blocked`) and leaves the file
 * byte-for-byte unchanged — it never guesses.
 *
 * The user's GLOBAL Codex config (`~/.codex/config.toml`) is never touched.
 */
import path from 'path';
import * as fs from 'fs/promises';
import { parseTOML, type AST } from 'toml-eslint-parser';

// -----------------------------------------------------------------------------
// Managed policy constants (single source of truth)
// -----------------------------------------------------------------------------

const CODEX_CONFIG_DIR = '.codex';
const CODEX_CONFIG_FILENAME = 'config.toml';

/** Dotted path of the owned table, as it appears in `[features.multi_agent_v2]`. */
const MANAGED_TABLE_PATH = ['features', 'multi_agent_v2'];

/** The only keys Rasen owns within the managed table. */
const MANAGED_FIELDS = [
  'min_wait_timeout_ms',
  'default_wait_timeout_ms',
  'max_wait_timeout_ms',
] as const;

/** The single value Rasen pins every managed field to (ms). */
const MANAGED_VALUE = 3600000;

const MANAGED_VALUE_TEXT = String(MANAGED_VALUE);

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/**
 * Read-only inspection of the project-local Codex policy.
 *
 * - `missing`  — `.codex/config.toml` does not exist.
 * - `current`  — file exists and all three managed fields are present and correct.
 * - `drifted`  — file exists but the managed table is absent or at least one
 *                managed field is missing or holds a non-policy value.
 * - `blocked`  — file exists but cannot be edited safely (invalid/unreadable
 *                TOML, duplicate or array-form target table, or the managed
 *                path is already defined via dotted/inline keys).
 */
export type CodexConfigInspection =
  | { status: 'missing' }
  | { status: 'current' }
  | { status: 'drifted' }
  | { status: 'blocked'; reason: string };

/** Outcome of a reconciliation attempt. */
export type CodexConfigOutcome =
  | 'unchanged'
  | 'created'
  | 'updated'
  | 'blocked'
  | 'failed';

export interface CodexConfigReconcileResult {
  /** Absolute path to the project-local `.codex/config.toml`. */
  configPath: string;
  /** What was found before any write. */
  inspection: CodexConfigInspection;
  /** What reconciliation did. */
  outcome: CodexConfigOutcome;
  /** Present for `blocked` / `failed`. */
  reason?: string;
  /** True when the policy became effective this run (created/updated) — callers
   * use this to advise a Codex restart. */
  needsRestart: boolean;
}

/** A single human-facing report line produced by {@link formatCodexConfigSummary}. */
export interface CodexConfigReportLine {
  tone: 'info' | 'warn' | 'error';
  text: string;
}

/**
 * Format a reconciliation result into report lines shared by `init` and
 * `update`. An unchanged policy produces no lines (no restart notice). A
 * created/updated policy yields an activation line plus a restart reminder.
 * Blocked/failed outcomes yield a single actionable line naming the path.
 */
export function formatCodexConfigSummary(result: CodexConfigReconcileResult): CodexConfigReportLine[] {
  const relPath = '.codex/config.toml';
  switch (result.outcome) {
    case 'created':
    case 'updated':
      return [
        { tone: 'info', text: `Codex config: wrote project wait policy (${relPath})` },
        { tone: 'info', text: 'Restart Codex for the one-hour wait bounds to take effect.' },
      ];
    case 'unchanged':
      return [];
    case 'blocked':
      return [
        {
          tone: 'warn',
          text: `Codex config: could not configure ${relPath} (${result.reason ?? 'structurally ambiguous'}). Edit it manually so [features.multi_agent_v2] sets the three wait timeouts to 3600000.`,
        },
      ];
    case 'failed':
      return [
        {
          tone: 'error',
          text: `Codex config: could not write ${relPath} (${result.reason ?? 'write failed'}). The file was left unchanged; rerun to retry.`,
        },
      ];
  }
}

// -----------------------------------------------------------------------------
// Path resolution
// -----------------------------------------------------------------------------

/** Absolute path to the project-local Codex config Rasen reconciles. */
export function resolveCodexConfigPath(projectRoot: string): string {
  return path.join(projectRoot, CODEX_CONFIG_DIR, CODEX_CONFIG_FILENAME);
}

// -----------------------------------------------------------------------------
// Inspection
// -----------------------------------------------------------------------------

/**
 * Read-only inspection of the project-local Codex policy. Never writes.
 */
export async function inspectCodexProjectConfig(
  projectRoot: string
): Promise<{ configPath: string; inspection: CodexConfigInspection }> {
  const configPath = resolveCodexConfigPath(projectRoot);
  if (!(await pathExists(configPath))) {
    return { configPath, inspection: { status: 'missing' } };
  }
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    return { configPath, inspection: { status: 'blocked', reason: 'file could not be read' } };
  }
  return { configPath, inspection: inspectSource(raw) };
}

/**
 * Inspect raw source text. Pure (no I/O) so it is exercised directly by the
 * focused unit suite and reused by reconciliation's pre-edit and post-edit
 * validation.
 */
function inspectSource(raw: string): CodexConfigInspection {
  // Strip a leading UTF-8 BOM so the parser is never fed one (it rejects it),
  // consistent with buildCandidate. Inspection is read-only, so no range
  // bookkeeping is needed.
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const parsed = tryParse(source);
  if (parsed === null) {
    return { status: 'blocked', reason: 'config is not valid TOML' };
  }
  const topBody = parsed.program.body[0].body;

  const managedTables = topBody.filter(isManagedTable);
  if (managedTables.length > 1) {
    return { status: 'blocked', reason: 'the [features.multi_agent_v2] table is defined more than once' };
  }
  if (managedTables.length === 1) {
    const table = managedTables[0];
    if (table.kind === 'array') {
      return { status: 'blocked', reason: '[features.multi_agent_v2] is an array-of-tables ([[...]]), which Rasen cannot own' };
    }
    return evaluateTable(table);
  }

  // No standard managed table. Refuse if the managed path is already defined
  // through top-level dotted keys or an inline table — inserting a `[features
  // .multi_agent_v2]` table would collide with it.
  if (topBody.some(hasManagedDottedKey)) {
    return { status: 'blocked', reason: 'features.multi_agent_v2 is already defined via dotted keys or an inline table' };
  }

  // File exists, parses, no managed table and no conflicting definition: the
  // managed policy is simply absent → drifted (will add the table).
  return { status: 'drifted' };
}

function evaluateTable(table: AST.TOMLTable): CodexConfigInspection {
  let allCorrect = true;
  for (const field of MANAGED_FIELDS) {
    const fieldKvs = table.body.filter((kv) => isSimpleKey(kv, field));
    if (fieldKvs.length > 1) {
      return { status: 'blocked', reason: `the managed key '${field}' is duplicated` };
    }
    if (fieldKvs.length === 0) {
      allCorrect = false;
      continue;
    }
    if (!isPolicyInteger(fieldKvs[0].value)) {
      allCorrect = false;
    }
  }
  return allCorrect ? { status: 'current' } : { status: 'drifted' };
}

function isPolicyInteger(value: AST.TOMLContentNode): boolean {
  return value.type === 'TOMLValue' && value.kind === 'integer' && value.value === MANAGED_VALUE;
}

// -----------------------------------------------------------------------------
// Reconciliation
// -----------------------------------------------------------------------------

/**
 * Reconcile the project-local Codex wait policy for `projectRoot`. Idempotent:
 * an already-current file is left untouched. Writes atomically through a
 * sibling temporary file and validates the candidate before committing.
 */
export async function reconcileCodexProjectConfig(
  projectRoot: string
): Promise<CodexConfigReconcileResult> {
  const configPath = resolveCodexConfigPath(projectRoot);

  // Missing file → create the directory tree and a minimal managed file.
  if (!(await pathExists(configPath))) {
    const created = await atomicWrite(configPath, buildManagedFile('\n'));
    return created
      ? { configPath, inspection: { status: 'missing' }, outcome: 'created', needsRestart: true }
      : { configPath, inspection: { status: 'missing' }, outcome: 'failed', reason: 'could not write .codex/config.toml', needsRestart: false };
  }

  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    const inspection: CodexConfigInspection = { status: 'blocked', reason: 'file could not be read' };
    return { configPath, inspection, outcome: 'blocked', reason: inspection.reason, needsRestart: false };
  }

  const inspection = inspectSource(raw);
  if (inspection.status === 'current') {
    return { configPath, inspection, outcome: 'unchanged', needsRestart: false };
  }
  if (inspection.status === 'blocked') {
    return { configPath, inspection, outcome: 'blocked', reason: inspection.reason, needsRestart: false };
  }

  // Drifted: build the lossless candidate.
  const candidate = buildCandidate(raw);
  if (candidate === null) {
    // inspectSource already validated parseability and structure, so a null
    // candidate here is an internal inconsistency — treat conservatively.
    return {
      configPath,
      inspection,
      outcome: 'blocked',
      reason: 'could not compute a safe edit for .codex/config.toml',
      needsRestart: false,
    };
  }

  // Validate the candidate before touching disk: it must still parse and the
  // managed values must resolve to the policy. If not, refuse.
  if (inspectSource(candidate).status !== 'current') {
    return {
      configPath,
      inspection,
      outcome: 'blocked',
      reason: 'the edited config did not validate as TOML or did not apply the policy',
      needsRestart: false,
    };
  }

  const written = await atomicWrite(configPath, candidate);
  return written
    ? { configPath, inspection, outcome: 'updated', needsRestart: true }
    : { configPath, inspection, outcome: 'failed', reason: 'could not write .codex/config.toml', needsRestart: false };
}

/**
 * Produce the reconciled source from `raw` without writing. Returns `null` only
 * if the structure cannot be edited safely (inspectSource would normally have
 * already returned `blocked` in that case).
 */
function buildCandidate(raw: string): string | null {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';

  // Preserve a leading BOM (if any) by parsing and splicing the BOM-stripped
  // body, then re-prepending the BOM. Keeps AST ranges aligned with the string
  // we slice.
  const bom = raw.charCodeAt(0) === 0xfeff ? '﻿' : '';
  const body = bom ? raw.slice(1) : raw;

  const parsed = tryParse(body);
  if (parsed === null) {
    return null;
  }
  const topBody = parsed.program.body[0].body;
  const managedTables = topBody.filter(isManagedTable);
  const standardTable = managedTables.find((t) => t.kind === 'standard');

  const edits: Array<{ start: number; end: number; text: string }> = [];

  if (standardTable) {
    // Replace wrong values in place; collect absent fields for one insertion.
    const missingFields: string[] = [];
    for (const field of MANAGED_FIELDS) {
      const kvs = standardTable.body.filter((kv) => isSimpleKey(kv, field));
      const kv = kvs[0];
      if (!kv) {
        missingFields.push(field);
        continue;
      }
      if (!isPolicyInteger(kv.value)) {
        // Splice only the value token, preserving the key, surrounding
        // whitespace, comments, and line structure.
        const [vStart, vEnd] = kv.value.range;
        edits.push({ start: vStart, end: vEnd, text: MANAGED_VALUE_TEXT });
      }
    }
    if (missingFields.length > 0) {
      const insertText = missingFields
        .map((field) => `${field} = ${MANAGED_VALUE_TEXT}`)
        .join(eol) + eol;
      const anchor = insertionAnchor(body, standardTable);
      edits.push({ start: anchor, end: anchor, text: insertText });
    }
  } else {
    // No standard managed table (and no conflicting definition, or we would
    // have blocked). Append the managed table at the end of the file content,
    // preserving trailing whitespace/newlines that already exist.
    const block = managedTableBlock(eol);
    const contentEnd = trailingWhitespaceStart(body);
    edits.push({ start: contentEnd, end: contentEnd, text: block });
  }

  const editedBody = applyEdits(body, edits);
  return bom + editedBody;
}

/**
 * Offset at which to insert new managed key/value lines inside an existing
 * table: the end of the line holding the table's last existing key (or the
 * header line itself when the table body is empty). Always lands on a line
 * boundary inside the table region, never splitting an existing value.
 */
function insertionAnchor(body: string, table: AST.TOMLTable): number {
  if (table.body.length > 0) {
    const lastKv = table.body[table.body.length - 1];
    return lineEndOffset(body, lastKv.range[1]);
  }
  // Empty table header `[features.multi_agent_v2]` — insert right after it.
  return lineEndOffset(body, table.range[0]);
}

/** Offset of the first trailing whitespace character (or body length). */
function trailingWhitespaceStart(body: string): number {
  let i = body.length;
  while (i > 0 && /\s/.test(body[i - 1])) {
    i--;
  }
  return i;
}

/** Index just past the newline ending the line that contains `offset`. */
function lineEndOffset(body: string, offset: number): number {
  const nl = body.indexOf('\n', offset);
  return nl === -1 ? body.length : nl + 1;
}

/** Apply non-overlapping edits to `source`, highest offset first. */
function applyEdits(
  source: string,
  edits: Array<{ start: number; end: number; text: string }>
): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const edit of sorted) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** The managed table block, headed by its own blank-line separation and the
 *  opening bracket, ending with the file's final newline. */
function managedTableBlock(eol: string): string {
  const fields = MANAGED_FIELDS.map((field) => `${field} = ${MANAGED_VALUE_TEXT}`).join(eol);
  // Lead with a blank line to separate from prior content; the caller's
  // trailing whitespace is preserved after the block.
  return `${eol}${eol}[features.multi_agent_v2]${eol}${fields}${eol}`;
}

/** A brand-new managed file (no prior content). */
function buildManagedFile(eol: string): string {
  const fields = MANAGED_FIELDS.map((field) => `${field} = ${MANAGED_VALUE_TEXT}`).join(eol);
  return `[features.multi_agent_v2]${eol}${fields}${eol}`;
}

// -----------------------------------------------------------------------------
// Atomic write
// -----------------------------------------------------------------------------

let tmpCounter = 0;

/**
 * Write `content` to `targetPath` through a sibling temporary file and atomically
 * rename it into place. Creates parent directories. Returns false (leaving any
 * existing destination untouched) on failure; the temporary file is cleaned up.
 */
async function atomicWrite(targetPath: string, content: string): Promise<boolean> {
  const dir = path.dirname(targetPath);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      return false;
    }
  }

  const tmpName = `.${path.basename(targetPath)}.${process.pid}.${process.hrtime.bigint().toString(36)}.${tmpCounter++}.tmp`;
  const tmpPath = path.join(dir, tmpName);

  try {
    const handle = await fs.open(tmpPath, 'w');
    try {
      await handle.writeFile(content);
      // fsync the data so a crash after rename does not leave an empty file.
      try {
        await handle.sync();
      } catch {
        // fsync is best-effort across platforms/filesystems.
      }
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, targetPath);
    return true;
  } catch {
    await fs.unlink(tmpPath).catch(() => undefined);
    return false;
  }
}

// -----------------------------------------------------------------------------
// TOML AST helpers
// -----------------------------------------------------------------------------

function tryParse(source: string): { program: AST.TOMLProgram } | null {
  try {
    const program = parseTOML(source);
    return { program };
  } catch {
    return null;
  }
}

/** True for a `TOMLTable` whose dotted path equals the managed table path.
 *  Array-of-tables (`[[...]]`) append a numeric index to `resolvedKey`, so
 *  numeric segments are ignored when comparing. */
function isManagedTable(node: AST.TOMLTopLevelTable['body'][number]): node is AST.TOMLTable {
  if (node.type !== 'TOMLTable') return false;
  const key = node.resolvedKey;
  if (!Array.isArray(key)) return false;
  const segments = key.filter((segment) => typeof segment !== 'number');
  if (segments.length !== MANAGED_TABLE_PATH.length) return false;
  return segments.every((segment, index) => String(segment) === MANAGED_TABLE_PATH[index]);
}

/**
 * True for a top-level key/value whose dotted path reaches INTO the managed
 * table (e.g. `features.multi_agent_v2.min_wait_timeout_ms = …` or
 * `features.multi_agent_v2 = { … }`). Such a definition conflicts with owning
 * the table directly, so we refuse rather than risk a collision.
 */
function hasManagedDottedKey(node: AST.TOMLTopLevelTable['body'][number]): boolean {
  if (node.type !== 'TOMLKeyValue') return false;
  const segments = keySegments(node.key);
  if (segments.length < MANAGED_TABLE_PATH.length) return false;
  return MANAGED_TABLE_PATH.every((segment, index) => segments[index] === segment);
}

/** True when `kv.key` is exactly the single (bare or quoted) key `name`. */
function isSimpleKey(kv: AST.TOMLKeyValue, name: string): boolean {
  const segments = keySegments(kv.key);
  return segments.length === 1 && segments[0] === name;
}

/** Dotted-key path segments of a `TOMLKey` as strings. */
function keySegments(key: AST.TOMLKey): string[] {
  return key.keys.map((part) => (part.type === 'TOMLBare' ? part.name : part.value));
}

// -----------------------------------------------------------------------------
// Filesystem helpers
// -----------------------------------------------------------------------------

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EEXIST'
  );
}
