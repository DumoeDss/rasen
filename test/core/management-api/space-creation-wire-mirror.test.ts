import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

const CORE_TYPES = path.join(process.cwd(), 'src/core/management-api/wire-types.ts');
const UI_TYPES = path.join(process.cwd(), 'packages/ui/src/api/types.ts');

function declaration(source: string, name: string): string {
  const start = source.indexOf(`export type ${name} =`);
  if (start < 0) throw new Error(`${name} is not exported`);
  const end = source.indexOf(';', start);
  if (end < 0) throw new Error(`${name} has no terminating semicolon`);
  return source.slice(start, end + 1).replace(/\s+/gu, ' ').trim();
}

describe('space mutation wire types keep the UI mirror exact', () => {
  const core = fs.readFileSync(CORE_TYPES, 'utf8');
  const ui = fs.readFileSync(UI_TYPES, 'utf8');

  it.each(['CreateSpaceRequest', 'CreateSpaceResponse', 'AddProjectToStoreResponse'])(
    '%s has the same declaration on both sides',
    (name) => {
      expect(declaration(ui, name)).toBe(declaration(core, name));
    }
  );
});
