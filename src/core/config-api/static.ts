/**
 * Static asset serving for `rasen config ui` (design.md D7): the resolved
 * UI package's `dist/` at `/`, with an index-fallback for client-side
 * routes, or a minimal built-in install-hint page when the package is not
 * installed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as http from 'node:http';

import { UI_PACKAGE_NAME } from './ui-package.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function hintPage(): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Rasen Config</title></head>
<body>
<h1>Rasen Config UI package not installed</h1>
<p>The API is running and fully usable at <code>/api/v1/</code>, but no UI
package is installed to render a visual config page.</p>
<p>Run: <code>npm install -g ${UI_PACKAGE_NAME}</code></p>
</body>
</html>
`;
}

function safeResolve(assetsDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed percent-encoding (e.g. "%zz") throws URIError — treat like
    // any other unresolvable path (null) so the caller falls back to
    // index.html instead of the request crashing into a 500 (M1).
    return null;
  }
  const resolved = path.join(assetsDir, decoded);
  const relative = path.relative(assetsDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null; // path traversal
  return resolved;
}

function sendFile(res: http.ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * Serves `pathname` from `assetsDir` (the UI package's `dist/`), or the
 * built-in install-hint page when `assetsDir` is null. Non-existent paths
 * fall back to `index.html` (client-side routing) when one exists.
 */
export async function serveStatic(
  assetsDir: string | null,
  pathname: string,
  res: http.ServerResponse
): Promise<void> {
  if (!assetsDir) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(hintPage());
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const resolved = safeResolve(assetsDir, requestedPath);

  if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    sendFile(res, resolved);
    return;
  }

  const indexPath = path.join(assetsDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    sendFile(res, indexPath);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}
