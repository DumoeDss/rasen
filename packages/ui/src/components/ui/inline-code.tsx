import type { ComponentChildren } from 'preact';

/**
 * Renders backtick-delimited spans in a plain string as `<code>` elements
 * (task-detail-ui spec: "Inline code spans in task text ... SHALL render as
 * code rather than as literal backticks"). Not a markdown parser — only the
 * inline-code grammar, splitting on paired backticks; an unpaired trailing
 * backtick is emitted as literal text so nothing is ever dropped.
 */
export function renderInlineCode(text: string): ComponentChildren {
  if (!text.includes('`')) return text;
  const parts = text.split('`');
  // Even indices are plain text, odd indices are code — UNLESS the count is
  // even (an unpaired backtick), in which case the final segment is plain text
  // re-joined with its backtick so no character is lost.
  const out: ComponentChildren[] = [];
  const unpaired = parts.length % 2 === 0;
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i]!;
    const isCode = i % 2 === 1 && !(unpaired && i === parts.length - 1);
    if (isCode) {
      out.push(<code key={i}>{segment}</code>);
    } else if (unpaired && i === parts.length - 1) {
      // The unpaired trailing backtick is literal — emit it even when its
      // segment is empty (input ending in a lone backtick), so nothing drops.
      out.push(<span key={i}>{'`' + segment}</span>);
    } else if (segment !== '') {
      out.push(<span key={i}>{segment}</span>);
    }
  }
  return out;
}
