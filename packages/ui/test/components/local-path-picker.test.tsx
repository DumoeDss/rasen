// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useRef, useState } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listLocalPaths: vi.fn(),
    resolveLocalPath: vi.fn(),
    chooseLocalPath: vi.fn(),
  };
});

import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { LocalPathPicker } from '../../src/components/LocalPathPicker.js';
import type { LocalPathSelectionController } from '../../src/store/use-local-path-selection.js';

const HOME = {
  path: '/home/user',
  parent: null,
  separator: '/',
  home: true,
  entries: [
    { name: 'draft', isDir: true, isGitRepo: true },
    { name: 'flow.rasenpkg', isDir: false, isGitRepo: false },
  ],
};

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function Harness({ mode = 'file-or-dir' }: { mode?: 'dir' | 'file-or-dir' | 'file' }) {
  const picker = useRef<LocalPathSelectionController | null>(null);
  const [submitted, setSubmitted] = useState('');
  return (
    <>
      <LocalPathPicker
        classPrefix="local-path-picker"
        mode={mode}
        controllerRef={picker}
      />
      <button
        type="button"
        data-testid="host-submit"
        onClick={async () => setSubmitted((await picker.current?.resolveForSubmit()) ?? '')}
      >
        Submit
      </button>
      <output data-testid="submitted">{submitted}</output>
    </>
  );
}

describe('LocalPathPicker authoritative selection', () => {
  let container: HTMLElement;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listLocalPaths as any).mockResolvedValue(HOME);
    (client.resolveLocalPath as any).mockImplementation(
      async (candidate: string) => ({
        path: candidate,
        kind: candidate.endsWith('.rasenpkg') ? 'file' : 'directory',
        separator: candidate.includes('\\') ? '\\' : '/',
      })
    );
    (client.chooseLocalPath as any).mockResolvedValue({
      status: 'unavailable',
      reason: 'headless',
    });
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.resetAllMocks();
  });

  async function mount(mode?: 'dir' | 'file-or-dir' | 'file') {
    await act(async () => {
      render(<Harness mode={mode} />, container);
      await flush();
    });
  }

  async function click(selector: string) {
    await act(async () => {
      (container.querySelector(selector) as HTMLElement).click();
      await flush();
    });
  }

  it('handles native selected, cancelled, and unavailable results without erasing selection', async () => {
    await mount();
    const input = container.querySelector('input') as HTMLInputElement;
    expect(container.querySelector('[data-testid="choose-directory"]')?.textContent).toBe('Choose directory');
    expect(container.querySelector('[data-testid="choose-file"]')?.textContent).toBe('Choose package file');
    expect(input.getAttribute('aria-label')).toBe('Server-local path');
    expect(input.getAttribute('placeholder')).toBe('Type an absolute server-local path');
    expect(container.querySelector('[data-testid="path-resolved"]')?.textContent?.trim()).toBe('resolved');
    (client.chooseLocalPath as any)
      .mockResolvedValueOnce({
        status: 'selected',
        path: '/chosen/flow.rasenpkg',
        kind: 'file',
        separator: '/',
      })
      .mockResolvedValueOnce({ status: 'cancelled' })
      .mockResolvedValueOnce({ status: 'unavailable', reason: 'headless' });
    await click('[data-testid="choose-file"]');
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(
      '/chosen/flow.rasenpkg'
    );
    await click('[data-testid="choose-file"]');
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(
      '/chosen/flow.rasenpkg'
    );
    expect(container.textContent).toContain('Choice cancelled');
    await click('[data-testid="choose-file"]');
    expect((container.querySelector('input') as HTMLInputElement).value).toBe(
      '/chosen/flow.rasenpkg'
    );
    expect(container.textContent).toContain('Native choice unavailable');
  });

  it('resolves Enter and a dirty primary submission from the visible value only', async () => {
    await mount('dir');
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = '/typed/one';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(client.resolveLocalPath).toHaveBeenLastCalledWith('/typed/one', 'directory');

    await act(async () => {
      input.value = '/typed/two';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('[data-testid="host-submit"]');
    expect(client.resolveLocalPath).toHaveBeenLastCalledWith('/typed/two', 'directory');
    expect(container.querySelector('[data-testid="submitted"]')?.textContent).toBe('/typed/two');
  });

  it('keeps an invalid typed value visible and blocks host submission', async () => {
    await mount('dir');
    (client.resolveLocalPath as any).mockRejectedValueOnce(
      new ApiError(404, { error: { code: 'path_not_found', message: 'Typed path is missing.' } })
    );
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = '/missing';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('[data-testid="host-submit"]');
    expect(input.value).toBe('/missing');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('missing');
    expect(container.querySelector('[data-testid="submitted"]')?.textContent).toBe('');
  });

  it('navigates directories, selects files, and visibly marks git entries', async () => {
    (client.listLocalPaths as any).mockImplementation(async (candidate?: string) =>
      candidate
        ? { ...HOME, path: candidate, home: false, parent: '/home/user' }
        : HOME
    );
    await mount();
    expect(container.querySelector('[data-testid="git-badge"]')).not.toBeNull();
    const buttons = Array.from(
      container.querySelectorAll('[data-testid="dir-entries"] button')
    );
    await act(async () => {
      (buttons.find((button) => button.textContent?.includes('draft')) as HTMLElement).click();
      await flush();
    });
    expect(client.listLocalPaths).toHaveBeenLastCalledWith('/home/user/draft');

    const file = Array.from(
      container.querySelectorAll('[data-testid="dir-entries"] button')
    ).find((button) => button.textContent?.includes('flow.rasenpkg'));
    await act(async () => {
      (file as HTMLElement).click();
      await flush();
    });
    expect((container.querySelector('input') as HTMLInputElement).value).toContain(
      'flow.rasenpkg'
    );
  });

  it('preserves Windows-native separators in visible and submitted values', async () => {
    (client.listLocalPaths as any).mockResolvedValue({
      ...HOME,
      path: 'C:\\Users\\Sayo',
      separator: '\\',
    });
    (client.resolveLocalPath as any).mockResolvedValue({
      path: 'D:\\stores\\team',
      kind: 'directory',
      separator: '\\',
    });
    await mount('dir');
    const input = container.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = 'D:\\stores\\team';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('[data-testid="host-submit"]');
    expect(input.value).toBe('D:\\stores\\team');
    expect(container.querySelector('[data-testid="submitted"]')?.textContent).toBe(
      'D:\\stores\\team'
    );
  });
});
