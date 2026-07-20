/**
 * Daemon discovery probe (design D3, task 2.2): a short-timeout, no-proxy
 * GET of `/api/v1/status` on a candidate port, classified by the response
 * headers alone (`x-rasen-daemon`, `x-rasen-pid` — stamped on every
 * management-server response, including 4xx/5xx, since slice 1) rather than
 * by the body, so classification never needs the token. Uses `node:http`
 * directly with `agent: false` (never the global `fetch`/undici pool): this
 * repo has already been bitten once by undici's keep-alive socket keeping a
 * short-lived CLI process alive for seconds past its last await (see
 * `submit.ts`'s subprocess spawn and the telemetry fire-and-forget fix) —
 * `daemon start`/`stop`/`status` are exactly such short-lived CLI
 * invocations, so every probe destroys its socket once the response is
 * read. `node:http` never consults `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` on
 * its own (unlike some fetch implementations) — this must stay true (the
 * omnicross `.no_proxy()` lesson): a probe routed through a system proxy
 * would make a live daemon look dead.
 */
import * as http from 'node:http';

const PROBE_TIMEOUT_MS = 700;

export const DEFAULT_DAEMON_PORT = 8791;

export type DaemonProbeResult =
  | { kind: 'no-listener' }
  | { kind: 'foreign' }
  | { kind: 'rasen-daemon'; version: string; pid: number };

/** Resolves the default port: `RASEN_DAEMON_PORT` override, else 8791. Never 8890 (the user's own preview server; not enforced here — the caller owns that red line by never passing it). */
export function resolveDefaultDaemonPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.RASEN_DAEMON_PORT;
  if (!raw) return DEFAULT_DAEMON_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) return DEFAULT_DAEMON_PORT;
  return parsed;
}

/**
 * Probes `GET /api/v1/status` on `port` and classifies the result. Never
 * throws — a network error, timeout, or non-response is `no-listener`.
 */
export function probeDaemonPort(port: number): Promise<DaemonProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DaemonProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/v1/status',
        method: 'GET',
        agent: false, // never the keep-alive pool — this call must not keep a short-lived CLI process alive.
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        const daemonVersion = res.headers['x-rasen-daemon'];
        const pidHeader = res.headers['x-rasen-pid'];
        res.destroy(); // headers are all we need; never wait for/consume the body.
        if (typeof daemonVersion !== 'string') {
          finish({ kind: 'foreign' });
          return;
        }
        const pid = typeof pidHeader === 'string' ? Number(pidHeader) : NaN;
        if (!Number.isInteger(pid)) {
          finish({ kind: 'foreign' });
          return;
        }
        finish({ kind: 'rasen-daemon', version: daemonVersion, pid });
      }
    );
    req.on('timeout', () => {
      req.destroy();
    });
    req.on('error', () => {
      finish({ kind: 'no-listener' });
    });
    req.end();
  });
}

/**
 * Probe order (design D2/D3): the state file's port hint first (if it
 * differs from the default), then the default port. Returns the first
 * classification that isn't `no-listener`, along with the port it was found
 * on; falls through to `{ kind: 'no-listener' }` at the default port when
 * neither answers.
 */
export async function probeDaemon(
  defaultPort: number,
  stateFilePortHint: number | undefined
): Promise<{ port: number; result: DaemonProbeResult }> {
  if (stateFilePortHint !== undefined && stateFilePortHint !== defaultPort) {
    const hinted = await probeDaemonPort(stateFilePortHint);
    if (hinted.kind !== 'no-listener') {
      return { port: stateFilePortHint, result: hinted };
    }
  }
  const atDefault = await probeDaemonPort(defaultPort);
  return { port: defaultPort, result: atDefault };
}
