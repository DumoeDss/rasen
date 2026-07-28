// @vitest-environment jsdom
/**
 * renderInlineCode (task-detail-ui spec): backtick spans become <code>, the
 * backtick characters themselves never render, and an unpaired backtick is kept
 * as a literal so no text is dropped.
 */
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderInlineCode } from '../../../src/components/ui/inline-code.js';

describe('renderInlineCode', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('renders a backtick span as <code> without the backtick characters', () => {
    render(<p>{renderInlineCode('Extend `parseCodexRolloutFile` to capture usage')}</p>, container);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('parseCodexRolloutFile');
    expect(container.textContent).toBe('Extend parseCodexRolloutFile to capture usage');
    expect(container.textContent).not.toContain('`');
  });

  it('handles multiple code spans in one string', () => {
    render(<p>{renderInlineCode('run `a` then `b`')}</p>, container);
    const codes = Array.from(container.querySelectorAll('code'));
    expect(codes.map((c) => c.textContent)).toEqual(['a', 'b']);
  });

  it('returns plain text unchanged when there are no backticks', () => {
    render(<p>{renderInlineCode('plain text only')}</p>, container);
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toBe('plain text only');
  });

  it('keeps an unpaired backtick as a literal so nothing is dropped', () => {
    render(<p>{renderInlineCode('a `b c')}</p>, container);
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toBe('a `b c');
  });

  it('keeps a trailing lone backtick (empty final segment) rather than dropping it', () => {
    render(<p>{renderInlineCode('run foo`')}</p>, container);
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toBe('run foo`');
  });
});
