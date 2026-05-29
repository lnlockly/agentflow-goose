#!/usr/bin/env node
// Regenerate the vendored af_* MCP server bundle shipped with AgentFlow Desktop.
//
// The af_* platform MCP (`@agentflow/mcp-server`) lives in a sibling repo. To
// make af_* load on a stock install (no AGENTFLOW_MCP_PATH), we vendor a single
// self-contained CJS bundle at resources/agentflow-mcp/server.cjs and ship it as
// a forge extraResource. goose runs it as `node <resourcesPath>/agentflow-mcp/
// server.cjs` (see device-bridge/extensionsSetup.ts).
//
// Run this whenever agentflow-mcp-server changes:
//   node ui/desktop/scripts/bundle-af-mcp.mjs [/path/to/agentflow-mcp-server]
// Defaults to ../../../agentflow-mcp-server relative to this repo. Requires the
// sibling repo built (`pnpm build`) with node_modules installed.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const repoRoot = path.resolve(desktopRoot, '..', '..');

const srcRepo = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(repoRoot, '..', 'agentflow-mcp-server');

const entry = path.join(srcRepo, 'dist', 'index.js');
if (!existsSync(entry)) {
  console.error(`af-mcp source build not found at ${entry}`);
  console.error('Build the sibling repo first: (cd agentflow-mcp-server && pnpm install && pnpm build)');
  process.exit(1);
}

const outDir = path.join(desktopRoot, 'resources', 'agentflow-mcp');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'server.cjs');

// Single self-contained CJS bundle — inlines @modelcontextprotocol/sdk + zod so
// no node_modules needs shipping. node20 target matches the app's engines.
execFileSync(
  'npx',
  [
    '--yes',
    'esbuild@0.24.0',
    entry,
    '--bundle',
    '--platform=node',
    '--target=node20',
    '--format=cjs',
    `--outfile=${outFile}`,
  ],
  { stdio: 'inherit', cwd: srcRepo }
);

console.log(`Wrote ${path.relative(repoRoot, outFile)}`);
