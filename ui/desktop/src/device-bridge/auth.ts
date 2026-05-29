// Auth-file handling for the device bridge.
// Port of agentflow-computer-mcp/auth.py + the Auth dataclass in config.py.
// File format is identical so a device provisioned for the old daemon
// (~/.agentflow/auth.json) enrolls the new app with no migration.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConnectHeaders, DeviceAuth } from './types';

export const DEFAULT_WS_URL = 'wss://agentflow.website/_agents/_devices/connect';

/** Directory that holds auth.json + computer-scope.toml. */
export function agentflowDir(): string {
  return process.env.AGENTFLOW_DIR
    ? path.resolve(process.env.AGENTFLOW_DIR)
    : path.join(os.homedir(), '.agentflow');
}

export function authFilePath(): string {
  return path.join(agentflowDir(), 'auth.json');
}

/** Read auth.json. Returns null when the file is absent or unparseable. */
export function loadAuth(file: string = authFilePath()): DeviceAuth | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    apiKey: typeof data.api_key === 'string' ? data.api_key : '',
    deviceId: typeof data.device_id === 'string' ? data.device_id : '',
    deviceSecret: typeof data.device_secret === 'string' ? data.device_secret : '',
    enrollmentToken: typeof data.enrollment_token === 'string' ? data.enrollment_token : '',
    wsUrl: typeof data.ws_url === 'string' && data.ws_url ? data.ws_url : DEFAULT_WS_URL,
  };
}

/** Persist auth.json atomically with 0600 perms (mirrors save_auth). */
export function saveAuth(auth: DeviceAuth, file: string = authFilePath()): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    api_key: auth.apiKey,
    device_id: auth.deviceId,
    device_secret: auth.deviceSecret,
    enrollment_token: auth.enrollmentToken,
    ws_url: auth.wsUrl,
  };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/**
 * Build connect headers. Prefers the long-lived device_secret; falls back to
 * the one-time enrollment_token for the first connect. Throws when neither is
 * present (same contract as build_connect_headers).
 */
export function buildConnectHeaders(auth: DeviceAuth): ConnectHeaders {
  if (!auth.apiKey) throw new Error('missing api_key in auth.json');
  if (!auth.deviceId) throw new Error('missing device_id in auth.json');
  const headers: ConnectHeaders = {
    'x-api-key': auth.apiKey,
    'x-device-id': auth.deviceId,
  };
  if (auth.deviceSecret) {
    headers['x-device-secret'] = auth.deviceSecret;
  } else if (auth.enrollmentToken) {
    headers['x-enrollment-token'] = auth.enrollmentToken;
  } else {
    throw new Error('auth.json has neither device_secret nor enrollment_token');
  }
  return headers;
}

/** True when auth.json is enrolled enough to attempt a connect. */
export function isEnrolled(auth: DeviceAuth | null): auth is DeviceAuth {
  return !!auth && !!auth.apiKey && !!auth.deviceId && (!!auth.deviceSecret || !!auth.enrollmentToken);
}

/** REST base for owner-scoped calls (queued_tasks, scope). Mirrors server.py. */
export function apiBase(): string {
  let base = (process.env.AF_API_URL || 'https://agentflow.website').replace(/\/+$/, '');
  if (!base.endsWith('/_agents')) base += '/_agents';
  return base;
}
