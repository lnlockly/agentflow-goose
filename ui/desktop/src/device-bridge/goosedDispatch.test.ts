import { describe, it, expect } from 'vitest';
import { parseSseChunk, runTaskOnGoosed, type FetchLike } from './goosedDispatch';

describe('parseSseChunk', () => {
  it('extracts complete data frames and keeps the partial tail', () => {
    const { events, rest } = parseSseChunk(
      'data: {"type":"Ping"}\n\ndata: {"type":"Message","message":{}}\n\ndata: {"type":"Fin'
    );
    expect(events.map((e) => e.type)).toEqual(['Ping', 'Message']);
    expect(rest).toBe('data: {"type":"Fin');
  });

  it('ignores non-JSON keepalive lines', () => {
    const { events } = parseSseChunk(': keepalive\n\ndata: {"type":"Ping"}\n\n');
    expect(events.map((e) => e.type)).toEqual(['Ping']);
  });
});

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('runTaskOnGoosed', () => {
  it('starts a session, streams assistant text, returns answer + usage', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith('/agent/start')) {
        return new Response(JSON.stringify({ id: 'sess-1' }), { status: 200 });
      }
      if (url.endsWith('/agent/update_provider')) {
        return new Response('', { status: 200 });
      }
      // /reply
      return sseResponse([
        'data: {"type":"Message","message":{"role":"assistant","content":[{"type":"text","text":"Hello "}]}}\n\n',
        'data: {"type":"Message","message":{"role":"assistant","content":[{"type":"text","text":"world"}]},"token_state":{"accumulated_total_tokens":120,"accumulated_cost":0.0042}}\n\n',
        'data: {"type":"Finish","reason":"end_turn","token_state":{"accumulated_total_tokens":140,"accumulated_cost":0.0051}}\n\n',
      ]);
    }) as unknown as FetchLike;

    const progress: string[] = [];
    const result = await runTaskOnGoosed({
      baseUrl: 'http://127.0.0.1:9000',
      secret: 'sek',
      task: 'do it',
      workingDir: '/tmp',
      fetchImpl,
      onProgress: (t) => progress.push(t),
    });

    expect(result.answer).toBe('Hello world');
    expect(result.tokensUsed).toBe(140);
    expect(result.costUsd).toBeCloseTo(0.0051);
    expect(result.iterations).toBe(2);
    expect(progress).toEqual(['Hello ', 'world']);
    expect(calls[0]).toBe('POST http://127.0.0.1:9000/agent/start');
    expect(calls[1]).toBe('POST http://127.0.0.1:9000/agent/update_provider');
    expect(calls[2]).toBe('POST http://127.0.0.1:9000/reply');
  });

  it('reuses a provided session id (skips agent/start)', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = (async (url: string) => {
      calls.push(url);
      return sseResponse(['data: {"type":"Finish","reason":"end_turn"}\n\n']);
    }) as unknown as FetchLike;
    await runTaskOnGoosed({
      baseUrl: 'http://x',
      secret: 's',
      task: 't',
      workingDir: '/tmp',
      sessionId: 'pre-made',
      fetchImpl,
    });
    expect(calls).toEqual(['http://x/reply']);
  });

  it('throws when /reply errors with no partial answer', async () => {
    const fetchImpl: FetchLike = (async (url: string) => {
      if (url.endsWith('/agent/start')) return new Response(JSON.stringify({ id: 's' }), { status: 200 });
      return sseResponse(['data: {"type":"Error","error":"provider down"}\n\n']);
    }) as unknown as FetchLike;
    await expect(
      runTaskOnGoosed({ baseUrl: 'http://x', secret: 's', task: 't', workingDir: '/tmp', fetchImpl })
    ).rejects.toThrow(/provider down/);
  });
});
