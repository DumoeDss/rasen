import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { pages } from '../docs.sync.config.mjs';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(websiteRoot, '..');
const generatedDocsRoot = join(websiteRoot, 'content', 'docs');

test('publishes workflow package links from CLI and glossary on the website', () => {
  const route = '/docs/reference/workflow-packages';
  const page = pages.find(({ source }) => source === 'workflow-packages.md');
  assert.equal(page?.slug, 'reference/workflow-packages');

  const secondaryManifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'docs', 'website-manifest.json'), 'utf8'),
  );
  const secondaryPage = secondaryManifest.sections
    .flatMap(({ pages: sectionPages }) => sectionPages)
    .find(({ source }) => source === 'workflow-packages.md');
  assert.equal(secondaryPage?.slug, page.slug);

  execFileSync(process.execPath, [join(websiteRoot, 'scripts', 'sync-docs.mjs')], {
    cwd: websiteRoot,
    stdio: 'pipe',
  });

  assert.match(
    readFileSync(join(generatedDocsRoot, 'reference', 'workflow-packages.md'), 'utf8'),
    /githubSource: "docs\/workflow-packages\.md"/,
  );
  for (const generatedPage of ['reference/cli.md', 'glossary.md']) {
    const markdown = readFileSync(join(generatedDocsRoot, generatedPage), 'utf8');
    assert.ok(markdown.includes(`](${route})`));
    assert.doesNotMatch(markdown, /\]\(workflow-packages\.md\)/);
  }

  const index = readFileSync(join(generatedDocsRoot, 'index.md'), 'utf8');
  assert.match(
    index,
    /https:\/\/github\.com\/DumoeDss\/rasen\/blob\/main\/docs\/autopilot\.md/,
  );
});
