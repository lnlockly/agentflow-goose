import { describe, it, expect, vi } from 'vitest';
import { DeviceBridge, type WsLike, type WsFactory, type BridgeDeps } from './wsBridge';
import type { DeviceAuth, TaskResult, TaskRunner } from './types';

class MockWs implements WsLike {
  sent: string[] = [];
  readyState = 1;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s));
  }
  deliver(obj: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const auth = (): DeviceAuth => ({
  apiKey: 'af_live',
  deviceId: 'dev-1',
  deviceSecret: 'old',
  enrollmentToken: '',
  wsUrl: 'wss://agentflow.website/_agents/_devices/connect',
});

function makeBridge(runner: TaskRunner, overrides: Partial<BridgeDeps> = {}) {
  let ws!: MockWs;
  const factory: WsFactory = () => {
    ws = new MockWs();
    return ws;
  };
  const persisted: DeviceAuth[] = [];
  const bridge = new DeviceBridge({
    auth: auth(),
    runner,
    toolNames: ['developer'],
    version: '1.0.0',
    wsFactory: factory,
    persistAuth: (a) => persisted.push({ ...a }),
    now: () => 1000,
    ...overrides,
  });
  bridge.start();
  // start() → connect() created the ws and assigned handlers.
  return { bridge, getWs: () => ws, persisted };
}

const okResult: TaskResult = { answer: 'done', iterations: 2, tokensUsed: 100, costUsd: 0.1 };

describe('DeviceBridge handshake', () => {
  it('sends hello on open', () => {
    const { getWs } = makeBridge(async () => okResult);
    getWs().onopen?.();
    const hello = getWs().frames()[0];
    expect(hello).toMatchObject({ type: 'hello', device_id: 'dev-1', version: '1.0.0', tools: ['developer'] });
  });

  it('rotates and persists device_secret on hello_ack', () => {
    const { getWs, persisted, bridge } = makeBridge(async () => okResult);
    getWs().onopen?.();
    getWs().deliver({ type: 'hello_ack', device_secret: 'new-secret' });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].deviceSecret).toBe('new-secret');
    expect(persisted[0].enrollmentToken).toBe('');
    expect(bridge.connected).toBe(true);
  });

  it('does not persist when secret is unchanged', () => {
    const { getWs, persisted } = makeBridge(async () => okResult);
    getWs().onopen?.();
    getWs().deliver({ type: 'hello_ack', device_secret: 'old' });
    expect(persisted).toHaveLength(0);
  });

  it('fires onConnected after hello_ack', () => {
    const onConnected = vi.fn();
    const { getWs } = makeBridge(async () => okResult, { onConnected });
    getWs().onopen?.();
    getWs().deliver({ type: 'hello_ack' });
    expect(onConnected).toHaveBeenCalledOnce();
  });
});

describe('DeviceBridge task dispatch', () => {
  it('runs the task and publishes task_complete', async () => {
    const runner = vi.fn(async () => okResult);
    const { getWs } = makeBridge(runner);
    getWs().onopen?.();
    getWs().deliver({ type: 'task_dispatch', id: 't1', task: 'build a thing' });
    await vi.waitFor(() => expect(getWs().frames().some((f) => f.type === 'task_complete')).toBe(true));
    const complete = getWs().frames().find((f) => f.type === 'task_complete')!;
    expect(complete).toMatchObject({ task_id: 't1', answer: 'done', tokens_used: 100, cost_usd: 0.1 });
    expect(runner).toHaveBeenCalledWith('t1', 'build a thing', null, expect.any(Function), expect.any(Object));
  });

  it('publishes task_error when the runner throws', async () => {
    const { getWs } = makeBridge(async () => {
      throw new Error('boom');
    });
    getWs().onopen?.();
    getWs().deliver({ type: 'task_dispatch', id: 't2', task: 'x' });
    await vi.waitFor(() => expect(getWs().frames().some((f) => f.type === 'task_error')).toBe(true));
    expect(getWs().frames().find((f) => f.type === 'task_error')).toMatchObject({
      task_id: 't2',
      error: expect.stringContaining('boom'),
    });
  });

  it('forwards progress as task_progress frames', async () => {
    const runner: TaskRunner = async (_id, _task, _scope, onProgress) => {
      onProgress('step 1');
      return okResult;
    };
    const { getWs } = makeBridge(runner);
    getWs().onopen?.();
    getWs().deliver({ type: 'task_dispatch', id: 't3', task: 'x' });
    await vi.waitFor(() => expect(getWs().frames().some((f) => f.type === 'task_progress')).toBe(true));
    expect(getWs().frames().find((f) => f.type === 'task_progress')).toMatchObject({
      task_id: 't3',
      text: 'step 1',
    });
  });

  it('ignores dispatch missing id/task', async () => {
    const runner = vi.fn(async () => okResult);
    const { getWs } = makeBridge(runner);
    getWs().onopen?.();
    getWs().deliver({ type: 'task_dispatch', id: '', task: '' });
    expect(runner).not.toHaveBeenCalled();
  });

  it('cancels an in-flight task on task_cancel', async () => {
    let aborted = false;
    const runner: TaskRunner = (_id, _task, _scope, _onProgress, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      });
    const { getWs } = makeBridge(runner);
    getWs().onopen?.();
    getWs().deliver({ type: 'task_dispatch', id: 't4', task: 'long' });
    getWs().deliver({ type: 'task_cancel', task_id: 't4' });
    await vi.waitFor(() => expect(aborted).toBe(true));
    // Cancelled tasks emit neither complete nor error.
    expect(getWs().frames().some((f) => f.type === 'task_error')).toBe(false);
  });
});

describe('DeviceBridge stream subscription', () => {
  it('toggles the live-screen publisher', () => {
    const onStreamSubscribe = vi.fn();
    const { getWs } = makeBridge(async () => okResult, { onStreamSubscribe });
    getWs().onopen?.();
    getWs().deliver({ type: 'subscribe_stream' });
    getWs().deliver({ type: 'unsubscribe_stream' });
    expect(onStreamSubscribe).toHaveBeenNthCalledWith(1, true);
    expect(onStreamSubscribe).toHaveBeenNthCalledWith(2, false);
  });
});
