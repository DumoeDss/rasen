// @vitest-environment jsdom
/**
 * Coverage for the telemetry payload disclosure (design D4, config-ui-package
 * spec): it renders beside the `telemetry.enabled` row on the Privacy tab and
 * nowhere else, lists exactly the five payload fields, states the global-only
 * scope and the env-override precedence, and issues no config write when opened
 * or closed. The field-list parity test pins the disclosed keys against a
 * fixture mirroring the CLI payload so the two cannot drift.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, listConfig: vi.fn(), putKey: vi.fn(), deleteKey: vi.fn() };
});

import { LocationProvider } from 'preact-iso';
import { ConfigPage } from '../../src/components/ConfigPage.js';
import {
  TELEMETRY_PAYLOAD_FIELDS,
  TelemetryDisclosure,
} from '../../src/components/TelemetryDisclosure.js';
import * as client from '../../src/api/client.js';
import { configListFixture } from '../fixtures/config-list.js';

// Mirror of the CLI telemetry payload keys sent by `trackCommand`
// (src/telemetry/index.ts): command, version, distinctId, os, node_version.
// If that payload changes, update BOTH this fixture and TELEMETRY_PAYLOAD_FIELDS.
const CLI_PAYLOAD_KEYS = ['command', 'version', 'distinctId', 'os', 'node_version'];

async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

async function mountAt(container: HTMLElement, path: string) {
  window.history.pushState({}, '', path);
  await act(async () => {
    render(
      <LocationProvider>
        <ConfigPage />
      </LocationProvider>,
      container
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function clickButton(container: HTMLElement, label: string) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button labelled "${label}"`);
  act(() => btn.click());
}

describe('TelemetryDisclosure parity', () => {
  it('discloses exactly the CLI payload keys, in order, with no drift in either direction', () => {
    const disclosed = TELEMETRY_PAYLOAD_FIELDS.map((f) => f.payloadKey);
    expect(disclosed).toEqual(CLI_PAYLOAD_KEYS);
    // Bidirectional: nothing disclosed that the CLI does not send, nothing sent
    // that the disclosure omits.
    expect(new Set(disclosed)).toEqual(new Set(CLI_PAYLOAD_KEYS));
    expect(disclosed).toHaveLength(5);
  });

  it('renders the five field labels plus the scope and env-override notes', () => {
    const container = document.createElement('div');
    act(() => render(<TelemetryDisclosure />, container));
    const text = container.textContent ?? '';
    expect(text).toContain('the command name');
    expect(text).toContain('the CLI version');
    expect(text).toContain('an anonymous randomly generated UUID');
    expect(text).toContain('the operating system platform');
    expect(text).toContain('the Node.js version');
    expect(text).toContain('global-only');
    expect(text).toContain('RASEN_TELEMETRY=0');
    expect(text).toContain('DO_NOT_TRACK=1');
    render(null, container);
  });
});

describe('TelemetryDisclosure on the Privacy tab', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.resetAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('renders beside the telemetry.enabled row and nowhere else', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');

    // telemetry.enabled is global-only: switch to Global mode, then Privacy tab.
    clickButton(container, 'Global');
    clickButton(container, 'Privacy');

    const disclosures = container.querySelectorAll('[data-testid="telemetry-disclosure"]');
    expect(disclosures).toHaveLength(1);

    // It sits in the same row wrapper as the telemetry.enabled entry.
    const wrapper = disclosures[0].parentElement!;
    expect(wrapper.textContent).toContain('telemetry.enabled');
  });

  it('keeps every config-entry a direct child of config-group — no interposed wrapper (M1 regression)', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');
    // Global mode surfaces the global-scoped rows (the fixture's keys); its
    // default tab holds several, so the structure check spans multiple rows.
    clickButton(container, 'Global');

    const assertDirectChildren = () => {
      const allRows = container.querySelectorAll('.config-entry');
      const directRows = container.querySelectorAll('.config-group > .config-entry');
      expect(allRows.length).toBeGreaterThan(0);
      // A wrapping <div> around each row would drop directRows below allRows and
      // re-trigger `.config-entry:first-of-type` on every row (the separator
      // regression that jsdom cannot see through computed styles).
      expect(directRows.length).toBe(allRows.length);
    };
    // The default Global tab (multiple rows).
    assertDirectChildren();

    // Privacy tab: the disclosure is a direct sibling inside the group, not a
    // wrapper interposed around the telemetry row.
    clickButton(container, 'Privacy');
    assertDirectChildren();
    const disclosure = container.querySelector('[data-testid="telemetry-disclosure"]')!;
    expect(disclosure.parentElement!.classList.contains('config-group')).toBe(true);
  });

  it('issues no config write when opened or closed', async () => {
    (client.listConfig as any).mockResolvedValue(configListFixture);
    await mountAt(container, '/p/proj_x/config');
    clickButton(container, 'Global');
    clickButton(container, 'Privacy');

    const summary = container.querySelector('.telemetry-disclosure__summary') as HTMLElement;
    act(() => summary.click());
    act(() => summary.click());

    expect(client.putKey).not.toHaveBeenCalled();
    expect(client.deleteKey).not.toHaveBeenCalled();
  });
});
