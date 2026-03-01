#!/usr/bin/env node

/**
 * Komodo MCP Server
 *
 * Expone el orquestador Komodo como servidor MCP.
 * Permite a Claude Code, Codex u otros clientes MCP ejecutar
 * los agentes (Planner, Coder, Reviewer) paso a paso o en ciclo completo.
 *
 * Flujo recomendado (step-by-step):
 *   komodo_plan → komodo_code → komodo_review → (komodo_fix) → komodo_finalize
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.KOMODO_ROOT || resolve(__dirname, '..', '..', '..');

// Load .env from Komodo project root BEFORE importing orchestrator modules.
// dotenv doesn't overwrite existing env vars, so if they're set via MCP config, they're safe.
import dotenv from 'dotenv';
dotenv.config({ path: resolve(ROOT_DIR, '.env') });

// Dynamic imports: orchestrator modules depend on env vars being loaded first.
const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { tools } = await import('./tools.js');
const { eventBus } = await import('../../../src/events/event-bus.js');

// ── EventBus Forwarding ───────────────────────────────────────────────
// Forward any local eventBus events to the standalone ws-server using IPv4
const WS_SERVER_URL = `http://127.0.0.1:${process.env.WS_PORT || 4681}`;
eventBus.onAny((payload) => {
  fetch(`${WS_SERVER_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
});
// ──────────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'komodo-mcp',
  version: '1.0.0',
  description: 'Orquestador Komodo: coordina agentes IA (Planner, Coder, Reviewer) para desarrollo autónomo de software.',
});

// Register all tools
for (const [name, tool] of Object.entries(tools)) {
  server.tool(name, tool.description, tool.schema, async (params) => {
    try {
      const result = await tool.handler(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }, null, 2) }],
        isError: true,
      };
    }
  });
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
