// Drive the LOCAL goosed engine for a platform-dispatched task (Mode B).
//
// Same engine the standalone chat UI uses (Mode A). The bridge owns its own
// goosed session: POST /agent/start to mint a session, then POST /reply to
// stream the run. SSE frames are `data: {json}\n\n` with a `type`-tagged
// MessageEvent (Message | Finish | Error | Ping | …) — see
// crates/goose-server/src/routes/reply.rs.

import type { ProgressFn, TaskResult } from './types';

export type FetchLike = typeof fetch;

export interface DispatchOptions {
  baseUrl: string;
  secret: string;
  task: string;
  workingDir: string;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** Reuse a session id instead of starting a fresh one. */
  sessionId?: string;
}

interface GooseMessage {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface MessageEventJson {
  type: string;
  message?: GooseMessage;
  error?: string;
  reason?: string;
  token_state?: {
    total_tokens?: number;
    accumulated_total_tokens?: number;
    accumulated_cost?: number | null;
  };
}

function headers(secret: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Secret-Key': secret };
}

/** Start a goosed session and return its id. */
export async function startSession(
  baseUrl: string,
  secret: string,
  workingDir: string,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetchImpl(`${baseUrl}/agent/start`, {
    method: 'POST',
    headers: headers(secret),
    body: JSON.stringify({ working_dir: workingDir }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`agent/start failed: ${res.status} ${await safeText(res)}`);
  }
  const session = (await res.json()) as { id?: string };
  if (!session?.id) throw new Error('agent/start returned no session id');
  return session.id;
}

async function safeText(res: { text: () => Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

function userMessage(text: string): unknown {
  return {
    id: `bridge-${Date.now().toString(36)}`,
    role: 'user',
    created: Math.floor(Date.now() / 1000),
    content: [{ type: 'text', text }],
    metadata: { userVisible: true, agentVisible: true },
  };
}

function assistantText(msg: GooseMessage | undefined): string {
  if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.content)) return '';
  return msg.content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string)
    .join('');
}

/**
 * Parse one SSE buffer tail. Returns the parsed events and the unconsumed
 * remainder (a partial frame that has not yet seen its `\n\n` terminator).
 * Exported for unit testing the framing.
 */
export function parseSseChunk(buffer: string): { events: MessageEventJson[]; rest: string } {
  const events: MessageEventJson[] = [];
  let rest = buffer;
  let idx: number;
  // Frames are separated by a blank line.
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    for (const line of frame.split('\n')) {
      const trimmed = line.startsWith('data:') ? line.slice(5).trimStart() : '';
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as MessageEventJson);
      } catch {
        // Ignore non-JSON keepalive lines.
      }
    }
  }
  return { events, rest };
}

/**
 * Run a task on the local goosed and resolve with the final answer + usage.
 * Accumulates assistant text across Message events; a Finish event closes the
 * run; an Error event rejects.
 */
export async function runTaskOnGoosed(opts: DispatchOptions): Promise<TaskResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sessionId =
    opts.sessionId ??
    (await startSession(opts.baseUrl, opts.secret, opts.workingDir, fetchImpl, opts.signal));

  const res = await fetchImpl(`${opts.baseUrl}/reply`, {
    method: 'POST',
    headers: headers(opts.secret),
    body: JSON.stringify({ user_message: userMessage(opts.task), session_id: sessionId }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`reply failed: ${res.status} ${await safeText(res)}`);
  }

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let tokensUsed = 0;
  let costUsd = 0;
  let iterations = 0;
  let finished = false;
  let errorText = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    for (const ev of events) {
      if (ev.type === 'Message') {
        const text = assistantText(ev.message);
        if (text) {
          answer += text;
          iterations += 1;
          opts.onProgress?.(text);
        }
        if (ev.token_state) {
          tokensUsed = ev.token_state.accumulated_total_tokens ?? tokensUsed;
          costUsd = ev.token_state.accumulated_cost ?? costUsd;
        }
      } else if (ev.type === 'Finish') {
        if (ev.token_state) {
          tokensUsed = ev.token_state.accumulated_total_tokens ?? tokensUsed;
          costUsd = ev.token_state.accumulated_cost ?? costUsd;
        }
        finished = true;
      } else if (ev.type === 'Error') {
        errorText = ev.error ?? 'unknown goosed error';
      }
    }
    if (finished) break;
  }

  if (errorText && !answer) {
    throw new Error(`goosed run error: ${errorText}`);
  }
  return { answer: answer.trim(), iterations, tokensUsed, costUsd };
}
