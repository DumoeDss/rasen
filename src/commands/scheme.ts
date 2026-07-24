import type { Command } from 'commander';

import {
  listThresholdSchemes,
  readThresholdScheme,
} from '../core/threshold-schemes.js';

export function registerSchemeCommand(program: Command): void {
  const scheme = program
    .command('scheme')
    .description('Inspect machine-level threshold schemes');

  scheme
    .command('list')
    .description('List threshold schemes')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const schemes = listThresholdSchemes();
      if (options.json) {
        console.log(JSON.stringify({ schemes }, null, 2));
        return;
      }
      if (schemes.length === 0) {
        console.log('No threshold schemes found.');
        return;
      }
      for (const entry of schemes) {
        if (entry.valid) {
          console.log(`${entry.name}  valid`);
        } else {
          console.log(`${entry.name}  invalid: ${entry.error}`);
        }
      }
    });

  scheme
    .command('show <name>')
    .description('Show one threshold scheme')
    .option('--json', 'Output as JSON')
    .action((name: string, options: { json?: boolean }) => {
      const definition = readThresholdScheme(name);
      const result = { name, ...definition };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Scheme: ${name}`);
      console.log(`handoff: ${JSON.stringify(definition.handoff)}`);
      if (definition.handoffRoles) {
        console.log(`handoffRoles: ${JSON.stringify(definition.handoffRoles)}`);
      }
      console.log(`reuse: ${JSON.stringify(definition.reuse)}`);
      if (definition.reuseRoles) {
        console.log(`reuseRoles: ${JSON.stringify(definition.reuseRoles)}`);
      }
    });
}
