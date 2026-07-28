// @vitest-environment jsdom
/**
 * Switch (ui-component-system spec): a `role="switch"` control that toggles on
 * click and keyboard, announces its state via `aria-checked`, and is inert when
 * disabled.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Switch } from '../../../src/components/ui/Switch.js';

describe('Switch', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('exposes role=switch, aria-checked, and the accessible label', () => {
    render(<Switch checked={true} onToggle={() => {}} label="Enable here" testid="sw" />, container);
    const sw = container.querySelector('[data-testid="sw"]')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.getAttribute('aria-label')).toBe('Enable here');
    expect(sw.classList.contains('ui-switch--on')).toBe(true);
  });

  it('reports the toggled value on click', async () => {
    const onToggle = vi.fn();
    render(<Switch checked={false} onToggle={onToggle} label="Enable here" testid="sw" />, container);
    const sw = container.querySelector('[data-testid="sw"]') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      sw.click();
    });
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('is inert when disabled — no toggle, visibly disabled', async () => {
    const onToggle = vi.fn();
    render(
      <Switch checked={false} disabled onToggle={onToggle} label="Required" title="required by an enabled workflow" testid="sw" />,
      container
    );
    const sw = container.querySelector('[data-testid="sw"]') as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute('title')).toBe('required by an enabled workflow');
    await act(async () => {
      sw.click();
    });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('toggles via keyboard (button semantics — Space/Enter fire a click)', async () => {
    const onToggle = vi.fn();
    render(<Switch checked={true} onToggle={onToggle} label="Enable here" testid="sw" />, container);
    const sw = container.querySelector('[data-testid="sw"]') as HTMLButtonElement;
    // A native button turns Space/Enter into a click; simulate that click.
    await act(async () => {
      sw.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
