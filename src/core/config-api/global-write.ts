/**
 * Minimal-diff global config write path for the HTTP API (design.md D3).
 *
 * The CLI's own `config set --scope global` persists the WHOLE
 * `getGlobalConfig()`-merged object (baked-in defaults included) — the MIN4
 * bug carried over from `unified-config-layer`: it flips never-set keys'
 * source annotation from `default` to `global`. This module instead reads
 * the RAW on-disk JSON (no default-merge), applies only the requested key
 * change, validates the result against `GlobalConfigSchema`, and writes back
 * the RAW edited object — never the zod-parsed result, which would
 * reintroduce the same bug by injecting `.default(...)` values for every
 * absent field the schema declares one for.
 */
import * as fs from 'node:fs';

import { GlobalConfigSchema, setNestedValue, deleteNestedValue } from '../config-schema.js';
import { getGlobalConfigDir, getGlobalConfigPath } from '../global-config.js';
import { formatZodIssues } from '../zod-issues.js';

export class GlobalConfigWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobalConfigWriteError';
  }
}

/**
 * Reads the raw global config file for the minimal-diff write path. Absent
 * file reads as `{}` (nothing set yet — a normal first write). An existing
 * but unparseable/non-object file MUST NOT read as `{}`: doing so would let
 * the write below silently replace a corrupt file with just the one target
 * key, destroying every other hand-edited value with no warning (B1 —
 * a real data-loss regression this function's whole job is to prevent).
 * Throws `GlobalConfigWriteError` instead, so the caller responds with an
 * error and never reaches `fs.writeFileSync`.
 */
function readRawGlobalConfigForWrite(): Record<string, unknown> {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) return {};

  const content = fs.readFileSync(configPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new GlobalConfigWriteError(
      `Global config file is not valid JSON; fix or remove it by hand: ${configPath} (${
        error instanceof Error ? error.message : String(error)
      })`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GlobalConfigWriteError(
      `Global config file does not contain a JSON object; fix or remove it by hand: ${configPath}`
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Sets (`value !== undefined`) or removes (`value === undefined`) one key in
 * the global config file, touching only that key. Throws
 * `GlobalConfigWriteError` (never writes) when the resulting object fails
 * `GlobalConfigSchema` validation. Callers MUST validate the key path and
 * value against the config-key registry BEFORE calling this — schema
 * validation here is the final backstop, not the primary gate (mirrors
 * `updateProjectConfigKey`'s contract).
 */
export function writeGlobalConfigKeyMinimalDiff(keyPath: string, value: unknown): void {
  const raw = readRawGlobalConfigForWrite();
  const next: Record<string, unknown> = JSON.parse(JSON.stringify(raw));

  if (value === undefined) {
    deleteNestedValue(next, keyPath);
  } else {
    setNestedValue(next, keyPath, value);
  }

  const result = GlobalConfigSchema.safeParse(next);
  if (!result.success) {
    throw new GlobalConfigWriteError(formatZodIssues(result.error));
  }

  const configDir = getGlobalConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  // Persist `next` (the raw edited object) — NOT `result.data` (the
  // zod-parsed object, which carries injected `.default(...)` values for
  // every field the schema declares one for). See module doc: this is the
  // whole point of this function existing.
  fs.writeFileSync(getGlobalConfigPath(), JSON.stringify(next, null, 2) + '\n', 'utf-8');
}
