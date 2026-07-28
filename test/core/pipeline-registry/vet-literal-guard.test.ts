import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-tree guard for the retired `gate: 'vet'` type (design D1 / autopilot-
 * gate-policy). The legacy-coercion shim in the pipeline schema is the SINGLE
 * permitted site of the `'vet'` string literal in `src/`; every other occurrence
 * would silently keep the vet gate type alive (in code or in agent-facing
 * template prose). This test walks the whole source tree with Windows-safe
 * `path.join` and asserts the shim file is the sole match.
 */
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src');
const SHIM_FILE = path.join(SRC_ROOT, 'core', 'pipeline-registry', 'types.ts');
const VET_LITERAL = "'vet'";

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...collectTsFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('vet-literal guard (autopilot-gate-policy)', () => {
  it('the quoted vet literal appears only in the legacy-coercion shim file', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SRC_ROOT)) {
      if (path.resolve(file) === path.resolve(SHIM_FILE)) continue;
      if (readFileSync(file, 'utf-8').includes(VET_LITERAL)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the shim file still carries the coercion literal (the guard is live)', () => {
    expect(readFileSync(SHIM_FILE, 'utf-8')).toContain(VET_LITERAL);
  });
});
