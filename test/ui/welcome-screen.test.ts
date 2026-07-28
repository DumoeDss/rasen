import { describe, it, expect, vi, afterEach } from 'vitest';
import { showWelcomeScreen } from '../../src/ui/welcome-screen.js';

describe('welcome screen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders no /rasen: colon-form command references (canonical skill names only)', async () => {
    // Force the non-TTY static-fallback branch so the content renders
    // synchronously without the animation loop / Enter-key wait.
    const wasTTY = process.stdout.isTTY;
    (process.stdout as unknown as { isTTY: boolean }).isTTY = false;

    const written: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    try {
      await showWelcomeScreen();
    } finally {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = wasTTY;
      writeSpy.mockRestore();
    }

    const output = written.join('');
    expect(output).toContain('rasen-new-change');
    expect(output).toContain('rasen-continue-change');
    expect(output).toContain('rasen-apply-change');
    expect(output).not.toContain('/rasen:');
  });
});
