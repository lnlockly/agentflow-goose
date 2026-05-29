// Reverse-tunnel WS client for the AgentFlow devices transport (Mode B).
// Port of agentflow-computer-mcp/ws_client.py — same frame protocol so the
// new app is wire-compatible with the daemon it replaces.
//
// Routed inbound frames:
//   hello_ack        → mark connected, persist a rotated device_secret
//   task_dispatch    → run the task on local goosed, emit task_complete/error
//   task_cancel      → abort the in-flight run
//   subscribe_stream / unsubscribe_stream → toggle the live-screen publisher
//   heartbeat        → liveness only

import type { ConnectHeaders, DeviceAuth, InboundFrame, TaskRunner } from './types';
import { buildConnectHeaders, saveAuth } from './auth';

export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const RECONNECT_BACKOFF_CAP_MS = 30_000;
export const WS_MAX_PAYLOAD = 16 * 1024 * 1024;

/** Minimal structural type for a WS client (global WebSocket or a mock). */
export interface WsLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
}

/** Factory matching `new WebSocket(url, { headers })`. */
export type WsFactory = (url: string, headers: ConnectHeaders) => WsLike;

export interface BridgeDeps {
  auth: DeviceAuth;
  /** Runs a dispatched task on the local goosed. */
  runner: TaskRunner;
  /** Reports the device's exposed capability/tool names in the hello frame. */
  toolNames: string[];
  /** App version string for the hello frame. */
  version: string;
  wsFactory: WsFactory;
  /** Persists rotated auth. Injectable for tests; defaults to saveAuth. */
  persistAuth?: (auth: DeviceAuth) => void;
  /** Toggle for the live-screen publisher (cabinet "watch live"). */
  onStreamSubscribe?: (subscribe: boolean) => void;
  /** Fired once per (re)connect after hello_ack — used to drain queued tasks. */
  onConnected?: () => void;
  /** Monotonic clock in ms. Injectable for tests. */
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}

interface RunningTask {
  controller: AbortController;
}

const OPEN = 1;

export class DeviceBridge {
  private ws: WsLike | null = null;
  private stopped = false;
  private handshakeCompleted = false;
  private lastRecvTs = 0;
  private backoffMs = 1_000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly running = new Map<string, RunningTask>();
  private readonly persist: (auth: DeviceAuth) => void;
  private readonly now: () => number;
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void;

  constructor(private readonly deps: BridgeDeps) {
    this.persist = deps.persistAuth ?? ((a) => saveAuth(a));
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => {});
  }

  /** Open the connection. Reconnects with capped backoff until stop(). */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    for (const t of this.running.values()) t.controller.abort();
    this.running.clear();
    if (this.ws) {
      try {
        this.ws.close(1000, 'client_stop');
      } catch {
        /* already closing */
      }
      this.ws = null;
    }
  }

  /** Send a frame if the socket is open. Never throws. */
  publish(payload: Record<string, unknown>): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      this.log('warn', `publish dropped: ${String(e)}`);
    }
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  private connect(): void {
    if (this.stopped) return;
    this.handshakeCompleted = false;
    let ws: WsLike;
    try {
      ws = this.deps.wsFactory(this.deps.auth.wsUrl, buildConnectHeaders(this.deps.auth));
    } catch (e) {
      this.log('error', `connect setup failed: ${String(e)}`);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.lastRecvTs = this.now();

    ws.onopen = () => {
      this.publish({
        type: 'hello',
        device_id: this.deps.auth.deviceId,
        version: this.deps.version,
        tools: this.deps.toolNames,
      });
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => {
      /* surfaced via onclose */
    };
    ws.onclose = () => this.onClose();
  }

  private onClose(): void {
    this.clearTimers();
    this.ws = null;
    if (this.deps.onStreamSubscribe) {
      try {
        this.deps.onStreamSubscribe(false);
      } catch {
        /* ignore */
      }
    }
    if (this.stopped) return;
    // A clean handshake before the drop = fresh failure cycle, reset backoff.
    if (this.handshakeCompleted) this.backoffMs = 1_000;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const jitter = (this.now() % 500) / 1000;
    const sleep = Math.min(this.backoffMs, RECONNECT_BACKOFF_CAP_MS) + jitter;
    this.log('info', `reconnecting in ${(sleep / 1000).toFixed(1)}s`);
    this.reconnectTimer = setTimeout(() => this.connect(), sleep);
    this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_BACKOFF_CAP_MS);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.now() - this.lastRecvTs > HEARTBEAT_TIMEOUT_MS) {
        this.log('warn', 'heartbeat timeout — closing');
        if (this.ws) this.ws.close(1011, 'heartbeat_timeout');
        return;
      }
      this.publish({ type: 'heartbeat', ts: this.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private onMessage(raw: unknown): void {
    this.lastRecvTs = this.now();
    if (typeof raw !== 'string') return;
    let msg: InboundFrame;
    try {
      msg = JSON.parse(raw) as InboundFrame;
    } catch {
      this.log('warn', 'malformed json frame');
      return;
    }
    switch (msg.type) {
      case 'heartbeat':
        return;
      case 'hello_ack':
        this.onHelloAck(msg);
        return;
      case 'task_dispatch':
        void this.onTaskDispatch(msg);
        return;
      case 'task_cancel':
        this.onTaskCancel(msg);
        return;
      case 'subscribe_stream':
        this.deps.onStreamSubscribe?.(true);
        return;
      case 'unsubscribe_stream':
        this.deps.onStreamSubscribe?.(false);
        return;
      default:
        this.log('info', `unknown frame type: ${String(msg.type)}`);
    }
  }

  private onHelloAck(msg: InboundFrame): void {
    this.handshakeCompleted = true;
    this.backoffMs = 1_000;
    const rotated = typeof msg.device_secret === 'string' ? msg.device_secret : '';
    if (rotated && rotated !== this.deps.auth.deviceSecret) {
      this.deps.auth.deviceSecret = rotated;
      this.deps.auth.enrollmentToken = '';
      try {
        this.persist(this.deps.auth);
        this.log('info', 'device_secret rotated and saved');
      } catch (e) {
        this.log('warn', `failed to persist rotated secret: ${String(e)}`);
      }
    }
    if (this.deps.onConnected) {
      try {
        this.deps.onConnected();
      } catch (e) {
        this.log('warn', `onConnected hook failed: ${String(e)}`);
      }
    }
  }

  /** True once the current connection has completed its handshake. */
  get connected(): boolean {
    return this.handshakeCompleted && this.ws?.readyState === OPEN;
  }

  /** Dispatch a task as if it arrived over the WS (used by queued-task drain). */
  dispatchExternal(taskId: string, task: string, scope: Record<string, unknown> | null): void {
    void this.onTaskDispatch({ type: 'task_dispatch', id: taskId, task, scope });
  }

  private onTaskCancel(msg: InboundFrame): void {
    const taskId = typeof msg.task_id === 'string' ? msg.task_id : '';
    if (taskId) {
      this.running.get(taskId)?.controller.abort();
      this.running.delete(taskId);
      return;
    }
    // No id → cancel everything in flight.
    for (const t of this.running.values()) t.controller.abort();
    this.running.clear();
  }

  private async onTaskDispatch(msg: InboundFrame): Promise<void> {
    const taskId = String(msg.id ?? '').trim();
    const task = String(msg.task ?? '').trim();
    const scope = msg.scope && typeof msg.scope === 'object' ? msg.scope : null;
    if (!taskId || !task) {
      this.log('warn', 'task_dispatch missing id/task');
      return;
    }
    if (this.running.has(taskId)) {
      this.log('warn', `duplicate task_dispatch ignored: ${taskId}`);
      return;
    }
    const controller = new AbortController();
    this.running.set(taskId, { controller });
    try {
      const result = await this.deps.runner(
        taskId,
        task,
        scope,
        (text) => this.publish({ type: 'task_progress', task_id: taskId, text }),
        controller.signal
      );
      this.publish({
        type: 'task_complete',
        task_id: taskId,
        answer: result.answer,
        iterations: result.iterations,
        tokens_used: result.tokensUsed,
        cost_usd: result.costUsd,
      });
    } catch (e) {
      if (controller.signal.aborted) {
        this.log('info', `task ${taskId} cancelled`);
      } else {
        this.publish({
          type: 'task_error',
          task_id: taskId,
          error: `task_failed: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    } finally {
      this.running.delete(taskId);
    }
  }
}
