import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInNewContext } from 'node:vm';

const viewer = fs.readFileSync(path.resolve('viewer', 'audit.html'), 'utf8');

function functionSource(name: string): string {
  const start = viewer.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing viewer function ${name}`);
  const bodyStart = viewer.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < viewer.length; index++) {
    if (viewer[index] === '{') depth++;
    if (viewer[index] === '}' && --depth === 0) return viewer.slice(start, index + 1);
  }
  throw new Error(`Unterminated viewer function ${name}`);
}

function hostileCodexReport() {
  return {
    schema: 'rasen-token-audit/2',
    generatedAt: '2026-07-24T00:00:00.000Z',
    session: {
      id: 'hostile',
      runtime: 'codex',
      mainTranscript: '/redacted/source.jsonl',
      start: 1,
      end: 2,
      durationMs: 1,
      agentCount: 1,
    },
    totals: {
      requests: 1,
      cacheHitRatio: 0,
      rawTokens: {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 1,
      },
    },
    agents: [{
      index: 0,
      label: 'agent',
      kind: 'main',
      requests: 1,
      cacheHitRatio: 0,
      rawTokens: {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 1,
      },
      turns: [],
      rebuilds: {
        events: '<img src=x onerror="globalThis.auditPwned=DATA.session.id">',
        rewroteTokens: 1,
        byCause: {},
      },
    }],
  };
}

describe('audit viewer embedded-mode contract', () => {
  it('requires explicit HTTP(S) embed mode and exact same-origin direct-parent messages', () => {
    expect(viewer).toContain("QUERY.get('embed') === '1'");
    expect(viewer).toContain("location.protocol === 'http:' || location.protocol === 'https:'");
    expect(viewer).toContain('window.parent !== window');
    expect(viewer).toContain('event.source !== window.parent || event.origin !== location.origin');
    expect(viewer).toContain("sendParent({ type: 'rasen-audit-ready' })");
    expect(viewer).toContain("type: 'rasen-audit-error'");
  });

  it('validates embedded reports and dispatches them through the existing renderer', () => {
    expect(viewer).toContain("message.type !== 'rasen-audit-report'");
    expect(viewer).toContain('isSupportedReport(message.report)');
    expect(viewer).toContain('render(DATA)');
    expect(viewer).toContain("message.type === 'rasen-audit-theme'");
    expect(viewer).toContain("j.schema !== 'rasen-token-audit/1'");
    expect(viewer).toContain("j.schema !== 'rasen-token-audit/2'");
    expect(viewer).toContain('!number(s.agentCount)');
    expect(viewer).toContain('${esc(b)}');
  });

  it('rejects hostile Codex rebuild values and escapes them even at the raw renderer boundary', () => {
    const report = hostileCodexReport();
    const validationContext = { report, accepted: true };
    runInNewContext(
      `${functionSource('isSupportedReport')}; accepted = isSupportedReport(report);`,
      validationContext
    );
    expect(validationContext.accepted).toBe(false);

    const escSource = viewer.match(/^const esc = .*;$/m)?.[0];
    expect(escSource).toBeTruthy();
    const renderContext = {
      report,
      rendered: '',
      fmt: String,
      fmtInt: String,
      sortable: (
        _wrapId: string,
        _headers: unknown,
        rows: unknown[],
        renderRow: (row: unknown) => string
      ) => {
        renderContext.rendered = renderRow(rows[0]);
      },
    };
    runInNewContext(
      `${escSource}; ${functionSource('renderCodexAgentTable')}; renderCodexAgentTable(report);`,
      renderContext
    );
    expect(renderContext.rendered).toContain(
      '&lt;img src=x onerror=&quot;globalThis.auditPwned=DATA.session.id&quot;&gt;'
    );
    expect(renderContext.rendered).not.toMatch(/<img[^>]+onerror=/);
  });

  it('keeps standalone file drop, src loading, theme toggle, and runtime dispatch', () => {
    expect(viewer).toContain("drop.ondrop = (e) =>");
    expect(viewer).toContain("const src = QUERY.get('src')");
    expect(viewer).toContain('themeBtn.onclick');
    expect(viewer).toContain("if (runtime === 'codex')");
    expect(viewer).toContain("else if (runtime === 'zed')");
    expect(viewer).toContain('renderClaude(j)');
  });
});
