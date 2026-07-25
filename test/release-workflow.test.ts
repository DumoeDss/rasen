import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

describe('paired release workflow', () => {
  it('builds, tests, packs, and uploads both packages with curated notes', () => {
    expect(workflow).toContain("pnpm --dir packages/ui install --frozen-lockfile");
    expect(workflow).toContain("node scripts/release-contract.mjs");
    expect(workflow).toContain("pnpm --dir packages/ui typecheck");
    expect(workflow).toContain("pnpm --dir packages/ui test");
    expect(workflow).toContain("pnpm --dir packages/ui build");
    expect(workflow).toContain("working-directory: packages/ui");
    expect(workflow).toContain("body_path:");
    expect(workflow).toContain("*.tgz");
  });

  it('gates one CLI-then-UI publication job on NPM_TOKEN', () => {
    expect(workflow).toContain("name: Publish CLI and UI to npm");
    expect(workflow).toContain("npm publish --provenance --access public");
    expect(workflow).toContain("name: Publish UI package");
    expect(workflow).toContain("working-directory: packages/ui");
    expect(workflow.match(/npm publish --provenance --access public/g)).toHaveLength(2);
    expect(workflow).toContain("NPM_TOKEN");
    expect(workflow).toContain("both @atelierai/rasen and @atelierai/rasen-ui");
  });

  it('keeps site notification dependent only on GitHub Release creation', () => {
    const notifyStart = workflow.indexOf('  notify-site:');
    const publishStart = workflow.indexOf('  publish-npm:');
    expect(notifyStart).toBeGreaterThan(0);
    expect(publishStart).toBeGreaterThan(notifyStart);
    const notifyBlock = workflow.slice(notifyStart, publishStart);
    expect(notifyBlock).toContain('needs: release');
    expect(notifyBlock).not.toContain('publish-npm');
  });
});
