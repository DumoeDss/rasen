#!/usr/bin/env node
/**
 * rasen token audit — DEPRECATED thin wrapper.
 *
 * This script's logic has been productized as `rasen agent audit` (see
 * `src/core/token-audit/`, `src/commands/agent.ts`). This file now only
 * delegates to that command so existing direct invocations
 * (`node scripts/token-audit/audit.mjs <sessionId>`), including the ones
 * referenced by name in `rasen/office-hours/token-cost-audit.md` and this
 * directory's own README, keep working. See `README.md` for the full
 * migration note.
 *
 * `--pretty` (this script's old flag) has no equivalent on the new command
 * and is dropped with a warning; every other flag/arg passes through
 * unchanged, including `--runtime` for the new Codex-rollout support this
 * script never had.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rasenBin = path.join(__dirname, '..', '..', 'bin', 'rasen.js');

const rawArgs = process.argv.slice(2);
const args = [];
for (const a of rawArgs) {
  if (a === '--pretty') {
    console.error('scripts/token-audit/audit.mjs: --pretty has no equivalent on `rasen agent audit` and is ignored.');
    continue;
  }
  args.push(a);
}

console.error(
  'scripts/token-audit/audit.mjs is deprecated: this delegates to `rasen agent audit`. ' +
  'Run `rasen agent audit --help` (or the `/rasen-audit` skill) directly going forward.'
);

const result = spawnSync(process.execPath, [rasenBin, 'agent', 'audit', ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
