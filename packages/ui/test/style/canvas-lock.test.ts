/**
 * CSS contract pin for the canvas viewport lock (ui-profile-workflow-split
 * design D8). jsdom performs no layout, so the class-presence test in
 * pipelines-page.test.tsx cannot catch this class of bug — that is exactly how
 * the previous (dead-code) fix slipped through. This narrow string-level pin
 * asserts the root-cause fix survives refactors: the definite height lives on
 * the shell, the content flexes with `min-height: 0`, and the old
 * `calc(100vh …)` (which does not constrain a flexed main size) never returns.
 * A real-browser measurement (tasks.md 5.4) covers actual layout.
 */
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

describe('canvas viewport-lock CSS contract (design D8)', () => {
  it('gives the shell a definite height on the canvas route', () => {
    expect(blockFor('.app-shell--canvas')).toMatch(/height:\s*100vh/);
  });

  it('flexes the canvas content with a zero min-height and no dead calc height', () => {
    const block = blockFor('.app-content--canvas');
    expect(block).toMatch(/min-height:\s*0/);
    expect(block).toMatch(/overflow:\s*hidden/);
    expect(block).toMatch(/flex:\s*1/);
    // The broken pattern must not return: a `height: calc(100vh …)` on this
    // flex item does not constrain its flexed main size (root cause, D8).
    expect(block).not.toContain('calc(100vh');
  });

  it('keeps the base shell at min-height: 100vh so other routes scroll normally', () => {
    expect(blockFor('.app-shell')).toMatch(/min-height:\s*100vh/);
  });
});
