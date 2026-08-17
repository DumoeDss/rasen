/**
 * CSS contract pin for the v2 authoring column (canvas-authoring-surface
 * design D1/D8). jsdom performs no layout, so a markup-only assertion cannot
 * catch a width/flex regression here — the established answer (see the
 * sibling `canvas-lock.test.ts`) is this narrow string-level pin plus a
 * real-browser measurement (tasks.md 10.4). This file only pins the
 * declarations that make the column a fixed-width, independently scrolling
 * rail rather than an unconstrained flex item.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf-8');

/**
 * Finds the declaration block for a rule whose selector list contains
 * `selector` as one of its (possibly comma-separated) entries, and returns
 * the block body. Unlike a plain `${selector} {` search, this matches rules
 * that share a block with other selectors, e.g. `.a,\n.b { ... }`.
 */
function blockForSelectorAmong(selector: string): string {
  const selectorLine = new RegExp(
    `(^|[,\\n])\\s*${selector.replace(/[.]/g, '\\.')}\\s*[,{]`,
    'm'
  );
  const match = selectorLine.exec(css);
  expect(match, `selector ${selector} present`).not.toBeNull();
  const matchIndex = match!.index;
  const open = css.indexOf('{', matchIndex);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/**
 * One declaration, anchored on BOTH ends: the property name may not be the
 * tail of a longer property, and the value may not be the head of a longer
 * value.
 *
 * Both halves are load-bearing, and each closes a hole a bare substring pin
 * leaves open — the "rule exists but does not constrain" failure this whole
 * file exists to catch:
 *
 * - `/width:\s*280px/` also matches `min-width: 280px` and `max-width: 280px`,
 *   which restore exactly the content-driven sizing this change removes;
 * - `/flex-shrink:\s*0/` also matches `flex-shrink: 0.5`, which shrinks;
 * - `/flex-direction:\s*column/` also matches `column-reverse`.
 */
function declares(property: string, value: string): RegExp {
  const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(^|[;{])\\s*${literal(property)}\\s*:\\s*${literal(value)}\\s*(;|$)`,
    'm'
  );
}

describe('v2 authoring column CSS contract (design D1/D8)', () => {
  it('gives the authoring column a definite width, no shrink, and its own scroll', () => {
    const block = blockForSelectorAmong('.pipeline-canvas__authoring-contracts');
    expect(block).toMatch(declares('width', '280px'));
    expect(block).toMatch(declares('flex-shrink', '0'));
    expect(block).toMatch(declares('overflow-y', 'auto'));
  });

  it('lays out the definition contract and declarations panel cards as a column', () => {
    expect(blockForSelectorAmong('.definition-contract')).toMatch(
      declares('flex-direction', 'column')
    );
    expect(blockForSelectorAmong('.declarations-panel')).toMatch(
      declares('flex-direction', 'column')
    );
  });

  it('renders the toast above the review dialogs scrim (a refusal while a modal is open stays visible)', () => {
    // canvas-root-contract-editor review m1: the loop review's inline-declare
    // refusal (and any review-time refusal toast) fired while the fixed
    // `.pipeline-canvas__dialog-overlay` (z-index 20) was open rendered
    // UNDER the scrim. The toast must sit above it. jsdom does no painting,
    // so this is the string-level property+value pin; the stacking claim
    // (no ancestor between the two creates a stacking context) is why the
    // z-index comparison is direct.
    expect(blockForSelectorAmong('.pipeline-canvas__toast')).toMatch(
      declares('z-index', '30')
    );
    expect(blockForSelectorAmong('.pipeline-canvas__dialog-overlay')).toMatch(
      declares('z-index', '20')
    );
  });

  it('the property/value anchoring itself rejects the near-misses it exists to catch', () => {
    // Guarding the guard. Without this, a future refactor of `declares()` back
    // to a substring match would leave every pin above green while silently
    // re-opening the regression — the failure mode this repo keeps paying for.
    for (const nearMiss of [
      '  min-width: 280px; flex-shrink: 0;',
      '  max-width: 280px;',
    ]) {
      expect(nearMiss).not.toMatch(declares('width', '280px'));
    }
    expect('  flex-shrink: 0.5;').not.toMatch(declares('flex-shrink', '0'));
    expect('  flex-direction: column-reverse;').not.toMatch(
      declares('flex-direction', 'column')
    );
    // ...and still matches the real declarations, in both the
    // first-in-block and mid-line positions the stylesheet actually uses.
    expect('\n  width: 280px; flex-shrink: 0;').toMatch(declares('width', '280px'));
    expect('\n  width: 280px; flex-shrink: 0;').toMatch(declares('flex-shrink', '0'));
  });
});
