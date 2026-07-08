#!/usr/bin/env node
// CDP Proxy - 通过 HTTP API 操控用户日常 Chrome
// 要求：Chrome 已开启 --remote-debugging-port
// Node.js 22+（使用原生 WebSocket）

import http from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

const PORT = parseInt(process.env.CDP_PROXY_PORT || '3456');
let ws = null;
let cmdId = 0;
const pending = new Map(); // id -> {resolve, timer}
const sessions = new Map(); // targetId -> sessionId
const managedTabs = new Map(); // targetId -> { lastAccessed: number }
const TAB_IDLE_TIMEOUT = parseInt(process.env.CDP_TAB_IDLE_TIMEOUT || '900000'); // 15 min default
const CLEANUP_INTERVAL = 60000; // sweep every 60s

// --- Capture state (per session) ---
// sessionId -> { enabled, captureBody, nextSeq, events: [], byRequestId: Map, waiters: [] }
const networkCaptures = new Map();
// sessionId -> { enabled, nextSeq, events: [], waiters: [] }
const consoleCaptures = new Map();
// targetId -> last /snapshot interactive tree (for -D diff mode). In-memory, lost on restart.
const snapshotBaselines = new Map();

const MAX_NETWORK_EVENTS = parseInt(process.env.CDP_MAX_NETWORK_EVENTS || '2000');
const MAX_CONSOLE_EVENTS = parseInt(process.env.CDP_MAX_CONSOLE_EVENTS || '1000');
const MAX_BODY_BYTES = parseInt(process.env.CDP_MAX_BODY_BYTES || '262144'); // 256 KiB

// --- WebSocket 兼容层 ---
let WS;
if (typeof globalThis.WebSocket !== 'undefined') {
  // Node 22+ 原生 WebSocket（浏览器兼容 API）
  WS = globalThis.WebSocket;
} else {
  // 回退到 ws 模块
  try {
    WS = (await import('ws')).default;
  } catch {
    console.error('[CDP Proxy] 错误：Node.js 版本 < 22 且未安装 ws 模块');
    console.error('  解决方案：升级到 Node.js 22+ 或执行 npm install -g ws');
    process.exit(1);
  }
}

// --- 自动发现 Chrome 调试端口 ---
async function discoverChromePort() {
  // 1. 尝试读 DevToolsActivePort 文件
  const possiblePaths = [];
  const platform = os.platform();

  if (platform === 'darwin') {
    const home = os.homedir();
    possiblePaths.push(
      path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
    );
  } else if (platform === 'linux') {
    const home = os.homedir();
    possiblePaths.push(
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    possiblePaths.push(
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
    );
  }

  for (const p of possiblePaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8').trim();
      const lines = content.split('\n');
      const port = parseInt(lines[0]);
      if (port > 0 && port < 65536) {
        const ok = await checkPort(port);
        if (ok) {
          // 第二行是带 UUID 的 WebSocket 路径（如 /devtools/browser/xxx-xxx）
          // 非显式 --remote-debugging-port 启动时，Chrome 可能只接受此路径
          const wsPath = lines[1] || null;
          console.log(`[CDP Proxy] 从 DevToolsActivePort 发现端口: ${port}${wsPath ? ' (带 wsPath)' : ''}`);
          return { port, wsPath };
        }
      }
    } catch { /* 文件不存在，继续 */ }
  }

  // 2. 扫描常用端口
  const commonPorts = [9222, 9229, 9333];
  for (const port of commonPorts) {
    const ok = await checkPort(port);
    if (ok) {
      console.log(`[CDP Proxy] 扫描发现 Chrome 调试端口: ${port}`);
      return { port, wsPath: null };
    }
  }

  return null;
}

// 用 TCP 探测端口是否监听——避免 WebSocket 连接触发 Chrome 安全弹窗
// （WebSocket 探测会被 Chrome 视为调试连接，弹出授权对话框）
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function getWebSocketUrl(port, wsPath) {
  if (wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
  return `ws://127.0.0.1:${port}/devtools/browser`;
}

// --- WebSocket 连接管理 ---
let chromePort = null;
let chromeWsPath = null;

let connectingPromise = null;
async function connect() {
  if (ws && (ws.readyState === WS.OPEN || ws.readyState === 1)) return;
  if (connectingPromise) return connectingPromise;  // 复用进行中的连接

  if (!chromePort) {
    const discovered = await discoverChromePort();
    if (!discovered) {
      throw new Error(
        'Chrome 未开启远程调试端口。请用以下方式启动 Chrome：\n' +
        '  macOS: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n' +
        '  Linux: google-chrome --remote-debugging-port=9222\n' +
        '  或在 chrome://flags 中搜索 "remote debugging" 并启用'
      );
    }
    chromePort = discovered.port;
    chromeWsPath = discovered.wsPath;
  }

  const wsUrl = getWebSocketUrl(chromePort, chromeWsPath);
  if (!wsUrl) throw new Error('无法获取 Chrome WebSocket URL');

  return connectingPromise = new Promise((resolve, reject) => {
    ws = new WS(wsUrl);

    const onOpen = () => {
      cleanup();
      connectingPromise = null;
      console.log(`[CDP Proxy] 已连接 Chrome (端口 ${chromePort})`);
      resolve();
    };
    const onError = (e) => {
      cleanup();
      connectingPromise = null;
      ws = null;
      chromePort = null;
      chromeWsPath = null;
      const msg = e.message || e.error?.message || '连接失败';
      console.error('[CDP Proxy] 连接错误:', msg, '（端口缓存已清除，下次将重新发现）');
      reject(new Error(msg));
    };
    const onClose = () => {
      console.log('[CDP Proxy] 连接断开');
      ws = null;
      chromePort = null; // 重置端口缓存，下次连接重新发现
      chromeWsPath = null;
      sessions.clear();
      managedTabs.clear();
    };
    const onMessage = (evt) => {
      const data = typeof evt === 'string' ? evt : (evt.data || evt);
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString());

      if (msg.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = msg.params;
        sessions.set(targetInfo.targetId, sessionId);
      }
      // 拦截页面对 Chrome 调试端口的探测请求（反风控）
      if (msg.method === 'Fetch.requestPaused') {
        const { requestId, sessionId: sid } = msg.params;
        sendCDP('Fetch.failRequest', { requestId, errorReason: 'ConnectionRefused' }, sid).catch(() => {});
      }
      // --- Network/Console/Log 事件分发 ---
      if (msg.method && msg.sessionId) {
        if (msg.method.startsWith('Network.')) {
          handleNetworkEvent(msg.sessionId, msg.method, msg.params);
        } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Runtime.exceptionThrown' || msg.method === 'Log.entryAdded') {
          handleConsoleEvent(msg.sessionId, msg.method, msg.params);
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        resolve(msg);
      }
    };

    function cleanup() {
      ws.removeEventListener?.('open', onOpen);
      ws.removeEventListener?.('error', onError);
    }

    // 兼容 Node 原生 WebSocket 和 ws 模块的事件 API
    if (ws.on) {
      ws.on('open', onOpen);
      ws.on('error', onError);
      ws.on('close', onClose);
      ws.on('message', onMessage);
    } else {
      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);
      ws.addEventListener('message', onMessage);
    }
  });
}

function sendCDP(method, params = {}, sessionId = null) {
  return new Promise((resolve, reject) => {
    if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) {
      return reject(new Error('WebSocket 未连接'));
    }
    const id = ++cmdId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('CDP 命令超时: ' + method));
    }, 30000);
    pending.set(id, { resolve, timer });
    ws.send(JSON.stringify(msg));
  });
}

// 已启用端口拦截的 session 集合（避免重复启用）
const portGuardedSessions = new Set();

async function ensureSession(targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const resp = await sendCDP('Target.attachToTarget', { targetId, flatten: true });
  if (resp.result?.sessionId) {
    const sid = resp.result.sessionId;
    sessions.set(targetId, sid);
    // 启用调试端口探测拦截
    await enablePortGuard(sid);
    // 让子 frame 也被自动 attach（iframe 枚举依赖此）
    sendCDP('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
    return sid;
  }
  throw new Error('attach 失败: ' + JSON.stringify(resp.error));
}

async function enableNetworkCapture(sessionId, { captureBody = false } = {}) {
  const state = getNetworkState(sessionId);
  if (!state.enabled) {
    await sendCDP('Network.enable', {
      maxTotalBufferSize: 10 * 1024 * 1024,
      maxResourceBufferSize: 1024 * 1024,
    }, sessionId);
    state.enabled = true;
  }
  state.captureBody = !!captureBody;
  return state;
}

async function disableNetworkCapture(sessionId) {
  const state = getNetworkState(sessionId);
  if (state.enabled) {
    try { await sendCDP('Network.disable', {}, sessionId); } catch { /* ignore */ }
    state.enabled = false;
  }
  // 唤醒所有 waiter 失败
  for (const w of state.waiters.splice(0)) {
    clearTimeout(w.timer);
    w.resolve({ aborted: true });
  }
}

async function enableConsoleCapture(sessionId) {
  const state = getConsoleState(sessionId);
  if (state.enabled) return state;
  await sendCDP('Runtime.enable', {}, sessionId);
  try { await sendCDP('Log.enable', {}, sessionId); } catch { /* optional */ }
  state.enabled = true;
  return state;
}

// --- Network capture ----------------------------------------------------
function getNetworkState(sessionId) {
  let s = networkCaptures.get(sessionId);
  if (!s) {
    s = {
      enabled: false,
      captureBody: false,
      nextSeq: 1,
      events: [],
      byRequestId: new Map(), // CDP requestId -> event
      waiters: [], // { match, resolve, timer }
    };
    networkCaptures.set(sessionId, s);
  }
  return s;
}

function pushNetworkEvent(state, ev) {
  state.events.push(ev);
  while (state.events.length > MAX_NETWORK_EVENTS) state.events.shift();
}

function tryFulfillWaiters(state) {
  if (!state.waiters.length) return;
  const fulfilled = [];
  for (const w of state.waiters) {
    const hit = state.events.find(e => !w.consumed.has(e.seq) && w.match(e));
    if (hit) {
      fulfilled.push({ w, hit });
      w.consumed.add(hit.seq);
    }
  }
  for (const { w, hit } of fulfilled) {
    state.waiters = state.waiters.filter(x => x !== w);
    clearTimeout(w.timer);
    w.resolve(hit);
  }
}

function handleNetworkEvent(sessionId, method, params) {
  const state = getNetworkState(sessionId);
  if (!state.enabled) return;
  const reqId = params.requestId;
  switch (method) {
    case 'Network.requestWillBeSent': {
      let ev = state.byRequestId.get(reqId);
      if (!ev) {
        ev = { seq: state.nextSeq++, requestId: reqId };
        state.byRequestId.set(reqId, ev);
        pushNetworkEvent(state, ev);
      }
      // redirect chain: keep the freshest URL/method
      const r = params.request || {};
      ev.method = r.method;
      ev.url = r.url;
      ev.requestHeaders = r.headers;
      ev.postData = r.postData;
      ev.resourceType = params.type;
      ev.frameId = params.frameId;
      ev.startedAt = Math.round((params.timestamp || 0) * 1000);
      ev.documentUrl = params.documentURL;
      if (params.redirectResponse) {
        ev.redirects = ev.redirects || [];
        ev.redirects.push({
          status: params.redirectResponse.status,
          url: params.redirectResponse.url,
          headers: params.redirectResponse.headers,
        });
      }
      break;
    }
    case 'Network.responseReceived': {
      const ev = state.byRequestId.get(reqId);
      if (!ev) return;
      const r = params.response || {};
      ev.responseStatus = r.status;
      ev.responseStatusText = r.statusText;
      ev.responseHeaders = r.headers;
      ev.mimeType = r.mimeType;
      ev.remoteIP = r.remoteIPAddress;
      ev.fromCache = r.fromDiskCache || r.fromServiceWorker;
      ev.protocol = r.protocol;
      break;
    }
    case 'Network.loadingFinished': {
      const ev = state.byRequestId.get(reqId);
      if (!ev) return;
      ev.endedAt = Math.round((params.timestamp || 0) * 1000);
      ev.encodedDataLength = params.encodedDataLength;
      ev.completed = true;
      if (state.captureBody && shouldCaptureBody(ev)) {
        // Defer waiter fulfillment until body lands — callers passing body=true
        // expect the body to be present in the returned event.
        fetchResponseBody(sessionId, reqId).then(b => {
          if (b) {
            ev.responseBody = b.body;
            ev.responseBodyBase64 = b.base64Encoded;
          }
          tryFulfillWaiters(state);
        }).catch(() => { tryFulfillWaiters(state); });
      } else {
        tryFulfillWaiters(state);
      }
      break;
    }
    case 'Network.loadingFailed': {
      const ev = state.byRequestId.get(reqId);
      if (!ev) return;
      ev.endedAt = Math.round((params.timestamp || 0) * 1000);
      ev.failed = true;
      ev.errorText = params.errorText;
      ev.canceled = params.canceled;
      ev.completed = true;
      tryFulfillWaiters(state);
      break;
    }
    case 'Network.webSocketCreated': {
      let ev = state.byRequestId.get(reqId);
      if (!ev) {
        ev = { seq: state.nextSeq++, requestId: reqId, kind: 'websocket' };
        state.byRequestId.set(reqId, ev);
        pushNetworkEvent(state, ev);
      }
      ev.url = params.url;
      ev.method = 'WS';
      ev.startedAt = Date.now();
      break;
    }
    case 'Network.webSocketFrameSent':
    case 'Network.webSocketFrameReceived': {
      const ev = state.byRequestId.get(reqId);
      if (!ev) return;
      ev.frames = ev.frames || [];
      const f = params.response || {};
      ev.frames.push({
        dir: method === 'Network.webSocketFrameSent' ? 'out' : 'in',
        t: Date.now(),
        opcode: f.opcode,
        payload: typeof f.payloadData === 'string' ? f.payloadData.slice(0, 4000) : null,
      });
      if (ev.frames.length > 100) ev.frames = ev.frames.slice(-100);
      break;
    }
    case 'Network.webSocketClosed': {
      const ev = state.byRequestId.get(reqId);
      if (!ev) return;
      ev.completed = true;
      ev.endedAt = Date.now();
      break;
    }
  }
}

function shouldCaptureBody(ev) {
  // Skip huge non-text resources to keep memory bounded.
  if (ev.encodedDataLength && ev.encodedDataLength > MAX_BODY_BYTES) return false;
  const mt = (ev.mimeType || '').toLowerCase();
  if (!mt) return true;
  if (mt.startsWith('image/') || mt.startsWith('video/') || mt.startsWith('audio/')) return false;
  if (mt === 'application/wasm' || mt === 'application/octet-stream') return false;
  return true;
}

async function fetchResponseBody(sessionId, requestId) {
  try {
    const r = await sendCDP('Network.getResponseBody', { requestId }, sessionId);
    const body = r.result?.body || '';
    return { body: body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) + '...[truncated]' : body, base64Encoded: r.result?.base64Encoded };
  } catch { return null; }
}

function compileMatch({ url_contains, url_pattern, method, status, has_post_data, body_contains, body_pattern, post_data_contains }) {
  const tests = [];
  if (url_contains) tests.push(e => (e.url || '').includes(url_contains));
  if (url_pattern) {
    let re;
    try { re = new RegExp(url_pattern); } catch { re = null; }
    if (re) tests.push(e => re.test(e.url || ''));
  }
  if (method) tests.push(e => (e.method || '').toUpperCase() === method.toUpperCase());
  if (status) {
    const expected = parseInt(status);
    tests.push(e => e.responseStatus === expected);
  }
  if (has_post_data === 'true') tests.push(e => !!e.postData);
  if (post_data_contains) tests.push(e => (e.postData || '').includes(post_data_contains));
  if (body_contains) tests.push(e => (e.responseBody || '').includes(body_contains));
  if (body_pattern) {
    let re;
    try { re = new RegExp(body_pattern); } catch { re = null; }
    if (re) tests.push(e => re.test(e.responseBody || ''));
  }
  return (e) => tests.every(t => t(e));
}

function summarizeEvent(e, { include_body = true } = {}) {
  return {
    seq: e.seq,
    kind: e.kind || 'http',
    method: e.method,
    url: e.url,
    status: e.responseStatus,
    mime: e.mimeType,
    bytes: e.encodedDataLength,
    started_at: e.startedAt,
    ended_at: e.endedAt,
    completed: e.completed === true,
    failed: e.failed === true,
    error: e.errorText,
    request_headers: e.requestHeaders,
    post_data: e.postData,
    response_headers: e.responseHeaders,
    response_body: include_body ? e.responseBody : undefined,
    response_body_base64: include_body && e.responseBodyBase64 ? true : undefined,
    redirects: e.redirects,
    frames: e.frames,
  };
}

// --- Console / Log capture ---------------------------------------------
function getConsoleState(sessionId) {
  let s = consoleCaptures.get(sessionId);
  if (!s) {
    s = { enabled: false, nextSeq: 1, events: [], waiters: [] };
    consoleCaptures.set(sessionId, s);
  }
  return s;
}

function handleConsoleEvent(sessionId, method, params) {
  const state = getConsoleState(sessionId);
  if (!state.enabled) return;
  let ev;
  if (method === 'Runtime.consoleAPICalled') {
    ev = {
      seq: state.nextSeq++,
      kind: 'console',
      level: params.type,
      t: Math.round((params.timestamp || Date.now())),
      args: (params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.unserializableValue || a.type)),
      stack: params.stackTrace?.callFrames?.slice(0, 3),
    };
  } else if (method === 'Runtime.exceptionThrown') {
    const d = params.exceptionDetails || {};
    ev = {
      seq: state.nextSeq++,
      kind: 'exception',
      level: 'error',
      t: Math.round((params.timestamp || Date.now())),
      message: d.text || d.exception?.description,
      url: d.url,
      line: d.lineNumber,
      column: d.columnNumber,
      stack: d.stackTrace?.callFrames?.slice(0, 5),
    };
  } else if (method === 'Log.entryAdded') {
    const e = params.entry || {};
    ev = {
      seq: state.nextSeq++,
      kind: 'log',
      level: e.level,
      source: e.source,
      t: e.timestamp,
      message: e.text,
      url: e.url,
    };
  }
  if (!ev) return;
  state.events.push(ev);
  while (state.events.length > MAX_CONSOLE_EVENTS) state.events.shift();
  // wake waiters
  const fulfilled = [];
  for (const w of state.waiters) {
    if (w.match(ev)) fulfilled.push(w);
  }
  for (const w of fulfilled) {
    state.waiters = state.waiters.filter(x => x !== w);
    clearTimeout(w.timer);
    w.resolve(ev);
  }
}

// 拦截页面对 Chrome 调试端口的探测（反风控）
// 只拦截 127.0.0.1:{chromePort} 的请求，不影响其他任何本地服务
async function enablePortGuard(sessionId) {
  if (!chromePort || portGuardedSessions.has(sessionId)) return;
  try {
    await sendCDP('Fetch.enable', {
      patterns: [
        { urlPattern: `http://127.0.0.1:${chromePort}/*`, requestStage: 'Request' },
        { urlPattern: `http://localhost:${chromePort}/*`, requestStage: 'Request' },
      ]
    }, sessionId);
    portGuardedSessions.add(sessionId);
  } catch { /* Fetch 域启用失败不影响主流程 */ }
}

// --- 闲置 Tab 自动清理 ---
function touchTab(targetId) {
  const entry = managedTabs.get(targetId);
  if (entry) entry.lastAccessed = Date.now();
}

async function cleanupIdleTabs() {
  if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) return;
  const now = Date.now();
  for (const [targetId, info] of managedTabs) {
    if (now - info.lastAccessed < TAB_IDLE_TIMEOUT) continue;
    try { await sendCDP('Target.closeTarget', { targetId }); } catch { /* tab may already be closed */ }
    sessions.delete(targetId);
    managedTabs.delete(targetId);
    console.log(`[CDP Proxy] Auto-closed idle tab: ${targetId}`);
  }
}

async function closeAllManagedTabs() {
  if (!ws || (ws.readyState !== WS.OPEN && ws.readyState !== 1)) return;
  const targets = [...managedTabs.keys()];
  for (const targetId of targets) {
    try { await sendCDP('Target.closeTarget', { targetId }); } catch { /* ignore */ }
    sessions.delete(targetId);
    managedTabs.delete(targetId);
  }
  if (targets.length) console.log(`[CDP Proxy] Shutdown: closed ${targets.length} managed tab(s)`);
}

// --- 等待页面加载 ---
async function waitForLoad(sessionId, timeoutMs = 15000) {
  // 启用 Page 域
  await sendCDP('Page.enable', {}, sessionId);

  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(checkInterval);
      resolve(result);
    };

    const timer = setTimeout(() => done('timeout'), timeoutMs);
    const checkInterval = setInterval(async () => {
      try {
        const resp = await sendCDP('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }, sessionId);
        if (resp.result?.result?.value === 'complete') {
          done('complete');
        }
      } catch { /* 忽略 */ }
    }, 500);
  });
}

// --- 读取 POST body ---
async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

// --- HTTP API ---
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const q = Object.fromEntries(parsed.searchParams);
  if (q.target) touchTab(q.target);

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // /health 不需要连接 Chrome
    if (pathname === '/health') {
      const connected = ws && (ws.readyState === WS.OPEN || ws.readyState === 1);
      res.end(JSON.stringify({ status: 'ok', connected, sessions: sessions.size, managedTabs: managedTabs.size, chromePort }));
      return;
    }

    await connect();

    // GET /targets - 列出所有页面
    if (pathname === '/targets') {
      const resp = await sendCDP('Target.getTargets');
      const pages = resp.result.targetInfos.filter(t => t.type === 'page');
      res.end(JSON.stringify(pages, null, 2));
    }

    // GET /new?url=xxx - 创建新后台 tab
    else if (pathname === '/new') {
      const targetUrl = q.url || 'about:blank';
      const resp = await sendCDP('Target.createTarget', { url: targetUrl, background: true });
      const targetId = resp.result.targetId;
      managedTabs.set(targetId, { lastAccessed: Date.now() });

      // 等待页面加载
      if (targetUrl !== 'about:blank') {
        try {
          const sid = await ensureSession(targetId);
          await waitForLoad(sid);
        } catch { /* 非致命，继续 */ }
      }

      res.end(JSON.stringify({ targetId }));
    }

    // GET /close?target=xxx - 关闭 tab
    else if (pathname === '/close') {
      const resp = await sendCDP('Target.closeTarget', { targetId: q.target });
      sessions.delete(q.target);
      managedTabs.delete(q.target);
      res.end(JSON.stringify(resp.result));
    }

    // GET /navigate?target=xxx&url=yyy&hard_reload=true - 导航（自动等待加载）
    else if (pathname === '/navigate') {
      const sid = await ensureSession(q.target);
      const hardReload = q.hard_reload === 'true' || q.hard_reload === '1';
      let resp;
      if (hardReload) {
        // 先无缓存 reload，然后再 navigate（如果 url 与当前不同会再走一次）
        await sendCDP('Page.reload', { ignoreCache: true }, sid);
      }
      if (q.url) {
        resp = await sendCDP('Page.navigate', { url: q.url }, sid);
      } else if (!hardReload) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '需要 ?url= 或 ?hard_reload=true' }));
        return;
      }

      // 等待页面加载完成
      await waitForLoad(sid);

      res.end(JSON.stringify(resp?.result || { reloaded: true }));
    }

    // GET /back?target=xxx - 后退
    else if (pathname === '/back') {
      const sid = await ensureSession(q.target);
      await sendCDP('Runtime.evaluate', { expression: 'history.back()' }, sid);
      await waitForLoad(sid);
      res.end(JSON.stringify({ ok: true }));
    }

    // POST /eval?target=xxx - 执行 JS
    else if (pathname === '/eval') {
      const sid = await ensureSession(q.target);
      const body = await readBody(req);
      const expr = body || q.expr || 'document.title';
      const resp = await sendCDP('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
        replMode: true, // DevTools-console semantics: bare top-level `await` works without an async IIFE
      }, sid);
      if (resp.result?.result?.value !== undefined) {
        res.end(JSON.stringify({ value: resp.result.result.value }));
      } else if (resp.result?.exceptionDetails) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: resp.result.exceptionDetails.text }));
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    // POST /click?target=xxx - 点击（body 为 CSS 选择器）
    // POST /click?target=xxx — JS 层面点击（简单快速，覆盖大多数场景）
    else if (pathname === '/click') {
      const sid = await ensureSession(q.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'POST body 需要 CSS 选择器' }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const js = `(() => {
        const el = document.querySelector(${selectorJson});
        if (!el) return { error: '未找到元素: ' + ${selectorJson} };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { clicked: true, tag: el.tagName, text: (el.textContent || '').slice(0, 100) };
      })()`;
      const resp = await sendCDP('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      if (resp.result?.result?.value) {
        const val = resp.result.result.value;
        if (val.error) {
          res.statusCode = 400;
          res.end(JSON.stringify(val));
        } else {
          res.end(JSON.stringify(val));
        }
      } else {
        res.end(JSON.stringify(resp.result));
      }
    }

    // POST /clickAt?target=xxx[&visible=true&nth=2&text=xxx] — CDP 浏览器级真实鼠标点击
    // visible=true 只挑可见匹配；nth 选第 N 个（0 起）；text 进一步要求 innerText 包含子串
    else if (pathname === '/clickAt') {
      const sid = await ensureSession(q.target);
      const selector = await readBody(req);
      if (!selector) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'POST body 需要 CSS 选择器' }));
        return;
      }
      const selectorJson = JSON.stringify(selector);
      const visibleOnly = q.visible === 'true' || q.visible === '1';
      const nth = q.nth ? parseInt(q.nth) : 0;
      const textFilter = q.text ? JSON.stringify(q.text) : 'null';
      const js = `(() => {
        const all = Array.from(document.querySelectorAll(${selectorJson}));
        const filtered = all.filter(el => {
          if (${visibleOnly}) {
            if (el.offsetParent === null) return false;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') return false;
          }
          if (${textFilter}) {
            const t = (el.innerText || el.textContent || '');
            if (!t.includes(${textFilter})) return false;
          }
          return true;
        });
        if (!filtered.length) return { error: '未找到匹配元素', total_matches: all.length };
        const el = filtered[${nth}] || filtered[0];
        el.scrollIntoView({ block: 'center' });
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: el.tagName, text: (el.textContent || '').slice(0, 100), match_index: ${nth}, total_matches: filtered.length };
      })()`;
      const coordResp = await sendCDP('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }, sid);
      const coord = coordResp.result?.result?.value;
      if (!coord || coord.error) {
        res.statusCode = 400;
        res.end(JSON.stringify(coord || coordResp.result));
        return;
      }
      await sendCDP('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: coord.x, y: coord.y, button: 'left', clickCount: 1
      }, sid);
      await sendCDP('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: coord.x, y: coord.y, button: 'left', clickCount: 1
      }, sid);
      res.end(JSON.stringify({ clicked: true, x: coord.x, y: coord.y, tag: coord.tag, text: coord.text }));
    }

    // POST /setFiles?target=xxx — 给 file input 设置本地文件（绕过文件对话框）
    // body: JSON { "selector": "input[type=file]", "files": ["/path/to/file1.png", "/path/to/file2.png"] }
    else if (pathname === '/setFiles') {
      const sid = await ensureSession(q.target);
      const body = JSON.parse(await readBody(req));
      if (!body.selector || !body.files) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '需要 selector 和 files 字段' }));
        return;
      }
      // 获取 DOM 节点
      await sendCDP('DOM.enable', {}, sid);
      const doc = await sendCDP('DOM.getDocument', {}, sid);
      const node = await sendCDP('DOM.querySelector', {
        nodeId: doc.result.root.nodeId,
        selector: body.selector
      }, sid);
      if (!node.result?.nodeId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '未找到元素: ' + body.selector }));
        return;
      }
      // 设置文件
      await sendCDP('DOM.setFileInputFiles', {
        nodeId: node.result.nodeId,
        files: body.files
      }, sid);
      res.end(JSON.stringify({ success: true, files: body.files.length }));
    }

    // GET /scroll?target=xxx&y=3000 - 滚动
    else if (pathname === '/scroll') {
      const sid = await ensureSession(q.target);
      const y = parseInt(q.y || '3000');
      const direction = q.direction || 'down'; // down | up | top | bottom
      let js;
      if (direction === 'top') {
        js = 'window.scrollTo(0, 0); "scrolled to top"';
      } else if (direction === 'bottom') {
        js = 'window.scrollTo(0, document.body.scrollHeight); "scrolled to bottom"';
      } else if (direction === 'up') {
        js = `window.scrollBy(0, -${Math.abs(y)}); "scrolled up ${Math.abs(y)}px"`;
      } else {
        js = `window.scrollBy(0, ${Math.abs(y)}); "scrolled down ${Math.abs(y)}px"`;
      }
      const resp = await sendCDP('Runtime.evaluate', {
        expression: js,
        returnByValue: true,
      }, sid);
      // 等待懒加载触发
      await new Promise(r => setTimeout(r, 800));
      res.end(JSON.stringify({ value: resp.result?.result?.value }));
    }

    // GET /screenshot?target=xxx&file=/tmp/x.png&format=png&full=true - 截图（带自动重试）
    else if (pathname === '/screenshot') {
      const sid = await ensureSession(q.target);
      const format = q.format || 'png';
      const fullPage = q.full === 'true' || q.full === '1';
      const maxAttempts = parseInt(q.retries || '2') + 1;
      let lastErr = null;
      let data = null;
      for (let i = 0; i < maxAttempts; i++) {
        try {
          const resp = await sendCDP('Page.captureScreenshot', {
            format,
            quality: format === 'jpeg' ? 80 : undefined,
            captureBeyondViewport: fullPage,
          }, sid);
          data = resp.result?.data;
          if (data) break;
        } catch (e) {
          lastErr = e;
          if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
      }
      if (!data) {
        res.statusCode = 504;
        res.end(JSON.stringify({ error: lastErr?.message || 'screenshot failed', attempts: maxAttempts }));
        return;
      }
      if (q.file) {
        fs.writeFileSync(q.file, Buffer.from(data, 'base64'));
        res.end(JSON.stringify({ saved: q.file }));
      } else {
        res.setHeader('Content-Type', 'image/' + format);
        res.end(Buffer.from(data, 'base64'));
      }
    }

    // ===== Network domain =================================================

    // GET/POST /network/enable?target=ID&body=true — 启用网络抓取
    else if (pathname === '/network/enable') {
      const sid = await ensureSession(q.target);
      const captureBody = q.body === 'true' || q.body === '1';
      const state = await enableNetworkCapture(sid, { captureBody });
      res.end(JSON.stringify({ enabled: true, captureBody: state.captureBody, buffered: state.events.length }));
    }

    // GET /network/disable?target=ID
    else if (pathname === '/network/disable') {
      const sid = await ensureSession(q.target);
      await disableNetworkCapture(sid);
      res.end(JSON.stringify({ enabled: false }));
    }

    // GET /network/clear?target=ID — 清空缓冲
    else if (pathname === '/network/clear') {
      const sid = await ensureSession(q.target);
      const state = getNetworkState(sid);
      state.events.length = 0;
      state.byRequestId.clear();
      state.nextSeq = 1;
      res.end(JSON.stringify({ cleared: true }));
    }

    // GET /network/events?target=ID&since=N&url_contains=&url_pattern=&method=POST&status=200&include_body=true&limit=200
    else if (pathname === '/network/events') {
      const sid = await ensureSession(q.target);
      const state = getNetworkState(sid);
      const since = q.since ? parseInt(q.since) : 0;
      const limit = q.limit ? parseInt(q.limit) : 200;
      const include_body = q.include_body !== 'false';
      const match = compileMatch(q);
      const filtered = state.events.filter(e => e.seq > since && match(e));
      const slice = filtered.slice(-limit).map(e => summarizeEvent(e, { include_body }));
      const lastSeq = state.events.length ? state.events[state.events.length - 1].seq : 0;
      res.end(JSON.stringify({
        enabled: state.enabled,
        captureBody: state.captureBody,
        total: state.events.length,
        lastSeq,
        returned: slice.length,
        events: slice,
      }));
    }

    // GET /network/body?target=ID&seq=N  - 按需取一条响应体（即使 enable 时没开 body）
    else if (pathname === '/network/body') {
      const sid = await ensureSession(q.target);
      const state = getNetworkState(sid);
      const seq = parseInt(q.seq || '0');
      const ev = state.events.find(e => e.seq === seq);
      if (!ev) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return; }
      if (ev.responseBody != null) {
        res.end(JSON.stringify({ seq, body: ev.responseBody, base64Encoded: !!ev.responseBodyBase64 }));
        return;
      }
      const got = await fetchResponseBody(sid, ev.requestId);
      if (got) {
        ev.responseBody = got.body;
        ev.responseBodyBase64 = got.base64Encoded;
        res.end(JSON.stringify({ seq, body: got.body, base64Encoded: !!got.base64Encoded }));
      } else {
        res.statusCode = 410;
        res.end(JSON.stringify({ error: 'response body unavailable (cached / non-text / expired)' }));
      }
    }

    // GET /network/wait?target=ID&url_contains=&url_pattern=&method=&status=&timeout=30000&include_body=true
    else if (pathname === '/network/wait') {
      const sid = await ensureSession(q.target);
      const existingState = networkCaptures.get(sid);
      const state = await enableNetworkCapture(sid, {
        captureBody: q.body === 'true' || !!(existingState && existingState.captureBody),
      });
      const timeout = parseInt(q.timeout || '30000');
      const match = compileMatch(q);
      const since = q.since ? parseInt(q.since) : 0;

      // 先扫已有缓冲（completed 的）
      const consumed = new Set();
      const existing = state.events.find(e => e.seq > since && e.completed && match(e));
      if (existing) {
        consumed.add(existing.seq);
        res.end(JSON.stringify({ matched: true, event: summarizeEvent(existing, { include_body: q.include_body !== 'false' }) }));
        return;
      }
      // 否则挂等待
      const waiter = {
        consumed,
        match: (e) => e.seq > since && e.completed && match(e),
        resolve: (hit) => {
          if (hit && hit.aborted) {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: 'network capture disabled while waiting' }));
            return;
          }
          res.end(JSON.stringify({ matched: true, event: summarizeEvent(hit, { include_body: q.include_body !== 'false' }) }));
        },
        timer: setTimeout(() => {
          state.waiters = state.waiters.filter(w => w !== waiter);
          res.statusCode = 408;
          res.end(JSON.stringify({ matched: false, error: 'timeout', timeout_ms: timeout }));
        }, timeout),
      };
      state.waiters.push(waiter);
      req.on('close', () => {
        if (state.waiters.includes(waiter)) {
          state.waiters = state.waiters.filter(w => w !== waiter);
          clearTimeout(waiter.timer);
        }
      });
    }

    // ===== Wait primitives ================================================

    // GET /wait?target=ID&selector=...&visible=true&timeout=10000
    // POST /wait?target=ID&timeout=10000 body=任意 JS 表达式 — 阻塞直到 truthy
    else if (pathname === '/wait') {
      const sid = await ensureSession(q.target);
      const timeout = parseInt(q.timeout || '10000');
      const interval = parseInt(q.interval || '200');
      const deadline = Date.now() + timeout;
      const visibility = q.visible === 'false' ? '' : '&& (el.offsetParent !== null || el.getBoundingClientRect().width > 0)';

      let expr;
      if (q.selector) {
        const sel = JSON.stringify(q.selector);
        expr = `(() => { const el = document.querySelector(${sel}); return !!(el ${visibility}); })()`;
      } else {
        const body = await readBody(req);
        if (!body) { res.statusCode = 400; res.end(JSON.stringify({ error: '需要 ?selector= 或 POST body=JS 表达式' })); return; }
        expr = `(() => { try { return !!(${body}); } catch(e) { return false; } })()`;
      }

      while (true) {
        const r = await sendCDP('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
        if (r.result?.result?.value === true) {
          res.end(JSON.stringify({ matched: true, waited_ms: timeout - Math.max(0, deadline - Date.now()) }));
          return;
        }
        if (Date.now() > deadline) {
          res.statusCode = 408;
          res.end(JSON.stringify({ matched: false, error: 'timeout' }));
          return;
        }
        await new Promise(r => setTimeout(r, interval));
      }
    }

    // ===== Console capture ================================================

    // GET /console/enable?target=ID
    else if (pathname === '/console/enable') {
      const sid = await ensureSession(q.target);
      const state = await enableConsoleCapture(sid);
      res.end(JSON.stringify({ enabled: true, buffered: state.events.length }));
    }

    // GET /console/clear?target=ID
    else if (pathname === '/console/clear') {
      const sid = await ensureSession(q.target);
      const state = getConsoleState(sid);
      state.events.length = 0;
      state.nextSeq = 1;
      res.end(JSON.stringify({ cleared: true }));
    }

    // GET /console?target=ID&since=N&level=error&contains=...&limit=200
    else if (pathname === '/console') {
      const sid = await ensureSession(q.target);
      const state = getConsoleState(sid);
      const since = q.since ? parseInt(q.since) : 0;
      const limit = q.limit ? parseInt(q.limit) : 200;
      const wantedLevel = q.level;
      const contains = q.contains;
      const out = state.events.filter(e =>
        e.seq > since
        && (!wantedLevel || (e.level || '').toLowerCase() === wantedLevel.toLowerCase())
        && (!contains || JSON.stringify(e).includes(contains))
      ).slice(-limit);
      const lastSeq = state.events.length ? state.events[state.events.length - 1].seq : 0;
      res.end(JSON.stringify({ enabled: state.enabled, total: state.events.length, lastSeq, returned: out.length, events: out }));
    }

    // ===== Storage helpers ================================================

    // GET /cookies?target=ID&name=usertoken
    else if (pathname === '/cookies' && req.method === 'GET') {
      const sid = await ensureSession(q.target);
      // urls 留空 -> 当前 frame 的所有 cookie
      const r = await sendCDP('Network.getCookies', q.url ? { urls: [q.url] } : {}, sid);
      let cookies = r.result?.cookies || [];
      if (q.name) cookies = cookies.filter(c => c.name === q.name);
      res.end(JSON.stringify({ cookies }));
    }

    // POST /cookies?target=ID  body: [{name, value, domain, path, ...}]
    else if (pathname === '/cookies' && req.method === 'POST') {
      const sid = await ensureSession(q.target);
      const arr = JSON.parse(await readBody(req));
      const cookies = Array.isArray(arr) ? arr : [arr];
      await sendCDP('Network.setCookies', { cookies }, sid);
      res.end(JSON.stringify({ set: cookies.length }));
    }

    // GET /localStorage?target=ID&key=foo
    else if (pathname === '/localStorage' && req.method === 'GET') {
      const sid = await ensureSession(q.target);
      const js = q.key
        ? `JSON.stringify({ value: localStorage.getItem(${JSON.stringify(q.key)}) })`
        : `JSON.stringify({ items: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])) })`;
      const r = await sendCDP('Runtime.evaluate', { expression: js, returnByValue: true }, sid);
      res.end(r.result?.result?.value || '{}');
    }

    // POST /localStorage?target=ID  body: {key:value, ...} (sets each), or {key, value} single
    else if (pathname === '/localStorage' && req.method === 'POST') {
      const sid = await ensureSession(q.target);
      const body = JSON.parse(await readBody(req));
      const pairs = ('key' in body && 'value' in body) ? { [body.key]: body.value } : body;
      const js = `(() => { const m = ${JSON.stringify(pairs)}; for (const [k,v] of Object.entries(m)) localStorage.setItem(k, v == null ? '' : (typeof v === 'string' ? v : JSON.stringify(v))); return Object.keys(m).length; })()`;
      const r = await sendCDP('Runtime.evaluate', { expression: js, returnByValue: true }, sid);
      res.end(JSON.stringify({ set: r.result?.result?.value || 0 }));
    }

    // ===== DOM helpers ====================================================

    // GET /text?target=ID&selector=...
    else if (pathname === '/text') {
      const sid = await ensureSession(q.target);
      if (!q.selector) { res.statusCode = 400; res.end(JSON.stringify({ error: '需要 selector' })); return; }
      const sel = JSON.stringify(q.selector);
      const js = `(() => { const el = document.querySelector(${sel}); if (!el) return null; return { text: (el.innerText || el.textContent || '').slice(0, 8000), value: el.value }; })()`;
      const r = await sendCDP('Runtime.evaluate', { expression: js, returnByValue: true }, sid);
      const val = r.result?.result?.value;
      if (val == null) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found', selector: q.selector })); return; }
      res.end(JSON.stringify(val));
    }

    // GET /attribute?target=ID&selector=...&name=href
    else if (pathname === '/attribute') {
      const sid = await ensureSession(q.target);
      if (!q.selector || !q.name) { res.statusCode = 400; res.end(JSON.stringify({ error: '需要 selector 和 name' })); return; }
      const sel = JSON.stringify(q.selector);
      const name = JSON.stringify(q.name);
      const js = `(() => { const el = document.querySelector(${sel}); if (!el) return null; return el.getAttribute(${name}); })()`;
      const r = await sendCDP('Runtime.evaluate', { expression: js, returnByValue: true }, sid);
      const val = r.result?.result?.value;
      if (val == null) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found or no such attribute' })); return; }
      res.end(JSON.stringify({ value: val }));
    }

    // ===== Resources ======================================================

    // GET /resources?target=ID&type=script|stylesheet|image|font|xhr|fetch|...&contains=...
    else if (pathname === '/resources') {
      const sid = await ensureSession(q.target);
      // PerformanceResourceTiming.initiatorType: link, script, img, css, fetch, xmlhttprequest, navigation, ...
      // Special: ?type=wasm filters by URL ending in .wasm
      const wantedType = q.type;
      const contains = q.contains;
      const js = `(() => {
        const e = performance.getEntriesByType("resource");
        return e.map(x => ({name: x.name, type: x.initiatorType, dur: Math.round(x.duration), size: x.transferSize, t: Math.round(x.startTime)}));
      })()`;
      const r = await sendCDP('Runtime.evaluate', { expression: js, returnByValue: true }, sid);
      let items = r.result?.result?.value || [];
      if (wantedType === 'wasm') {
        items = items.filter(it => /\.wasm(\?|$)/.test(it.name));
      } else if (wantedType) {
        items = items.filter(it => it.type === wantedType);
      }
      if (contains) items = items.filter(it => it.name.includes(contains));
      res.end(JSON.stringify({ total: items.length, items }));
    }

    // ===== iframe enumeration =============================================

    // GET /iframes?target=ID  - 列出页面的子 frame（包括 iframe），返回各自 targetId/url 以便 attach
    else if (pathname === '/iframes') {
      await ensureSession(q.target);
      const resp = await sendCDP('Target.getTargets');
      const all = resp.result?.targetInfos || [];
      // iframe-type targets list their parent via openerFrameId in some Chrome versions;
      // when not available, return all iframe targets — caller can filter by URL.
      const frames = all.filter(t => t.type === 'iframe');
      res.end(JSON.stringify(frames));
    }

    // GET /info?target=xxx - 获取页面信息
    else if (pathname === '/info') {
      const sid = await ensureSession(q.target);
      const resp = await sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify({title: document.title, url: location.href, ready: document.readyState})',
        returnByValue: true,
      }, sid);
      res.end(resp.result?.result?.value || '{}');
    }

    // ===== Browser-QA parity endpoints (fork additions) ==================

    // GET /snapshot?target=&mode=i|C|D — 序列化交互式 DOM 树
    //   mode=i (默认) 仅交互元素；mode=C 追加非 ARIA 可点元素；mode=D 对上次快照做增量 diff。
    //   每次调用都会把当前树写入 per-targetId 基线，供后续 -D 比较（进程内存，重启丢失）。
    else if (pathname === '/snapshot') {
      const sid = await ensureSession(q.target);
      const mode = q.mode || 'i';
      const includeClickables = mode === 'C';
      const walker = `(() => {
        const INTERACTIVE_TAGS = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY','OPTION']);
        const isVisible = (el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          const s = getComputedStyle(el);
          return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
        };
        const roleOf = (el) => {
          const explicit = el.getAttribute('role');
          if (explicit) return explicit;
          const tag = el.tagName;
          if (tag === 'A') return el.hasAttribute('href') ? 'link' : 'generic';
          if (tag === 'BUTTON') return 'button';
          if (tag === 'SELECT') return 'combobox';
          if (tag === 'TEXTAREA') return 'textbox';
          if (tag === 'INPUT') {
            const t = (el.getAttribute('type') || 'text').toLowerCase();
            if (t === 'checkbox') return 'checkbox';
            if (t === 'radio') return 'radio';
            if (t === 'button' || t === 'submit' || t === 'reset') return 'button';
            if (t === 'range') return 'slider';
            return 'textbox';
          }
          return 'generic';
        };
        const nameOf = (el) => {
          const aria = el.getAttribute('aria-label');
          if (aria) return aria.trim();
          if (el.tagName === 'INPUT') {
            return (el.getAttribute('placeholder') || el.value || el.getAttribute('name') || '').trim();
          }
          const txt = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
          return txt.slice(0, 120);
        };
        const isNonAriaClickable = (el) => {
          if (getComputedStyle(el).cursor === 'pointer') return true;
          if (el.hasAttribute('onclick')) return true;
          const ti = el.getAttribute('tabindex');
          if (ti != null && ti !== '-1') return true;
          return false;
        };
        const includeClickables = ${includeClickables};
        const out = [];
        let ei = 0, ci = 0;
        for (const el of document.querySelectorAll('*')) {
          if (!isVisible(el)) continue;
          const tag = el.tagName;
          const ti = el.getAttribute('tabindex');
          const interactive = INTERACTIVE_TAGS.has(tag) || el.hasAttribute('role') || el.hasAttribute('onclick') || (ti != null && ti !== '-1');
          if (interactive) {
            out.push({ ref: '@e' + (++ei), role: roleOf(el), name: nameOf(el), tag: tag.toLowerCase() });
          } else if (includeClickables && isNonAriaClickable(el)) {
            out.push({ ref: '@c' + (++ci), role: 'clickable', name: nameOf(el), tag: tag.toLowerCase() });
          }
        }
        return out;
      })()`;
      const r = await sendCDP('Runtime.evaluate', { expression: walker, returnByValue: true }, sid);
      const tree = r.result?.result?.value || [];
      const key = (n) => n.role + '|' + n.name + '|' + n.tag;
      if (mode === 'D') {
        const baseline = snapshotBaselines.get(q.target) || [];
        const baseKeys = new Set(baseline.map(key));
        const curKeys = new Set(tree.map(key));
        const added = tree.filter(n => !baseKeys.has(key(n)));
        const removed = baseline.filter(n => !curKeys.has(key(n)));
        snapshotBaselines.set(q.target, tree);
        res.end(JSON.stringify({ mode: 'D', added, removed, changed: added.length + removed.length, unchanged: tree.length - added.length, total: tree.length }));
      } else {
        snapshotBaselines.set(q.target, tree);
        res.end(JSON.stringify({ mode, total: tree.length, elements: tree }));
      }
    }

    // GET /perf?target=[&activate=true] — 页面性能指标（FCP/LCP/CLS + longtask + 导航/资源计时）
    //   LCP 走 buffered PerformanceObserver（getEntriesByType('largest-contentful-paint') 按规范恒空）；
    //   fp/fcp 读 getEntriesByType('paint')。始终返回 visibility；后台 tab 未渲染时 paint 为 null 并附 note。
    //   activate=true（opt-in）先 Target.activateTarget 提前台、等 ~1200ms 让 paint 发生再采样；默认不改焦点，
    //   且不自动切回原前台 tab（CDP 无可靠的"当前前台 tab"信号 — 见 design Open Question 1）。
    else if (pathname === '/perf') {
      const sid = await ensureSession(q.target);
      const activate = q.activate === 'true' || q.activate === '1';
      if (activate) {
        try { await sendCDP('Target.activateTarget', { targetId: q.target }); } catch { /* best-effort foreground */ }
        await new Promise((r) => setTimeout(r, 1200));
      }
      const js = `(async () => {
        // LCP：buffered PerformanceObserver 交付曾记录的 LCP；无渲染则 400ms 后回退 null。
        const lcp = await new Promise((resolve) => {
          let done = false;
          let po = null;
          const finish = (v) => { if (!done) { done = true; try { po?.disconnect(); } catch {} resolve(v); } };
          try {
            po = new PerformanceObserver((list) => {
              const entries = list.getEntries();
              if (entries.length) finish(Math.round(entries[entries.length - 1].startTime));
            });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => finish(null), 400);
          } catch { finish(null); }
        });
        const paint = {};
        for (const e of performance.getEntriesByType('paint')) paint[e.name] = Math.round(e.startTime);
        let cls = 0;
        try { for (const e of performance.getEntriesByType('layout-shift')) { if (!e.hadRecentInput) cls += e.value; } } catch {}
        let longTasks = [];
        try { longTasks = performance.getEntriesByType('longtask').map(e => ({ start: Math.round(e.startTime), dur: Math.round(e.duration) })); } catch {}
        const nav = performance.getEntriesByType('navigation')[0];
        const navTiming = nav ? {
          ttfb: Math.round(nav.responseStart),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd),
          transferSize: nav.transferSize,
        } : null;
        const resources = performance.getEntriesByType('resource');
        const byType = {};
        let transferBytes = 0;
        for (const r of resources) { byType[r.initiatorType] = (byType[r.initiatorType] || 0) + 1; transferBytes += (r.transferSize || 0); }
        const fp = paint['first-paint'] ?? null;
        const fcp = paint['first-contentful-paint'] ?? null;
        const visibility = document.visibilityState;
        const out = {
          fp,
          fcp,
          lcp,
          cls: Math.round(cls * 1000) / 1000,
          longTasks: { count: longTasks.length, tasks: longTasks.slice(0, 20) },
          navTiming,
          resources: { count: resources.length, byType, transferBytes },
          visibility,
        };
        if (fp === null && fcp === null && lcp === null && visibility !== 'visible') {
          out.note = 'background tab not rendered; paint/LCP null — pass ?activate=true to force a foreground sample';
        }
        return out;
      })()`;
      const r = await sendCDP('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true }, sid);
      res.end(JSON.stringify(r.result?.result?.value || {}));
    }

    // GET /viewport?target=&width=&height=&scale=&mobile= — 设备视口模拟（不改真实窗口）
    else if (pathname === '/viewport') {
      const sid = await ensureSession(q.target);
      const width = parseInt(q.width || '0', 10);
      const height = parseInt(q.height || '0', 10);
      if (!width || !height) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: '需要 ?width= 与 ?height=' }));
        return;
      }
      const deviceScaleFactor = parseFloat(q.scale || '1') || 1;
      const mobile = q.mobile === 'true' || q.mobile === '1';
      // Emulation.setDeviceMetricsOverride 仅改渲染视口，不触动 OS 窗口尺寸。
      await sendCDP('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile }, sid);
      res.end(JSON.stringify({ applied: { width, height, deviceScaleFactor, mobile } }));
    }

    // GET /responsive?target=&screenshot=true&dir= — 跨断点模拟（可选每断点截图）
    //   依次对 mobile/tablet/desktop 施加 setDeviceMetricsOverride；override 会残留在 tab 上，
    //   调用方通过 /viewport 复位或关闭 tab 清除（chrome-use 用一次性 /new tab，泄漏有界）。
    else if (pathname === '/responsive') {
      const sid = await ensureSession(q.target);
      const breakpoints = [
        { name: 'mobile', width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
        { name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
        { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      ];
      const wantShots = q.screenshot === 'true' || q.screenshot === '1';
      const dir = q.dir;
      const results = [];
      for (const bp of breakpoints) {
        await sendCDP('Emulation.setDeviceMetricsOverride', {
          width: bp.width, height: bp.height, deviceScaleFactor: bp.deviceScaleFactor, mobile: bp.mobile,
        }, sid);
        const entry = { breakpoint: bp.name, width: bp.width, height: bp.height };
        if (wantShots) {
          try {
            const shot = await sendCDP('Page.captureScreenshot', { format: 'png' }, sid);
            const data = shot.result?.data;
            if (data && dir) {
              const file = path.join(dir, `responsive-${bp.name}.png`);
              fs.writeFileSync(file, Buffer.from(data, 'base64'));
              entry.screenshot = file;
            } else if (data) {
              entry.screenshotBytes = Buffer.from(data, 'base64').length;
            }
          } catch (e) { entry.screenshotError = e.message; }
        }
        results.push(entry);
      }
      res.end(JSON.stringify({ breakpoints: results, note: 'Emulation override left on tab; reset via /viewport or close the tab.' }));
    }

    else {
      res.statusCode = 404;
      res.end(JSON.stringify({
        error: '未知端点',
        endpoints: {
          // basics
          '/health': 'GET - 健康检查',
          '/targets': 'GET - 列出所有页面 tab',
          '/new?url=': 'GET - 创建新后台 tab（自动等待加载）',
          '/close?target=': 'GET - 关闭 tab',
          '/navigate?target=&url=&hard_reload=true': 'GET - 导航（自动等待加载，hard_reload 走 Page.reload ignoreCache）',
          '/back?target=': 'GET - 后退',
          '/info?target=': 'GET - 页面标题/URL/状态',
          '/eval?target=': 'POST body=JS表达式 - 执行 JS（支持 await）',
          // 点击 / 输入 / 滚动 / 截图
          '/click?target=': 'POST body=CSS选择器 - JS 层 click()',
          '/clickAt?target=&visible=true&nth=N&text=...': 'POST body=CSS选择器 - 真实鼠标点击，可筛可见性/索引/文本',
          '/setFiles?target=': 'POST JSON {selector, files[]} - 给 file input 直接灌路径',
          '/scroll?target=&y=&direction=': 'GET - 滚动页面',
          '/screenshot?target=&file=&full=true&retries=N': 'GET - 截图（默认重试 2 次，可选 captureBeyondViewport）',
          // 网络
          '/network/enable?target=&body=true': 'GET - 启用浏览器层抓包，body=true 同时缓存响应体',
          '/network/disable?target=': 'GET - 停用并释放 waiters',
          '/network/clear?target=': 'GET - 清空抓包缓冲',
          '/network/events?target=&since=&url_contains=&url_pattern=&method=&status=&include_body=true&limit=': 'GET - 查抓包',
          '/network/body?target=&seq=': 'GET - 按需取一条响应体',
          '/network/wait?target=&url_contains=&url_pattern=&method=&status=&since=&timeout=30000&body=true': 'GET - 长轮询等待匹配请求完成',
          // 等待
          '/wait?target=&selector=&visible=true&timeout=10000': 'GET - 等待元素出现（可见）',
          '/wait?target=&timeout=10000': 'POST body=JS - 等待表达式 truthy',
          // 控制台
          '/console/enable?target=': 'GET - 启用 console / exception / Log 采集',
          '/console?target=&since=&level=&contains=&limit=': 'GET - 查日志',
          '/console/clear?target=': 'GET - 清空',
          // 存储
          '/cookies?target=&name=&url=': 'GET - 读 cookie',
          '/cookies?target=': 'POST JSON 数组 - 写 cookie（Network.setCookies）',
          '/localStorage?target=&key=': 'GET - 读 localStorage',
          '/localStorage?target=': 'POST JSON {key,value} 或 {k:v...} - 写 localStorage',
          // DOM 快捷
          '/text?target=&selector=': 'GET - 取元素 innerText（含 value）',
          '/attribute?target=&selector=&name=': 'GET - 取元素属性',
          // 资源
          '/resources?target=&type=&contains=': 'GET - 列出 PerformanceResourceTiming 条目（type=wasm 特殊筛后缀）',
          '/iframes?target=': 'GET - 列出 iframe targets（可独立 attach）',
          // 浏览器 QA（fork 新增）
          '/snapshot?target=&mode=i|C|D': 'GET - 序列化交互式 DOM 树（i 交互元素 / C 追加非 ARIA 可点 / D 对上次快照 diff）',
          '/perf?target=': 'GET - 页面性能指标（FCP/LCP/CLS + longtask + 导航/资源计时）',
          '/viewport?target=&width=&height=&scale=&mobile=': 'GET - 设备视口模拟（setDeviceMetricsOverride，不改真实窗口）',
          '/responsive?target=&screenshot=true&dir=': 'GET - 跨 mobile/tablet/desktop 断点模拟（可选每断点截图）',
        },
      }));
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
});

// 检查端口是否被占用
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => { s.close(); resolve(true); });
    s.listen(port, '127.0.0.1');
  });
}

async function main() {
  // 检查是否已有 proxy 在运行
  const available = await checkPortAvailable(PORT);
  if (!available) {
    // 验证已有实例是否健康
    try {
      const ok = await new Promise((resolve) => {
        http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d.includes('"ok"')));
        }).on('error', () => resolve(false));
      });
      if (ok) {
        console.log(`[CDP Proxy] 已有实例运行在端口 ${PORT}，退出`);
        process.exit(0);
      }
    } catch { /* 端口占用但非 proxy，继续报错 */ }
    console.error(`[CDP Proxy] 端口 ${PORT} 已被占用`);
    process.exit(1);
  }

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[CDP Proxy] 运行在 http://localhost:${PORT}`);
    // 启动时尝试连接 Chrome（非阻塞）
    connect().catch(e => console.error('[CDP Proxy] 初始连接失败:', e.message, '（将在首次请求时重试）'));
  });

  // 定时清理闲置 tab
  const cleanupTimer = setInterval(cleanupIdleTabs, CLEANUP_INTERVAL);
  cleanupTimer.unref();

  const shutdown = async (sig) => {
    console.log(`[CDP Proxy] ${sig}, cleaning up...`);
    clearInterval(cleanupTimer);
    await closeAllManagedTabs();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// 防止未捕获异常导致进程崩溃
process.on('uncaughtException', (e) => {
  console.error('[CDP Proxy] 未捕获异常:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('[CDP Proxy] 未处理拒绝:', e?.message || e);
});

main();
