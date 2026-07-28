// @vitest-environment jsdom
/**
 * The re-launch notice must point at `rasen ui` (design D4 of
 * `rasen-ui-unify-management-surface`) now that it is the platform entry
 * point, not `rasen config ui`.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RelaunchNotice } from '../../src/components/RelaunchNotice.js';

describe('RelaunchNotice', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('names `rasen ui` as the re-launch command', async () => {
    await act(async () => {
      render(<RelaunchNotice />, container);
    });
    expect(container.textContent).toContain('rasen ui');
    expect(container.textContent).not.toContain('rasen config ui');
  });
});
