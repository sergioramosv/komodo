#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { validateConfig } from './config.js';
import { patternTools } from './tools/patterns.js';
import { statsTools } from './tools/stats.js';
import { searchTools } from './tools/search.js';

// Validate configuration before starting
const errors = validateConfig();
if (errors.length > 0) {
  console.error('Memory MCP - Errores de configuración:');
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}

const server = new McpServer({
  name: 'memory-mcp',
  version: '1.0.0',
  description: 'MCP Server para memoria persistente de patrones de error y estadísticas de reviews del orquestador Komodo.',
});

// Merge all tool groups
const allTools = {
  ...patternTools,
  ...statsTools,
  ...searchTools,
};

// Convert JSON Schema properties to Zod schemas
function jsonPropsToZod(properties, required = []) {
  const shape = {};

  for (const [key, prop] of Object.entries(properties || {})) {
    let zodType;

    if (prop.type === 'string') {
      zodType = z.string();
      if (prop.enum) zodType = z.enum(prop.enum);
    } else if (prop.type === 'number') {
      zodType = z.number();
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
            text: JSON.stringify({ error: err.message }, null, 2),
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
