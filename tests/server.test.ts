import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
let baseUrl: string;

describe('dexter-api', () => {
  beforeAll(async () => {
    const port = Number(process.env.PORT || 3030);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {})

  it('GET /health returns ok', async () => {
    const r = await fetch(`${baseUrl}/health`);
    expect(r.ok).toBe(true);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.service).toBe('dexter-api');
  });

  it('Production MCP health is reachable (dexter.cash)', async () => {
    const mcpUrl = process.env.MCP_URL || 'https://dexter.cash/mcp';
    const r = await fetch(new URL('/mcp/health', mcpUrl).toString());
    expect(r.status).toBeLessThan(600);
  });
});
