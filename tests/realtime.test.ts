import { describe, it, expect } from 'vitest';
import http from 'http';
import { createRealtimeSessionWithEnv } from '../src/realtime.js';

function startStubOpenAI(port: number): Promise<{ url: string; close: () => Promise<void>; getLastBody: () => any; }>{
  return new Promise((resolve) => {
    let lastBody: any = null;
    const srv = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/realtime/sessions') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const text = Buffer.concat(chunks).toString('utf8');
        try { lastBody = JSON.parse(text); } catch { lastBody = text; }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ client_secret: { value: 'test_ephemeral' }, model: 'gpt-realtime' }));
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    srv.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        getLastBody: () => lastBody,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

describe('createRealtimeSessionWithEnv', () => {
  it('includes hosted MCP tool with headers, approval never, and allowlist', async () => {
    const port = 4099;
    const stub = await startStubOpenAI(port);
    const env: any = {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_API_BASE: stub.url,
      OPENAI_REALTIME_MODEL: 'gpt-realtime',
      TEXT_MODEL: 'gpt-5-mini',
      MCP_URL: 'https://mcp.dexter.cash/mcp',
      TOKEN_AI_MCP_TOKEN: 'abc123',
      MCP_ALLOWED_TOOLS_VOICE: 'buy,sell',
      MCP_ALLOWED_TOOLS_CHAT: '',
      PORT: 3030,
      ALLOWED_ORIGINS: '*',
    };

    const out = await createRealtimeSessionWithEnv(env, { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_REALTIME_MODEL });
    expect(out?.client_secret?.value || out?.client_secret).toBeTruthy();

    const lastBody = stub.getLastBody();
    // In this stub, lastBody is attached on closure; emulate retrieval by issuing another request if needed
    // But we set lastBody as a closure variable already
    // Validate
    expect(lastBody).toBeTruthy();
    expect(lastBody.model).toBe('gpt-realtime');
    expect(Array.isArray(lastBody.tools)).toBe(true);
    expect(lastBody.tools.length).toBeGreaterThan(0);
    const t = lastBody.tools[0];
    expect(t.type).toBe('mcp');
    expect(t.server_url).toBe(env.MCP_URL);
    expect(t.require_approval).toBe('never');
    expect(t.headers.Authorization).toBe('Bearer abc123');
    expect(t.allowed_tools).toEqual(['buy', 'sell']);

    await stub.close();
  });

  it('omits allowed_tools when no allowlist provided', async () => {
    const port = 4100;
    let captured: any = null;
    const srv = http.createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/realtime/sessions') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        captured = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ client_secret: 'ok' }));
      } else { res.statusCode = 404; res.end('no'); }
    });
    await new Promise<void>((r) => srv.listen(4100, '127.0.0.1', () => r()));

    const env: any = {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_API_BASE: 'http://127.0.0.1:4100',
      OPENAI_REALTIME_MODEL: 'gpt-realtime',
      TEXT_MODEL: 'gpt-5-mini',
      MCP_URL: 'https://mcp.dexter.cash/mcp',
      TOKEN_AI_MCP_TOKEN: 'tok',
      MCP_ALLOWED_TOOLS_VOICE: '',
      MCP_ALLOWED_TOOLS_CHAT: '',
      PORT: 3030,
      ALLOWED_ORIGINS: '*',
    };

    await createRealtimeSessionWithEnv(env, { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_REALTIME_MODEL });
    expect(captured).toBeTruthy();
    const t = captured.tools[0];
    expect(t.type).toBe('mcp');
    expect(t.allowed_tools).toBeUndefined();

    await new Promise<void>((r) => srv.close(() => r()));
  });
});
