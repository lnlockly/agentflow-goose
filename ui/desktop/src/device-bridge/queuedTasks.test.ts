import { describe, it, expect } from 'vitest';
import { fetchQueuedTasks } from './queuedTasks';
import type { DeviceAuth } from './types';

const auth: DeviceAuth = {
  apiKey: 'af_live',
  deviceId: 'dev-1',
  deviceSecret: 'sek',
  enrollmentToken: '',
  wsUrl: 'wss://x/_agents/_devices/connect',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchQueuedTasks', () => {
  it('parses a { tasks: [...] } envelope and normalizes ids/fields', async () => {
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      expect(url).toContain('/me/devices/dev-1/queued_tasks');
      expect((init?.headers as Record<string, string>)['x-device-secret']).toBe('sek');
      return jsonResponse({
        tasks: [
          { id: 'a', task: 'do a' },
          { task_id: 'b', prompt: 'do b', scope: { app: 'safari' } },
        ],
      });
    }) as unknown as typeof fetch;
    const tasks = await fetchQueuedTasks(auth, fetchImpl);
    expect(tasks).toEqual([
      { id: 'a', task: 'do a', scope: null },
      { id: 'b', task: 'do b', scope: { app: 'safari' } },
    ]);
  });

  it('accepts a bare array body', async () => {
    const fetchImpl = (async () => jsonResponse([{ id: 'x', task: 't' }])) as unknown as typeof fetch;
    expect(await fetchQueuedTasks(auth, fetchImpl)).toEqual([{ id: 'x', task: 't', scope: null }]);
  });

  it('drops entries missing id or task', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ tasks: [{ id: 'a' }, { task: 'orphan' }, { id: 'ok', task: 'go' }] })) as unknown as typeof fetch;
    expect(await fetchQueuedTasks(auth, fetchImpl)).toEqual([{ id: 'ok', task: 'go', scope: null }]);
  });

  it('returns [] on non-2xx, network error, or bad json', async () => {
    expect(await fetchQueuedTasks(auth, (async () => jsonResponse({}, 500)) as unknown as typeof fetch)).toEqual([]);
    expect(
      await fetchQueuedTasks(auth, (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch)
    ).toEqual([]);
    expect(
      await fetchQueuedTasks(auth, (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch)
    ).toEqual([]);
  });
});
