// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, putKey: vi.fn(), deleteKey: vi.fn() };
});

import { KeepaliveBeatControl } from '../../src/components/KeepaliveBeatControl.js';
import * as client from '../../src/api/client.js';
import type { ConfigScope, WireConfigEntry } from '../../src/api/types.js';
import type { ConfigMode, SpaceType } from '../../src/config/controls.js';

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function enabledEntry(
  value: boolean,
  source: WireConfigEntry['source'] = 'default',
  scopeValues: WireConfigEntry['scopeValues'] = {}
): WireConfigEntry {
  return {
    definition: {
      key: 'keepalive.enabled',
      scopes: ['global', 'project'],
      type: 'boolean',
      defaultValue: true,
      description: 'enable keepalive',
      group: 'Pipelines',
      constraints: { type: 'boolean' },
    },
    value,
    source,
    scopeValues,
  };
}

function beatEntry(
  value: number,
  source: WireConfigEntry['source'] = 'default',
  scopeValues: WireConfigEntry['scopeValues'] = {}
): WireConfigEntry {
  return {
    definition: {
      key: 'keepalive.beatSeconds',
      scopes: ['global', 'project'],
      type: 'number',
      defaultValue: 270,
      description: 'beat length',
      group: 'Pipelines',
      constraints: { type: 'number', range: { gt: 89, lte: 280 } },
    },
    value,
    source,
    scopeValues,
  };
}

describe('KeepaliveBeatControl', () => {
  let container: HTMLElement;

  function mount(options: {
    enabled?: WireConfigEntry;
    beat?: WireConfigEntry;
    mode?: ConfigMode;
    spaceType?: SpaceType;
    onEntryUpdated?: (entry: WireConfigEntry) => void;
  } = {}): void {
    act(() => {
      render(
        <KeepaliveBeatControl
          enabledEntry={options.enabled ?? enabledEntry(true)}
          beatEntry={options.beat ?? beatEntry(270)}
          mode={options.mode ?? 'global'}
          spaceType={options.spaceType ?? 'project'}
          selector="project:proj_x"
          storeRef={null}
          onPageError={() => {}}
          onEntryUpdated={options.onEntryUpdated ?? (() => {})}
        />,
        container
      );
    });
  }

  async function click(el: Element | null): Promise<void> {
    await act(async () => {
      (el as HTMLElement).click();
      await flush();
    });
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.putKey as any).mockImplementation(
      async (key: string, body: { scope: ConfigScope; value: unknown }) => ({
        entry:
          key === 'keepalive.enabled'
            ? enabledEntry(body.value as boolean, body.scope, { [body.scope]: body.value })
            : beatEntry(body.value as number, body.scope, { [body.scope]: body.value }),
        store: null,
      })
    );
    (client.deleteKey as any).mockImplementation(async (key: string) => ({
      entry: key === 'keepalive.enabled' ? enabledEntry(true) : beatEntry(270),
      store: null,
    }));
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.resetAllMocks();
  });

  it('renders the effective enabled state, source, and accessible switch name', () => {
    mount({ enabled: enabledEntry(false, 'global', { global: false }), beat: beatEntry(180, 'global') });

    const toggle = container.querySelector('[data-testid="keepalive-enabled-toggle"]')!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Enable parked-worker keepalive');
    expect(toggle.textContent).toBe('Off');
    expect(container.querySelector('[data-testid="keepalive-enabled-source"]')!.textContent).toBe('global');
    expect((container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement).value).toBe('180');
  });

  it('writes only keepalive.enabled at global scope and preserves the retained beat value', async () => {
    mount({ enabled: enabledEntry(true), beat: beatEntry(180, 'global', { global: 180 }) });
    await click(container.querySelector('[data-testid="keepalive-enabled-toggle"]'));

    expect(client.putKey).toHaveBeenCalledWith(
      'keepalive.enabled',
      { scope: 'global', value: false },
      'project:proj_x'
    );
    expect(client.putKey).not.toHaveBeenCalledWith(
      'keepalive.beatSeconds',
      expect.anything(),
      expect.anything()
    );
    expect((container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement).value).toBe('180');
  });

  it('writes and unsets the switch at project scope without offering reset for an inherited value', async () => {
    mount({
      enabled: enabledEntry(false, 'global', { global: false }),
      mode: 'local',
      spaceType: 'project',
    });
    expect(container.querySelector('[data-testid="keepalive-enabled-unset"]')).toBeNull();
    await click(container.querySelector('[data-testid="keepalive-enabled-toggle"]'));
    expect(client.putKey).toHaveBeenCalledWith(
      'keepalive.enabled',
      { scope: 'project', value: true },
      'project:proj_x'
    );

    mount({
      enabled: enabledEntry(true, 'project', { global: false, project: true }),
      mode: 'local',
      spaceType: 'project',
    });
    await click(container.querySelector('[data-testid="keepalive-enabled-unset"]'));
    expect(client.deleteKey).toHaveBeenCalledWith('keepalive.enabled', 'project', 'project:proj_x');
  });

  it('reflects the effective beat in preset selection and writes a bounded custom value', async () => {
    mount();
    expect(container.querySelector('[data-testid="keepalive-preset-economy"]')!.getAttribute('aria-pressed')).toBe(
      'true'
    );

    const input = container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement;
    await act(async () => {
      input.value = '180';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    expect(container.querySelector('[data-testid="keepalive-timeout-hint"]')!.textContent).toContain('230');
    await click(container.querySelector('[data-testid="keepalive-custom-set"]'));
    expect(client.putKey).toHaveBeenCalledWith(
      'keepalive.beatSeconds',
      { scope: 'global', value: 180 },
      'project:proj_x'
    );
  });

  it('rejects an out-of-range custom value client-side without writing', async () => {
    mount();
    const input = container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement;
    await act(async () => {
      input.value = '300';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    await click(container.querySelector('[data-testid="keepalive-custom-set"]'));
    expect(container.querySelector('[data-testid="keepalive-error"]')!.textContent).toContain('90');
    expect(client.putKey).not.toHaveBeenCalled();
  });

  it('unsets beatSeconds only when the active scope has a value', async () => {
    mount({ beat: beatEntry(100, 'global', { global: 100 }) });
    await click(container.querySelector('[data-testid="keepalive-unset"]'));
    expect(client.deleteKey).toHaveBeenCalledWith('keepalive.beatSeconds', 'global', 'project:proj_x');

    mount({ beat: beatEntry(100, 'global', { global: 100 }), mode: 'local' });
    expect(container.querySelector('[data-testid="keepalive-unset"]')).toBeNull();
  });
});
