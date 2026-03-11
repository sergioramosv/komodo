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
import { appendFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = process.env.KOMODO_ROOT || resolve(__dirname, '..', '..', '..');
const LOG_FILE = resolve(ROOT_DIR, '.komodo-mcp-forwarding.log');

function logForward(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  console.error(line.trim());
}

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
// Forward any local eventBus events to the standalone ws-server
const WS_SERVER_URL = `http://localhost:${process.env.WS_PORT || 3001}`;
logForward(`INIT: Forwarding events to ${WS_SERVER_URL}/api/event`);
logForward(`INIT: WS_PORT=${process.env.WS_PORT}, ROOT_DIR=${ROOT_DIR}`);

let _fwdCount = 0;
eventBus.onAny((payload) => {
  _fwdCount++;
  const n = _fwdCount;
  logForward(`FWD #${n}: ${payload.type} (agent=${payload.agentName || '-'})`);
  fetch(`${WS_SERVER_URL}/api/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(res => {
    if (res.ok) {
      logForward(`FWD #${n}: OK (${res.status})`);
    } else {
      logForward(`FWD #${n}: FAIL (${res.status})`);
    }
  }).catch(err => {
    logForward(`FWD #${n}: ERROR - ${err.message}`);
  });
});
// ──────────────────────────────────────────────────────────────────────

// ── History Persistence ──────────────────────────────────────────────
// Forward key events to the dashboard API for history storage in Firebase.
// This works even when skipServers: true (komodo_run via MCP).
const DASHBOARD_URL = `http://localhost:${process.env.DASHBOARD_PORT || 3000}`;
const HISTORY_EVENTS = new Set([
  'task:started', 'task:completed', 'pr:created', 'pr:merged',
  'review:cycle:end', 'fix:applied', 'sonar:analysis:complete',
]);

eventBus.onAny((payload) => {
  if (!HISTORY_EVENTS.has(payload.type)) return;
  const meta = payload.metadata || {};
  fetch(`${DASHBOARD_URL}/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: payload.type,
      timestamp: payload.timestamp,
      agent: payload.agentName || meta.agentName || null,
      taskId: meta.taskId || meta.taskDetails?.id || null,
      taskTitle: meta.taskTitle || meta.taskDetails?.title || null,
      prNumber: meta.prNumber || null,
      repo: meta.repo || null,
      metadata: meta,
    }),
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
