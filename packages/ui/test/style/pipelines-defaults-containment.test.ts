import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf-8');

function blockFor(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('Pipelines Defaults matrix containment', () => {
  it('contains the three-column table in a scoped horizontal scroller', () => {
    const scroller = blockFor('.defaults-matrix-scroll');
    expect(scroller).toMatch(/min-width:\s*0\b/);
    expect(scroller).toMatch(/max-width:\s*100%/);
    expect(scroller).toMatch(/overflow-x:\s*auto/);

    const matrix = blockFor('.defaults-matrix');
    expect(matrix).toMatch(/width:\s*100%/);
    expect(matrix).toMatch(/min-width:\s*480px/);
  });
});
