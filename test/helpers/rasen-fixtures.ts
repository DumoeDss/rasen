import * as fs from 'node:fs';
import * as path from 'node:path';

/** Minimal healthy Rasen root layout shared by slice test suites. */
export function createOpenSpecRoot(rootDir: string): void {
  fs.mkdirSync(path.join(rootDir, 'rasen', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'rasen', 'changes', 'archive'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
}

/** Writes a spec file under the root's openspec/specs/<id>/spec.md. */
export function writeSpec(rootDir: string, specId: string, body: string): void {
  const specDir = path.join(rootDir, 'rasen', 'specs', specId);
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(path.join(specDir, 'spec.md'), body);
}

/**
 * Seeds an active Change directly into a LEGACY FLAT store's planning root.
 *
 * `rasen new change` can no longer produce one: a store that has not declared
 * planning layout version 2 refuses creation with
 * `legacy_flat_store_requires_migration` and names
 * `rasen store migrate-layout` (change `store-layout-v2-migration`,
 * `proposal.md` BREAKING bullet 2 and task 10b.1). Suites whose subject is
 * something OTHER than creation — reference indexing, root resolution, data
 * preservation — seed the Change here so they keep proving their own subject
 * rather than re-proving the refusal. A suite whose subject IS creation
 * asserts the refusal instead.
 */
export function seedFlatStoreChange(
  storeRoot: string,
  changeId: string,
  proposal = '## Why\n\nSeeded fixture.\n\n## What Changes\n\n- **fixture:** Seeded.\n'
): string {
  const changeDir = path.join(storeRoot, 'rasen', 'changes', changeId);
  fs.mkdirSync(changeDir, { recursive: true });
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), proposal);
  return changeDir;
}
