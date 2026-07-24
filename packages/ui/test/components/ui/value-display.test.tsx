// @vitest-environment jsdom
/**
 * ValueDisplay / ValueSummary (config-ui-package spec): arrays render as chips
 * (collapsed with a disclosure past ~8 items), objects as labeled fields,
 * primitives/null as text — never a raw JSON string.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ValueDisplay, ValueSummary } from '../../../src/components/ui/ValueDisplay.js';

describe('ValueDisplay', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('renders a short array as individual chips, not a JSON string', () => {
    render(<ValueDisplay value={['propose', 'explore', 'apply']} />, container);
    const chips = Array.from(container.querySelectorAll('.value-display__chip'));
    expect(chips.map((c) => c.textContent)).toEqual(['propose', 'explore', 'apply']);
    expect(container.textContent).not.toContain('["');
    expect(container.querySelector('[data-testid="value-display-toggle"]')).toBeNull();
  });

  it('collapses a long array behind a count + Show all disclosure', async () => {
    const items = Array.from({ length: 12 }, (_, i) => `w${i}`);
    render(<ValueDisplay value={items} />, container);
    // Collapsed: only the first 8 chips render.
    expect(container.querySelectorAll('.value-display__chip').length).toBe(8);
    const toggle = container.querySelector('[data-testid="value-display-toggle"]')!;
    expect(toggle.textContent).toContain('12 items');
    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });
    expect(container.querySelectorAll('.value-display__chip').length).toBe(12);
  });

  it('renders a plain object as labeled key/value fields', () => {
    render(<ValueDisplay value={{ remainingTokens: 50000 }} />, container);
    const field = container.querySelector('.value-display__field')!;
    expect(field.querySelector('.value-display__field-key')!.textContent).toBe('remainingTokens');
    expect(field.querySelector('.value-display__field-value')!.textContent).toBe('50000');
    expect(container.textContent).not.toContain('{"');
  });

  it('renders null as "not set"', () => {
    render(<ValueDisplay value={null} />, container);
    expect(container.querySelector('.value-display--empty')!.textContent).toBe('not set');
  });

  it('ValueSummary shows an array as a count, expandable on demand', async () => {
    render(<ValueSummary value={['a', 'b', 'c']} />, container);
    const toggle = container.querySelector('[data-testid="value-summary-toggle"]')!;
    expect(toggle.textContent).toContain('3 items');
    expect(container.querySelectorAll('.value-display__chip').length).toBe(0);
    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });
    expect(container.querySelectorAll('.value-display__chip').length).toBe(3);
  });

  it('ValueSummary renders a primitive inline as text', () => {
    render(<ValueSummary value="claude-opus" />, container);
    expect(container.querySelector('.value-display--primitive')!.textContent).toBe('claude-opus');
  });
});
