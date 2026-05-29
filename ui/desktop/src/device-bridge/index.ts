// Device-bridge entrypoint (Mode B). Wires auth → WS bridge → local goosed.
//
// Call startDeviceBridge() from the Electron main process once a goosed
// instance is reachable. It is a no-op (returns null) when the machine is not
// enrolled, so a standalone-only user (Mode A) never opens a platform tunnel.
//
// The WebSocket + fetch implementations are injected so the module stays
// dependency-free and unit-testable; in the app they default to the Electron
// main-process globals (Node 22 ships both).

import WebSocket from 'ws';
import { isEnrolled, loadAuth } from './auth';
import { runTaskOnGoosed } from './goosedDispatch';
import { fetchQueuedTasks } from './queuedTasks';
import { DeviceBridge, type WsFactory, type WsLike } from './wsBridge';
import type { TaskRunner } from './types';

export { DeviceBridge } from './wsBridge';
export * from './types';
export { loadAuth, saveAuth, isEnrolled, buildConnectHeaders, apiBase } from './auth';
export { runTaskOnGoosed, parseSseChunk } from './goosedDispatch';
export { fetchQueuedTasks } from './queuedTasks';
export * from './engineConfig';
export * from './extensionsSetup';

import { buildFlowGatewayEnv } from './engineConfig';
import { ensureAgentflowExtensions } from './extensionsSetup';
import fsSync from 'node:fs';

/**
 * Resolve the flow-gateway env from the enrolled auth.json, or null when the
 * machine has no AgentFlow key (keyless standalone → keep the user's own
 * provider). Merge the result into the `env` passed to startGoosed.
 */
export function flowGatewayEnvFromAuth(): Record<string, string> | null {
  const auth = loadAuth();
  if (!auth || !auth.apiKey) return null;
  return buildFlowGatewayEnv({ apiKey: auth.apiKey });
}

/**
 * Ensure the AgentFlow engine extensions are enabled in goose config before
 * goosed starts: computercontroller (builtin, always) + af_* MCP (only when its
 * server entrypoint resolves). af_* resolves from `AGENTFLOW_MCP_PATH` (dev) or
 * the vendored single-file bundle shipped as a forge extraResource
 * (`<resourcesPath>/agentflow-mcp/server.cjs`); absent → af_* skipped
 * (computercontroller still on). Returns the keys added; idempotent.
 */
export function ensureAgentflowEngineExtensions(resourcesPath?: string): string[] {
  const auth = loadAuth();
  const candidates = [
    process.env.AGENTFLOW_MCP_PATH,
    resourcesPath ? `${resourcesPath}/agentflow-mcp/server.cjs` : undefined,
  ].filter((p): p is string => !!p);
  const mcpServerPath = candidates.find((p) => fsSync.existsSync(p)) ?? null;
  return ensureAgentflowExtensions({
    apiKey: auth?.apiKey,
    deviceId: auth?.deviceId,
    mcpServerPath,
  });
}

/** Resolves the live goosed base URL + secret each time a task runs. */
export type GoosedProvider = () => { baseUrl: string; secret: string; workingDir: string } | null;

export interface StartBridgeOptions {
  goosed: GoosedProvider;
  version: string;
  /** Capabilities advertised in the hello frame. */
  toolNames?: string[];
  /** Defaults to the global WebSocket; supply `ws`/mock for tests. */
  wsFactory?: WsFactory;
  fetchImpl?: typeof fetch;
  onStreamSubscribe?: (subscribe: boolean) => void;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

// Adapt the `ws` socket to WsLike. `ws` honours custom connect headers (the
// browser/undici WebSocket does not) and delivers text frames as Buffer via
// the EventTarget path, so normalize message data to a string for the bridge.
const defaultWsFactory: WsFactory = (url, headers) => {
  const sock = new WebSocket(url, { headers });
  const adapter: WsLike = {
    send: (data) => sock.send(data),
    close: (code, reason) => sock.close(code, reason),
    get readyState() {
      return sock.readyState;
    },
    set onopen(fn: ((ev?: unknown) => void) | null) {
      sock.onopen = fn ? () => fn() : null;
    },
    get onopen() {
      return null;
    },
    set onmessage(fn: ((ev: { data: unknown }) => void) | null) {
      sock.onmessage = fn
        ? (ev: WebSocket.MessageEvent) => {
            const d = ev.data;
            fn({ data: typeof d === 'string' ? d : Buffer.isBuffer(d) ? d.toString('utf8') : String(d) });
          }
        : null;
    },
    get onmessage() {
      return null;
    },
    set onclose(fn: ((ev?: unknown) => void) | null) {
      sock.onclose = fn ? () => fn() : null;
    },
    get onclose() {
      return null;
    },
    set onerror(fn: ((ev?: unknown) => void) | null) {
      sock.onerror = fn ? () => fn() : null;
    },
    get onerror() {
      return null;
    },
  };
  return adapter;
};

/**
 * Start the device bridge. Returns the DeviceBridge (call .stop() on quit) or
 * null when the machine is not enrolled.
 */
export function startDeviceBridge(opts: StartBridgeOptions): DeviceBridge | null {
  const auth = loadAuth();
  if (!isEnrolled(auth)) {
    opts.log?.('info', 'device bridge skipped: ~/.agentflow/auth.json not enrolled');
    return null;
  }

  const fetchImpl = opts.fetchImpl ?? fetch;

  const runner: TaskRunner = async (_taskId, task, _scope, onProgress, signal) => {
    const g = opts.goosed();
    if (!g) throw new Error('local goosed not available');
    return runTaskOnGoosed({
      baseUrl: g.baseUrl,
      secret: g.secret,
      workingDir: g.workingDir,
      task,
      onProgress,
      signal,
      fetchImpl,
    });
  };

  const bridge = new DeviceBridge({
    auth,
    runner,
    toolNames: opts.toolNames ?? ['developer', 'computercontroller'],
    version: opts.version,
    wsFactory: opts.wsFactory ?? defaultWsFactory,
    onStreamSubscribe: opts.onStreamSubscribe,
    log: opts.log,
    onConnected: () => {
      // Drain anything queued while we were offline, then replay through the
      // same dispatch path so completion/idempotency behave identically.
      void fetchQueuedTasks(auth, fetchImpl)
        .then((tasks) => {
          if (tasks.length) opts.log?.('info', `draining ${tasks.length} queued task(s)`);
          for (const t of tasks) bridge.dispatchExternal(t.id, t.task, t.scope);
        })
        .catch((e) => opts.log?.('warn', `queued-task drain failed: ${String(e)}`));
    },
  });
  bridge.start();
  return bridge;
}
