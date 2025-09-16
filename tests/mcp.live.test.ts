import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { describe, it, expect } from 'vitest';
import { MCPServerStreamableHttp } from '@openai/agents-core';

function getEnv(name: string, def?: string) {
  const v = process.env[name];
  return (v && v.trim()) ? v : def;
}

describe('LIVE MCP (no mocks): list and optionally call a safe tool', () => {
  // Attempt to preload parent .env if variables are missing
  if (!process.env.TOKEN_AI_MCP_TOKEN || !process.env.MCP_URL) {
    try {
      const rootEnv = path.resolve(process.cwd(), '../../.env');
      if (fs.existsSync(rootEnv)) {
        const parsed = dotenv.parse(fs.readFileSync(rootEnv));
        for (const [k, v] of Object.entries(parsed)) {
          if (!process.env[k] && v) process.env[k] = v as string;
        }
        // Map project-specific names to generic ones if needed
        if (!process.env.MCP_URL && parsed['TOKEN_AI_MCP_PUBLIC_URL']) process.env.MCP_URL = parsed['TOKEN_AI_MCP_PUBLIC_URL'];
        if (!process.env.TOKEN_AI_MCP_TOKEN && parsed['TOKEN_AI_MCP_TOKEN']) process.env.TOKEN_AI_MCP_TOKEN = parsed['TOKEN_AI_MCP_TOKEN'];
      }
    } catch {}
  }

  const token = getEnv('TOKEN_AI_MCP_TOKEN');
  const url = getEnv('MCP_URL', 'https://dexter.cash/mcp');

  if (!token) {
    it.skip('skipped (TOKEN_AI_MCP_TOKEN not set)', () => {});
    return;
  }

  it('connects to MCP, lists tools, and calls a zero-arg tool if available', async () => {
    const server = new MCPServerStreamableHttp({ url: String(url), requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await server.connect();
    const tools = await server.listTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Try to find a tool with no required params (safe to call with {})
    const candidate = tools.find((t: any) => Array.isArray(t?.inputSchema?.required) && t.inputSchema.required.length === 0);
    if (!candidate) {
      // We at least verified live listing; exit without failing
      await server.close();
      return;
    }

    const out = await server.callTool(candidate.name, {});
    expect(Array.isArray(out)).toBe(true);
    await server.close();
  }, 30_000);
});
