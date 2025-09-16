import { hostedMcpTool, Agent } from '@openai/agents';
import type { Env } from './env.js';

export function buildAgent(env: Env, modelOverride?: string) {
  const tools = [
    hostedMcpTool({
      serverLabel: 'dexter',
      serverUrl: env.MCP_URL,
    }),
  ];

  const agent = new Agent({
    name: 'Dexter Agent',
    model: modelOverride || env.TEXT_MODEL,
    tools,
    instructions:
      'Be concise. Use hosted MCP tools when needed (web, twitter, wallet, reports, etc.). Avoid long orchestrations — perform just the requested task.',
  });

  return agent;
}
