// Drain tasks the platform queued while the device was offline.
// GET /_agents/me/devices/:id/queued_tasks (owner-scoped, x-api-key + device
// headers). Response is tolerated as either a bare array or { tasks: [...] }.

import type { DeviceAuth } from './types';
import { apiBase } from './auth';

export interface QueuedTask {
  id: string;
  task: string;
  scope: Record<string, unknown> | null;
}

interface RawQueuedTask {
  id?: string;
  task_id?: string;
  task?: string;
  prompt?: string;
  scope?: Record<string, unknown> | null;
}

function normalize(raw: RawQueuedTask): QueuedTask | null {
  const id = String(raw.id ?? raw.task_id ?? '').trim();
  const task = String(raw.task ?? raw.prompt ?? '').trim();
  if (!id || !task) return null;
  return { id, task, scope: raw.scope && typeof raw.scope === 'object' ? raw.scope : null };
}

/** Fetch queued tasks for this device. Returns [] on any error. */
export async function fetchQueuedTasks(
  auth: DeviceAuth,
  fetchImpl: typeof fetch = fetch
): Promise<QueuedTask[]> {
  const url = `${apiBase()}/me/devices/${encodeURIComponent(auth.deviceId)}/queued_tasks`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'x-api-key': auth.apiKey,
        'x-device-id': auth.deviceId,
        ...(auth.deviceSecret ? { 'x-device-secret': auth.deviceSecret } : {}),
      },
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  const list: RawQueuedTask[] = Array.isArray(body)
    ? (body as RawQueuedTask[])
    : Array.isArray((body as { tasks?: unknown }).tasks)
      ? ((body as { tasks: RawQueuedTask[] }).tasks)
      : [];
  return list.map(normalize).filter((t): t is QueuedTask => t !== null);
}
