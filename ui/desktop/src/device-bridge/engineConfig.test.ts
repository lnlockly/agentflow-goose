import { describe, it, expect, afterEach } from 'vitest';
import {
  buildFlowGatewayEnv,
  isFlowGatewayEnv,
  buildExtensionsConfig,
  FLOW_GATEWAY_HOST,
  FLOW_GATEWAY_BASE_PATH,
} from './engineConfig';

const savedModel = process.env.GOOSE_MODEL;
afterEach(() => {
  if (savedModel === undefined) delete process.env.GOOSE_MODEL;
  else process.env.GOOSE_MODEL = savedModel;
});

describe('buildFlowGatewayEnv', () => {
  it('produces the canonical flow-gateway env (alias model, public host)', () => {
    delete process.env.GOOSE_MODEL;
    const env = buildFlowGatewayEnv({ apiKey: 'af_live_abc' });
    expect(env).toEqual({
      GOOSE_PROVIDER: 'openai',
      GOOSE_MODEL: 'flow',
      OPENAI_HOST: FLOW_GATEWAY_HOST,
      OPENAI_BASE_PATH: FLOW_GATEWAY_BASE_PATH,
      OPENAI_API_KEY: 'af_live_abc',
      GOOSE_DISABLE_KEYRING: 'true',
    });
  });

  it('does NOT set GOOSE_MODE (keeps interactive approval UX)', () => {
    expect(buildFlowGatewayEnv({ apiKey: 'k' }).GOOSE_MODE).toBeUndefined();
  });

  it('honours an explicit model alias and a custom host', () => {
    const env = buildFlowGatewayEnv({ apiKey: 'k', model: 'flow-fast', host: 'https://stage.agentflow.website' });
    expect(env.GOOSE_MODEL).toBe('flow-fast');
    expect(env.OPENAI_HOST).toBe('https://stage.agentflow.website');
  });

  it('falls back to GOOSE_MODEL env when no model is passed', () => {
    process.env.GOOSE_MODEL = 'flow-pinned';
    expect(buildFlowGatewayEnv({ apiKey: 'k' }).GOOSE_MODEL).toBe('flow-pinned');
  });

  it('throws without an api key', () => {
    expect(() => buildFlowGatewayEnv({ apiKey: '' })).toThrow(/apiKey/);
  });
});

describe('isFlowGatewayEnv', () => {
  it('recognizes a configured flow env', () => {
    expect(isFlowGatewayEnv(buildFlowGatewayEnv({ apiKey: 'k' }))).toBe(true);
  });
  it('rejects an env missing the key or host', () => {
    expect(isFlowGatewayEnv({ GOOSE_PROVIDER: 'openai', GOOSE_MODEL: 'flow' })).toBe(false);
    expect(isFlowGatewayEnv({})).toBe(false);
  });
});

describe('buildExtensionsConfig', () => {
  it('always enables developer + computercontroller builtins', () => {
    const yaml = buildExtensionsConfig();
    expect(yaml).toContain('  developer:');
    expect(yaml).toContain('  computercontroller:');
    expect(yaml).toContain('    type: builtin');
  });

  it('appends an af_* MCP extension', () => {
    const yaml = buildExtensionsConfig([
      { name: 'agentflow', type: 'stdio', cmd: 'npx', args: ['-y', 'agentflow-mcp-server'] },
    ]);
    expect(yaml).toContain('  agentflow:');
    expect(yaml).toContain('    type: stdio');
    expect(yaml).toContain('    cmd: npx');
    expect(yaml).toContain('    args: ["-y", "agentflow-mcp-server"]');
  });
});
