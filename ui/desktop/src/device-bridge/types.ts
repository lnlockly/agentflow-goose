// Device-bridge (Mode B) — shared types.
//
// The bridge enrolls AgentFlow Desktop as a device with the AgentFlow platform
// and holds a reverse-tunnel WS so the website can dispatch tasks to the local
// goosed engine — the same engine the standalone chat UI drives (Mode A).
//
// Protocol ported from agentflow-computer-mcp/ws_client.py + auth.py. Frame
// shapes match the existing server-side /_agents/_devices/connect transport so
// the new app is wire-compatible with the daemon it replaces.

export interface DeviceAuth {
  /** Owner / user API key (af_live_… or session-scoped). */
  apiKey: string;
  /** Server-assigned device UUID. */
  deviceId: string;
  /** Long-lived secret, rotated by the server on hello_ack. */
  deviceSecret: string;
  /** One-time token for the first connect before a secret is issued. */
  enrollmentToken: string;
  /** Full wss URL of the devices transport. */
  wsUrl: string;
}

/** A connect header tuple list, mirroring auth.py build_connect_headers. */
export type ConnectHeaders = Record<string, string>;

/** Server → device frame (only the fields the bridge reads). */
export interface InboundFrame {
  type: string;
  id?: string;
  task?: string;
  tool?: string;
  scope?: Record<string, unknown> | null;
  agent_id?: string;
  task_id?: string;
  device_secret?: string;
  [k: string]: unknown;
}

/** Outcome of running one dispatched task on the local goosed. */
export interface TaskResult {
  answer: string;
  iterations: number;
  tokensUsed: number;
  costUsd: number;
}

/** Progress callback fired as goosed streams assistant/tool events. */
export type ProgressFn = (text: string) => void;

/** Runs a task on the local goosed and resolves with the final answer. */
export type TaskRunner = (
  taskId: string,
  task: string,
  scope: Record<string, unknown> | null,
  onProgress: ProgressFn,
  signal: AbortSignal
) => Promise<TaskResult>;
