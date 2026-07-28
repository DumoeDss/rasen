import { useEffect, useRef, useState } from 'preact/hooks';
import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  AuditReportDescriptor,
  AuditReportDetailResponse,
  AuditReportsResponse,
  AuditSessionsResponse,
} from '../api/types.js';
import { PageHeader } from './ui/PageHeader.js';

type VisibleError = { message: string; fix?: string };

function visibleError(error: unknown, fallback: string): VisibleError {
  return error instanceof ApiError
    ? { message: error.message, ...(error.fix ? { fix: error.fix } : {}) }
    : { message: fallback };
}

function formatTime(value: number | string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Unknown time' : date.toLocaleString();
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function startsWithSavedResultsExpanded(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(min-width: 901px)').matches;
}

function ReportFrame({ detail }: { detail: AuditReportDetailResponse | null }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (prefersDark() ? 'dark' : 'light'));

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        (event.origin !== location.origin && event.origin !== 'null')
      ) return;
      const message = event.data as { type?: unknown; message?: unknown };
      if (message?.type === 'rasen-audit-ready') {
        setReady(true);
        setViewerError(null);
      } else if (message?.type === 'rasen-audit-error') {
        setViewerError(typeof message.message === 'string' ? message.message : 'The audit viewer rejected this report.');
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  useEffect(() => {
    if (!ready || !detail || !iframe.current?.contentWindow) return;
    iframe.current.contentWindow.postMessage(
      { type: 'rasen-audit-report', report: detail.report, theme },
      '*'
    );
  }, [ready, detail, theme]);

  return (
    <section class="audit-viewer" aria-label="Audit report visualization">
      {viewerError && <p class="audit-error" role="alert">{viewerError}</p>}
      {!detail && <div class="audit-viewer__empty">Select or create an audit report to inspect it here.</div>}
      <iframe
        ref={iframe}
        class={`audit-viewer__frame${detail ? '' : ' audit-viewer__frame--empty'}`}
        data-testid="audit-viewer-frame"
        title="Rasen audit report"
        sandbox="allow-scripts"
        src="/assets/audit-viewer.html?embed=1"
        onLoad={() => {
          setReady(false);
          iframe.current?.contentWindow?.postMessage({ type: 'rasen-audit-ping' }, '*');
        }}
      />
    </section>
  );
}

export function AuditPage() {
  const [reports, setReports] = useState<AuditReportsResponse | null>(null);
  const [reportsError, setReportsError] = useState<VisibleError | null>(null);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [sessions, setSessions] = useState<AuditSessionsResponse | null>(null);
  const [sessionsError, setSessionsError] = useState<VisibleError | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSessionKey, setSelectedSessionKey] = useState('');
  const [detail, setDetail] = useState<AuditReportDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<VisibleError | null>(null);
  const [operation, setOperation] = useState<'analyze' | 'import' | null>(null);
  const [operationError, setOperationError] = useState<VisibleError | null>(null);
  const [reportsNonce, setReportsNonce] = useState(0);
  const [sessionsNonce, setSessionsNonce] = useState(0);
  const [detailNonce, setDetailNonce] = useState(0);
  const [resultsExpanded, setResultsExpanded] = useState(startsWithSavedResultsExpanded);
  const detailRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setReportsLoading(true);
    setReportsError(null);
    client
      .listAuditReports()
      .then((response) => {
        if (cancelled) return;
        setReports(response);
        setSelectedId((current) =>
          current && response.reports.some((report) => report.id === current)
            ? current
            : response.reports[0]?.id ?? null
        );
      })
      .catch((error) => {
        if (!cancelled) setReportsError(visibleError(error, 'Failed to load saved audits.'));
      })
      .finally(() => {
        if (!cancelled) setReportsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportsNonce]);

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    setSessionsError(null);
    client
      .discoverAuditSessions()
      .then((response) => {
        if (cancelled) return;
        setSessions(response);
        setSelectedSessionKey((current) => {
          if (current && response.sessions.some((session) => `${session.runtime}:${session.sessionId}` === current)) {
            return current;
          }
          const first = response.sessions[0];
          return first ? `${first.runtime}:${first.sessionId}` : '';
        });
      })
      .catch((error) => {
        if (!cancelled) setSessionsError(visibleError(error, 'Failed to discover recent sessions.'));
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionsNonce]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    if (detail?.descriptor.id === selectedId) return;
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError(null);
    client
      .getAuditReport(selectedId)
      .then((response) => {
        if (detailRequest.current === requestId) setDetail(response);
      })
      .catch((error) => {
        if (detailRequest.current === requestId) {
          setDetailError(visibleError(error, 'Failed to load this audit report.'));
        }
      })
      .finally(() => {
        if (detailRequest.current === requestId) setDetailLoading(false);
      });
  }, [selectedId, detailNonce]);

  function selectReport(id: string) {
    detailRequest.current++;
    setSelectedId(id);
    setDetailError(null);
  }

  function useCreatedReport(response: AuditReportDetailResponse) {
    detailRequest.current++;
    setDetail(response);
    setSelectedId(response.descriptor.id);
    setReportsNonce((value) => value + 1);
    setSessionsNonce((value) => value + 1);
  }

  async function analyze() {
    if (operation || !selectedSessionKey) return;
    const selected = sessions?.sessions.find(
      (session) => `${session.runtime}:${session.sessionId}` === selectedSessionKey
    );
    if (!selected) return;
    setOperation('analyze');
    setOperationError(null);
    try {
      useCreatedReport(await client.runSessionAudit(selected.runtime, selected.sessionId));
    } catch (error) {
      setOperationError(visibleError(error, 'Failed to analyze the selected session.'));
    } finally {
      setOperation(null);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file || operation) return;
    setOperation('import');
    setOperationError(null);
    try {
      useCreatedReport(await client.importAuditFile(file));
    } catch (error) {
      setOperationError(visibleError(error, 'Failed to import this file.'));
    } finally {
      setOperation(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const unavailable = sessions?.diagnostics.filter((diagnostic) => !diagnostic.available) ?? [];

  return (
    <div class="audit-page" data-testid="audit-page">
      <PageHeader
        title="Audit"
        actions={
          <button
            type="button"
            class="btn--ghost"
            onClick={() => {
              setReportsNonce((value) => value + 1);
              setSessionsNonce((value) => value + 1);
            }}
          >
            Refresh
          </button>
        }
      />

      <div class="audit-actions">
        <section class="audit-action-card">
          <h2>Recent sessions</h2>
          {sessionsLoading && <p>Discovering sessions…</p>}
          {sessionsError && (
            <div class="audit-error" role="alert">
              <p>{sessionsError.message}{sessionsError.fix ? ` — ${sessionsError.fix}` : ''}</p>
              <button type="button" onClick={() => setSessionsNonce((value) => value + 1)}>Retry</button>
            </div>
          )}
          {!sessionsLoading && !sessionsError && (
            <>
              <select
                aria-label="Recent audit session"
                value={selectedSessionKey}
                disabled={!!operation || (sessions?.sessions.length ?? 0) === 0}
                onChange={(event) => setSelectedSessionKey((event.target as HTMLSelectElement).value)}
              >
                {(sessions?.sessions ?? []).map((session) => (
                  <option key={`${session.runtime}:${session.sessionId}`} value={`${session.runtime}:${session.sessionId}`}>
                    {session.runtime.toUpperCase()} · {session.title || session.label} · {formatTime(session.updatedAt)}
                  </option>
                ))}
              </select>
              {(sessions?.sessions.length ?? 0) === 0 && <p>No recent native sessions were found.</p>}
              <button
                type="button"
                class="btn--primary"
                data-testid="audit-analyze"
                disabled={!!operation || !selectedSessionKey}
                onClick={analyze}
              >
                {operation === 'analyze' ? 'Analyzing…' : 'Analyze'}
              </button>
            </>
          )}
          {unavailable.length > 0 && (
            <ul class="audit-diagnostics">
              {unavailable.map((diagnostic) => (
                <li key={diagnostic.runtime}>
                  {diagnostic.runtime}: unavailable{diagnostic.message ? ` — ${diagnostic.message}` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          class={`audit-action-card audit-drop${operation === 'import' ? ' audit-drop--busy' : ''}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void importFile(event.dataTransfer?.files[0]);
          }}
        >
          <h2>Import a file</h2>
          <p>Drop or choose a .jsonl, .db, .sqlite, or Rasen audit .json file.</p>
          <p class="audit-hint">
            A single transcript import cannot include sibling agent files you did not select. Database imports analyze the
            most recently updated root thread.
          </p>
          <input
            ref={fileInput}
            class="audit-file-input"
            type="file"
            accept=".jsonl,.db,.sqlite,.json"
            disabled={!!operation}
            onChange={(event) => void importFile((event.target as HTMLInputElement).files?.[0])}
          />
          <button type="button" disabled={!!operation} onClick={() => fileInput.current?.click()}>
            {operation === 'import' ? 'Uploading and analyzing…' : 'Choose file'}
          </button>
        </section>
      </div>

      {operationError && (
        <div class="audit-error audit-error--operation" role="alert">
          <p>{operationError.message}{operationError.fix ? ` — ${operationError.fix}` : ''}</p>
          <button type="button" onClick={() => setOperationError(null)}>Dismiss and retry</button>
        </div>
      )}

      <div
        class={`audit-master-detail${resultsExpanded ? '' : ' audit-master-detail--collapsed'}`}
        data-results-expanded={resultsExpanded ? 'true' : 'false'}
      >
        <aside
          class={`audit-results${resultsExpanded ? '' : ' audit-results--collapsed'}`}
          aria-label="Saved audit reports"
        >
          <div class="audit-results__header">
            {resultsExpanded && <h2>Saved results</h2>}
            <button
              type="button"
              class="audit-results__toggle btn--ghost"
              aria-label={resultsExpanded ? 'Collapse saved results' : 'Expand saved results'}
              aria-expanded={resultsExpanded}
              aria-controls="audit-saved-results"
              title={resultsExpanded ? 'Collapse saved results' : 'Expand saved results'}
              onClick={() => setResultsExpanded((expanded) => !expanded)}
            >
              <span aria-hidden="true">{resultsExpanded ? '−' : '+'}</span>
            </button>
          </div>
          <div id="audit-saved-results" hidden={!resultsExpanded}>
          {reportsLoading && <p>Loading saved audits…</p>}
          {reportsError && (
            <div class="audit-error" role="alert">
              <p>{reportsError.message}{reportsError.fix ? ` — ${reportsError.fix}` : ''}</p>
              <button type="button" onClick={() => setReportsNonce((value) => value + 1)}>Retry</button>
            </div>
          )}
          {!reportsLoading && !reportsError && reports?.reports.length === 0 && (
            <p class="audit-results__empty">No saved audit reports yet. Analyze a recent session or import a file.</p>
          )}
          {(reports?.skipped ?? 0) > 0 && (
            <p class="audit-skipped">{reports?.skipped} unsupported analytics entries were skipped.</p>
          )}
          <ul class="audit-results__list">
            {(reports?.reports ?? []).map((report: AuditReportDescriptor) => (
              <li key={report.id}>
                <button
                  type="button"
                  class={`audit-result${selectedId === report.id ? ' audit-result--active' : ''}`}
                  aria-current={selectedId === report.id ? 'true' : undefined}
                  onClick={() => selectReport(report.id)}
                >
                  <span class="audit-result__title">{report.title || report.sessionId}</span>
                  <span>{report.runtime.toUpperCase()} · {report.memberCount} {report.runtime === 'zed' ? 'threads' : 'agents'}</span>
                  <time>{formatTime(report.generatedAt)}</time>
                </button>
              </li>
            ))}
          </ul>
          </div>
        </aside>

        <div class="audit-detail">
          {detailLoading && <p class="audit-detail__loading">Loading report…</p>}
          {detailError && (
            <div class="audit-error" role="alert">
              <p>{detailError.message}{detailError.fix ? ` — ${detailError.fix}` : ''}</p>
              <button type="button" onClick={() => {
                setDetailNonce((value) => value + 1);
              }}>Retry</button>
            </div>
          )}
          <ReportFrame detail={detail} />
        </div>
      </div>
    </div>
  );
}
