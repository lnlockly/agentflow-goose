// Engine extensions (Phase 3.5): make sure the local goosed has the AgentFlow
// engine's tools enabled in BOTH modes — `computercontroller` (GUI: screenshot
// / click / type, the thing Mode B needs to actually drive the machine) and
// the af_* platform MCP (projects / devices / telegram / memory …).
//
// `developer` is on by default in goose. This module ADDS the two AgentFlow
// extensions into ~/.config/goose/config.yaml by MERGE — it never overwrites a
// user's existing entry (so a user who disabled an extension stays disabled)
// and never touches unrelated config keys. Same "merge, don't clobber" rule as
// the env injection.
//
// af_* is a stdio MCP (`@agentflow/mcp-server`). It is wired only when its
// server entrypoint resolves on disk; until the desktop bundles it (P4) a
// keyless/path-less launch simply skips af_* and logs — never adds a broken
// stdio extension that would fail to spawn. computercontroller (builtin) has no
// external dependency and is always ensured.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export const COMPUTERCONTROLLER = 'computercontroller';
export const AF_EXTENSION_KEY = 'agentflow';

/** ~/.config/goose/config.yaml (XDG_CONFIG_HOME aware), matching goose. */
export function gooseConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'goose', 'config.yaml');
}

export interface AfExtensionOptions {
  /** af_live_* key for the af_* MCP env. */
  apiKey?: string;
  /** Device UUID for af_remember/af_recall (optional). */
  deviceId?: string;
  /** Absolute path to the af_* MCP server entry, or null to skip af_*. */
  mcpServerPath?: string | null;
  /** REST base for the af_* MCP. Defaults to the public host + /_agents. */
  baseUrl?: string;
}

type ConfigDoc = Record<string, unknown> & { extensions?: Record<string, unknown> };

/**
 * Pure merge: return the config with the AgentFlow extensions ensured. Adds an
 * entry only when its key is ABSENT (respecting any user-set entry). Reports
 * which keys were added.
 */
export function mergeAgentflowExtensions(
  existing: ConfigDoc | null,
  opts: AfExtensionOptions
): { config: ConfigDoc; added: string[] } {
  const config: ConfigDoc = existing ? { ...existing } : {};
  const extensions: Record<string, unknown> = { ...(config.extensions ?? {}) };
  const added: string[] = [];

  if (!(COMPUTERCONTROLLER in extensions)) {
    extensions[COMPUTERCONTROLLER] = {
      enabled: true,
      type: 'builtin',
      name: COMPUTERCONTROLLER,
    };
    added.push(COMPUTERCONTROLLER);
  }

  if (opts.mcpServerPath && !(AF_EXTENSION_KEY in extensions)) {
    const envs: Record<string, string> = {
      AGENTFLOW_BASE_URL: opts.baseUrl || 'https://agentflow.website/_agents',
    };
    if (opts.apiKey) envs.AGENTFLOW_API_KEY = opts.apiKey;
    if (opts.deviceId) envs.AGENTFLOW_DEVICE_ID = opts.deviceId;
    extensions[AF_EXTENSION_KEY] = {
      name: 'AgentFlow',
      type: 'stdio',
      cmd: 'node',
      args: [opts.mcpServerPath],
      enabled: true,
      timeout: 300,
      envs,
    };
    added.push(AF_EXTENSION_KEY);
  }

  config.extensions = extensions;
  return { config, added };
}

export interface ConfigIO {
  read: (p: string) => string | null;
  write: (p: string, body: string) => void;
}

const realIO: ConfigIO = {
  read: (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  },
  write: (p, body) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, p);
  },
};

/**
 * Read goose config.yaml, ensure the AgentFlow extensions, write back only when
 * something changed. Preserves all other keys + comments-free structure.
 * Returns the keys added (empty when already present). I/O is injectable for
 * tests.
 */
export function ensureAgentflowExtensions(
  opts: AfExtensionOptions,
  configPath: string = gooseConfigPath(),
  io: ConfigIO = realIO
): string[] {
  const raw = io.read(configPath);
  let existing: ConfigDoc | null = null;
  if (raw && raw.trim()) {
    const parsed = parseYaml(raw) as unknown;
    if (parsed && typeof parsed === 'object') existing = parsed as ConfigDoc;
  }
  const { config, added } = mergeAgentflowExtensions(existing, opts);
  if (added.length > 0) io.write(configPath, stringifyYaml(config));
  return added;
}
