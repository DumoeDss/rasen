// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, getSession: vi.fn(), killSession: vi.fn() };
});

import * as client from '../../src/api/client.js';
import { ApiError } from '../../src/api/client.js';
import { SessionRow } from '../../src/components/SessionRow.js';
import { sessionsListFixture } from '../fixtures/sessions-list.js';

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('SessionRow stop control', () => {
  let container: HTMLElement;
  const entry = sessionsListFixture.sessions[0]!;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.killSession).mockResolvedValue({
      session: { ...entry.session, state: 'exiting' },
    });
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.resetAllMocks();
  });

  it('requires confirmation before stopping and sends the exact displayed Session id', async () => {
    const onKilled = vi.fn();
    render(<SessionRow entry={entry} onKilled={onKilled} />, container);
    const stop = [...container.querySelectorAll('button')].find(button => button.textContent === 'Stop Session')!;

    await click(stop);
    expect(client.killSession).not.toHaveBeenCalled();
    const confirm = [...container.querySelectorAll('button')].find(button => button.textContent === 'Stop Session')!;
    await click(confirm);

    expect(client.killSession).toHaveBeenCalledWith('sess-live-with-progress');
    expect(onKilled).toHaveBeenCalledWith(
      'sess-live-with-progress',
      expect.objectContaining({ kind: 'patched' })
    );
  });

  it('treats a 404 as already gone and requests a parent refresh without pinning an error', async () => {
    vi.mocked(client.killSession).mockRejectedValueOnce(new ApiError(404, {
      error: { code: 'session_not_found', message: 'gone' },
    }));
    const onKilled = vi.fn();
    render(<SessionRow entry={entry} onKilled={onKilled} />, container);

    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Stop Session')!);
    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Stop Session')!);

    expect(onKilled).toHaveBeenCalledWith('sess-live-with-progress', { kind: 'gone' });
    expect(container.querySelector('.session-row__kill-error')).toBeNull();
  });
});
