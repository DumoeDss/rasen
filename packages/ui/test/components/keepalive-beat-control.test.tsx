// @vitest-environment jsdom
/**
 * Component coverage for the Keepalive beat control (pipelines-ui spec): preset
 * writes (fast 100 / economy 270), a bounded custom write, client-side
 * out-of-range rejection, the derived tool-timeout hint (beat + 50s), and the
 * effective-value-driven selection state. Writes ride the ordinary config API
 * (`putKey`/`deleteKey`) exactly like the autopilot Defaults rows.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, putKey: vi.fn(), deleteKey: vi.fn() };
});

import { KeepaliveBeatControl } from '../../src/components/KeepaliveBeatControl.js';
import * as client from '../../src/api/client.js';
import type { WireConfigEntry } from '../../src/api/types.js';

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function entryFor(value: number, source: WireConfigEntry['source'] = 'default'): WireConfigEntry {
  return {
    definition: {
      key: 'keepalive.beatSeconds',
      scopes: ['global'],
      type: 'number',
      defaultValue: 270,
      description: 'beat length',
      group: 'Pipelines',
      constraints: { type: 'number', range: { gt: 89, lte: 280 } },
    },
    value,
    source,
    scopeValues: {},
  };
}

describe('KeepaliveBeatControl', () => {
  let container: HTMLElement;
  let updated: WireConfigEntry | null;

  function mount(entry: WireConfigEntry): void {
    updated = null;
    act(() => {
      render(
        <KeepaliveBeatControl
          entry={entry}
          mode="global"
          spaceType="project"
          selector="project:proj_x"
          storeRef={null}
          onPageError={() => {}}
          onEntryUpdated={(e) => {
            updated = e;
          }}
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
    (client.putKey as any).mockImplementation(async (_k: string, body: { value: number }) => ({
      entry: entryFor(body.value, 'global'),
      store: null,
    }));
    (client.deleteKey as any).mockResolvedValue({ entry: entryFor(270, 'default'), store: null });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.resetAllMocks();
  });

  it('reflects the effective value in the preset selection state', () => {
    mount(entryFor(270));
    expect(container.querySelector('[data-testid="keepalive-preset-economy"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="keepalive-preset-fast"]')!.getAttribute('aria-pressed')).toBe('false');

    mount(entryFor(100, 'global'));
    expect(container.querySelector('[data-testid="keepalive-preset-fast"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="keepalive-preset-economy"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('writes the fast preset (100) at the global scope', async () => {
    mount(entryFor(270));
    await click(container.querySelector('[data-testid="keepalive-preset-fast"]'));
    expect(client.putKey).toHaveBeenCalledWith('keepalive.beatSeconds', { scope: 'global', value: 100 }, 'project:proj_x');
    expect(updated!.value).toBe(100);
  });

  it('writes a bounded custom value and derives the tool-timeout hint (beat + 50)', async () => {
    mount(entryFor(270));
    const input = container.querySelector('[data-testid="keepalive-custom-input"]') as HTMLInputElement;
    await act(async () => {
      input.value = '180';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    // Hint tracks the live edit before commit.
    expect(container.querySelector('[data-testid="keepalive-timeout-hint"]')!.textContent).toContain('230');
    await click(container.querySelector('[data-testid="keepalive-custom-set"]'));
    expect(client.putKey).toHaveBeenCalledWith('keepalive.beatSeconds', { scope: 'global', value: 180 }, 'project:proj_x');
  });

  it('rejects an out-of-range custom value client-side without writing', async () => {
    mount(entryFor(270));
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

  it('offers a reset-to-default only when the value is not the registry default, and unsets through the API', async () => {
    mount(entryFor(270, 'default'));
    expect(container.querySelector('[data-testid="keepalive-unset"]')).toBeNull();

    mount(entryFor(100, 'global'));
    await click(container.querySelector('[data-testid="keepalive-unset"]'));
    expect(client.deleteKey).toHaveBeenCalledWith('keepalive.beatSeconds', 'global', 'project:proj_x');
  });
});
