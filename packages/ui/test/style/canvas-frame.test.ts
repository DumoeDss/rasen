/**
 * CSS contract pin for expandable frames (canvas-loop-body-visibility design
 * D1). jsdom performs no layout, so a class-presence test cannot catch this
 * class of bug: the frame card must FILL the React Flow wrapper (which
 * carries the frame box as inline width/height), and the tinted body
 * region's insets must mirror layout.ts's GROUP_LABEL_HEIGHT/GROUP_PADDING —
 * the same constants the frame box arithmetic uses — or the children the
 * dagre body pass placed land outside the visible region. The constants are
 * imported (not restated) so CSS and geometry cannot drift apart.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROUP_LABEL_HEIGHT, GROUP_PADDING } from '../../src/canvas/layout.js';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');

function blockFor(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `selector ${selector} present`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('expandable frame CSS contract (canvas-loop-body-visibility)', () => {
  it('the frame card fills the explicitly sized React Flow wrapper', () => {
    const block = blockFor('.stage-node--frame');
    expect(block).toMatch(/width:\s*100%/);
    expect(block).toMatch(/height:\s*100%/);
    // The compact card's fixed 200px must not bleed into the frame variant
    // (source order override — near-miss guard).
    expect(block).not.toMatch(/width:\s*200px/);
  });

  it('the header strip is exactly the label-strip height', () => {
    expect(blockFor('.stage-node__frame-header')).toMatch(
      new RegExp(`height:\\s*${GROUP_LABEL_HEIGHT}px`)
    );
  });

  it('the body region insets mirror the frame box constants', () => {
    const block = blockFor('.stage-node__frame-body');
    // Below the header strip plus its share of the padding.
    expect(block).toMatch(
      new RegExp(`top:\\s*${GROUP_LABEL_HEIGHT + GROUP_PADDING}px`)
    );
    expect(block).toMatch(new RegExp(`left:\\s*${GROUP_PADDING}px`));
    expect(block).toMatch(new RegExp(`right:\\s*${GROUP_PADDING}px`));
    expect(block).toMatch(new RegExp(`bottom:\\s*${GROUP_PADDING}px`));
  });

  it('the chevron is a plain button that never starts a drag', () => {
    // The class rides the markup (`nodrag` — React Flow ignores pointerdown
    // there); the CSS pin covers the click affordance itself.
    expect(blockFor('.stage-node__frame-toggle')).toMatch(/cursor:\s*pointer/);
  });
});
