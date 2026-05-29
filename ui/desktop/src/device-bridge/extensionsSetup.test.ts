import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  mergeAgentflowExtensions,
  ensureAgentflowExtensions,
  gooseConfigPath,
  COMPUTERCONTROLLER,
  AF_EXTENSION_KEY,
  type ConfigIO,
} from './extensionsSetup';

describe('mergeAgentflowExtensions', () => {
  it('adds computercontroller into an empty config', () => {
    const { config, added } = mergeAgentflowExtensions(null, {});
    expect(added).toEqual([COMPUTERCONTROLLER]);
    expect(config.extensions![COMPUTERCONTROLLER]).toEqual({
      enabled: true,
      type: 'builtin',
      name: COMPUTERCONTROLLER,
    });
  });

  it('adds the af_* stdio extension with envs when a server path is given', () => {
    const { config, added } = mergeAgentflowExtensions(null, {
      apiKey: 'af_live_k',
      deviceId: 'dev-1',
      mcpServerPath: '/opt/af/dist/index.js',
    });
    expect(added).toContain(AF_EXTENSION_KEY);
    expect(config.extensions![AF_EXTENSION_KEY]).toMatchObject({
      type: 'stdio',
      cmd: 'node',
      args: ['/opt/af/dist/index.js'],
      enabled: true,
      timeout: 300,
      envs: {
        AGENTFLOW_API_KEY: 'af_live_k',
        AGENTFLOW_DEVICE_ID: 'dev-1',
        AGENTFLOW_BASE_URL: 'https://agentflow.website/_agents',
      },
    });
  });

  it('skips af_* when no server path resolves (graceful until bundled)', () => {
    const { added } = mergeAgentflowExtensions(null, { apiKey: 'k' });
    expect(added).toEqual([COMPUTERCONTROLLER]);
    expect(added).not.toContain(AF_EXTENSION_KEY);
  });

  it('omits optional env keys when absent', () => {
    const { config } = mergeAgentflowExtensions(null, { mcpServerPath: '/x.js' });
    const ext = config.extensions![AF_EXTENSION_KEY] as { envs: Record<string, string> };
    expect(ext.envs.AGENTFLOW_API_KEY).toBeUndefined();
    expect(ext.envs.AGENTFLOW_DEVICE_ID).toBeUndefined();
    expect(ext.envs.AGENTFLOW_BASE_URL).toBe('https://agentflow.website/_agents');
  });

  it('never overwrites a user-set entry (respects disabled choice)', () => {
    const existing = {
      extensions: {
        [COMPUTERCONTROLLER]: { enabled: false, type: 'builtin', name: COMPUTERCONTROLLER },
        [AF_EXTENSION_KEY]: { enabled: false, type: 'stdio', cmd: 'node', args: ['/old.js'] },
      },
    };
    const { config, added } = mergeAgentflowExtensions(existing, { mcpServerPath: '/new.js' });
    expect(added).toEqual([]);
    expect((config.extensions![COMPUTERCONTROLLER] as { enabled: boolean }).enabled).toBe(false);
    expect((config.extensions![AF_EXTENSION_KEY] as { args: string[] }).args).toEqual(['/old.js']);
  });

  it('preserves unrelated config keys + other extensions', () => {
    const existing = {
      GOOSE_PROVIDER: 'openai',
      extensions: { developer: { enabled: true, type: 'builtin', name: 'developer' } },
    };
    const { config } = mergeAgentflowExtensions(existing, {});
    expect(config.GOOSE_PROVIDER).toBe('openai');
    expect(config.extensions!.developer).toBeDefined();
    expect(config.extensions![COMPUTERCONTROLLER]).toBeDefined();
  });
});

describe('ensureAgentflowExtensions (I/O)', () => {
  it('writes a merged config when something is added', () => {
    let stored: string | null = null;
    const io: ConfigIO = { read: () => stored, write: (_p, b) => (stored = b) };
    const added = ensureAgentflowExtensions({ mcpServerPath: '/x.js', apiKey: 'k' }, '/tmp/cfg.yaml', io);
    expect(added.sort()).toEqual([AF_EXTENSION_KEY, COMPUTERCONTROLLER].sort());
    const written = parseYaml(stored!);
    expect(written.extensions.computercontroller.type).toBe('builtin');
    expect(written.extensions.agentflow.cmd).toBe('node');
  });

  it('is idempotent — no write on a second pass', () => {
    let stored: string | null = null;
    let writes = 0;
    const io: ConfigIO = {
      read: () => stored,
      write: (_p, b) => {
        stored = b;
        writes += 1;
      },
    };
    ensureAgentflowExtensions({ mcpServerPath: '/x.js' }, '/tmp/cfg.yaml', io);
    ensureAgentflowExtensions({ mcpServerPath: '/x.js' }, '/tmp/cfg.yaml', io);
    expect(writes).toBe(1);
  });

  it('merges into an existing user config without clobbering', () => {
    let stored: string | null = 'GOOSE_PROVIDER: openai\nextensions:\n  developer:\n    enabled: true\n    type: builtin\n    name: developer\n';
    const io: ConfigIO = { read: () => stored, write: (_p, b) => (stored = b) };
    ensureAgentflowExtensions({}, '/tmp/cfg.yaml', io);
    const written = parseYaml(stored!);
    expect(written.GOOSE_PROVIDER).toBe('openai');
    expect(written.extensions.developer.enabled).toBe(true);
    expect(written.extensions.computercontroller.enabled).toBe(true);
  });
});

describe('gooseConfigPath', () => {
  it('honours XDG_CONFIG_HOME', () => {
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/custom/cfg';
    expect(gooseConfigPath()).toBe('/custom/cfg/goose/config.yaml');
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  });
});
