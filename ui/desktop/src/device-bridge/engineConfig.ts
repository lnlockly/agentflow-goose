// Engine wiring (Phase 3): point the local goosed at the AgentFlow `flow` LLM
// gateway. Ported from the verified coder-shim recipe
// (agentflow-agents/src/coder-shim/goose-runner.ts) so the desktop engine and
// the pod coder talk to the same OpenAI-compatible facade
// `<host>/_agents/llm/v1/chat/completions`.
//
// goose's config crate reads GOOSE_PROVIDER / GOOSE_MODEL and the OpenAI
// provider reads OPENAI_HOST / OPENAI_BASE_PATH / OPENAI_API_KEY from env
// (crates/goose/src/providers/openai.rs), so this is pure env injection — no
// config.yaml write, no clobbering the user's goose config.
//
// The gateway REQUIRES an `af_live_*` key (Authorization: Bearer / x-api-key),
// which goose sends as OPENAI_API_KEY. So flow is wired only when an AgentFlow
// key is available; a keyless standalone launch keeps the user's own provider.
//
// Model is NEVER a concrete id — only the platform alias `flow` (the gateway's
// pickFlowUpstream resolves it). GOOSE_MODEL env can override the alias.

export const FLOW_GATEWAY_HOST = 'https://agentflow.website';
export const FLOW_GATEWAY_BASE_PATH = '_agents/llm/v1/chat/completions';
export const FLOW_MODEL_ALIAS = 'flow';

export interface FlowGatewayOptions {
  /** AgentFlow API key (af_live_…) — sent as the gateway bearer. */
  apiKey: string;
  /** Gateway origin. Defaults to the public host. */
  host?: string;
  /** Model alias. Defaults to env GOOSE_MODEL or `flow`. Never a concrete id. */
  model?: string;
}

/**
 * Env that makes the spawned goosed route through the `flow` gateway. Merge
 * into the `env` passed to startGoosed. GOOSE_MODE is intentionally NOT set —
 * the desktop keeps its per-session approval UX (Mode A interactive); the
 * device-bridge sets auto-approve per dispatched session for Mode B.
 */
export function buildFlowGatewayEnv(opts: FlowGatewayOptions): Record<string, string> {
  if (!opts.apiKey) throw new Error('buildFlowGatewayEnv: apiKey is required');
  const model = opts.model || process.env.GOOSE_MODEL || FLOW_MODEL_ALIAS;
  return {
    GOOSE_PROVIDER: 'openai',
    GOOSE_MODEL: model,
    OPENAI_HOST: opts.host || FLOW_GATEWAY_HOST,
    OPENAI_BASE_PATH: FLOW_GATEWAY_BASE_PATH,
    OPENAI_API_KEY: opts.apiKey,
    // Read the key from env, not the OS keyring (matches the coder-shim).
    GOOSE_DISABLE_KEYRING: 'true',
  };
}

/** True when an env map already routes goosed through the flow gateway. */
export function isFlowGatewayEnv(env: Record<string, string | undefined>): boolean {
  return (
    env.GOOSE_PROVIDER === 'openai' &&
    !!env.GOOSE_MODEL &&
    (env.OPENAI_HOST || '').includes('agentflow.website') &&
    !!env.OPENAI_API_KEY
  );
}

export interface GooseExtension {
  name: string;
  type: 'builtin' | 'stdio' | 'sse';
  /** For MCP (stdio/sse) extensions. */
  cmd?: string;
  args?: string[];
  uri?: string;
}

/**
 * The extensions the AgentFlow engine enables in BOTH modes (plan §5):
 * developer (code) + computercontroller (GUI) builtins, plus any af_* MCP
 * server passed in. Returned as a goose `extensions:` config block. The
 * desktop manages extension enablement through its own config; this builder is
 * the canonical source for that wiring (consumed in the extensions follow-up).
 */
export function buildExtensionsConfig(afExtensions: GooseExtension[] = []): string {
  const lines: string[] = ['extensions:'];
  const builtins = ['developer', 'computercontroller'];
  for (const name of builtins) {
    lines.push(`  ${name}:`, '    enabled: true', '    type: builtin', `    name: ${name}`);
  }
  for (const ext of afExtensions) {
    lines.push(`  ${ext.name}:`, '    enabled: true', `    type: ${ext.type}`, `    name: ${ext.name}`);
    if (ext.cmd) lines.push(`    cmd: ${ext.cmd}`);
    if (ext.args && ext.args.length) lines.push(`    args: [${ext.args.map((a) => JSON.stringify(a)).join(', ')}]`);
    if (ext.uri) lines.push(`    uri: ${ext.uri}`);
  }
  lines.push('');
  return lines.join('\n');
}
