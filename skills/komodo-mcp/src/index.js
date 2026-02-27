#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
// CRITICO: Redirigir console.log/warn a stderr ANTES de cualquier import.
// MCP usa stdout para el protocolo. Si el logger (que usa console.log)
// escribe a stdout, corrompe el protocolo y el MCP crashea.
// ═══════════════════════════════════════════════════════════════════
const _stderrWrite = process.stderr.write.bind(process.stderr);
console.log = (...args) => _stderrWrite(args.join(' ') + '\n');
console.warn = (...args) => _stderrWrite(args.join(' ') + '\n');

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { validateConfig } from './config.js';
import { statusTools } from './tools/status.js';
import { plannerTools } from './tools/planner.js';
import { coderTools } from './tools/coder.js';
import { reviewerTools } from './tools/reviewer.js';
import { cycleTools } from './tools/cycle.js';
import { orchestrationTools } from './tools/orchestration.js';

// Validar configuracion
const errors = validateConfig();
if (errors.length > 0) {
  console.error('Komodo MCP - Errores de configuracion:');
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

const server = new McpServer({
  name: 'komodo-mcp',
  version: '1.0.0',
  description: 'MCP Server para controlar el orquestador Komodo. Coordina agentes Planner, Coder y Reviewer para desarrollo autonomo de software.',
});

// Merge all tool groups
const allTools = {
  ...statusTools,
  ...plannerTools,
  ...coderTools,
  ...reviewerTools,
  ...cycleTools,
  ...orchestrationTools,
};

// Convert JSON Schema properties to Zod schemas
// (mismo patron que planning-task-mcp)
function jsonPropsToZod(properties, required = []) {
  const shape = {};

  for (const [key, prop] of Object.entries(properties || {})) {
    let zodType;

    if (prop.type === 'string') {
      zodType = z.string();
      if (prop.enum) zodType = z.enum(prop.enum);
    } else if (prop.type === 'number') {
      zodType = z.number();
      if (prop.enum) zodType = z.number().refine(v => prop.enum.includes(v));
    } else if (prop.type === 'boolean') {
      zodType = z.boolean();
    } else if (prop.type === 'array') {
      if (prop.items?.type === 'string') {
        zodType = z.array(z.string());
      } else if (prop.items?.type === 'object') {
        zodType = z.array(z.object(jsonPropsToZod(prop.items.properties, prop.items.required)));
      } else {
        zodType = z.array(z.any());
      }
    } else if (prop.type === 'object') {
      if (prop.properties) {
        zodType = z.object(jsonPropsToZod(prop.properties, prop.required));
      } else {
        zodType = z.record(z.any());
      }
    } else {
      zodType = z.any();
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    shape[key] = zodType;
  }

  return shape;
}

// Register all tools
for (const [name, tool] of Object.entries(allTools)) {
  const zodShape = jsonPropsToZod(
    tool.inputSchema?.properties,
    tool.inputSchema?.required
  );

  server.tool(name, tool.description, zodShape, async (params) => {
    try {
      const result = await tool.handler(params);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message, stack: err.stack }, null, 2),
          },
        ],
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
