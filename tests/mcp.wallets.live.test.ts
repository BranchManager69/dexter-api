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

describe('LIVE MCP: list_my_wallets (no mocks)', () => {
  // Preload repo root .env if needed
  if (!process.env.TOKEN_AI_MCP_TOKEN || !process.env.MCP_URL) {
    try {
      const rootEnv = path.resolve(process.cwd(), '../../.env');
      if (fs.existsSync(rootEnv)) {
        const parsed = dotenv.parse(fs.readFileSync(rootEnv));
        for (const [k, v] of Object.entries(parsed)) {
          if (!process.env[k] && v) process.env[k] = v as string;
        }
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

  it('calls list_my_wallets with {} and gets a response', async () => {
    const server = new MCPServerStreamableHttp({ url: String(url), requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await server.connect();
    const tools: any[] = await server.listTools();
    const tool = tools.find(t => t?.name === 'list_my_wallets') || tools.find(t => t?.name === 'list_managed_wallets');
    expect(tool, 'wallet listing tool present').toBeTruthy();
    const required = Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required : [];
    // If the server requires args, bail out early to avoid guessing
    expect(required.length).toBe(0);
    const out = await server.callTool(tool.name, {});
    expect(Array.isArray(out)).toBe(true);
    await server.close();
  }, 30_000);
});

