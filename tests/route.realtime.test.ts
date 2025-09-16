import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import request from 'supertest';

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

describe('POST /realtime/sessions route', () => {
  let stub: Awaited<ReturnType<typeof startStubOpenAI>>;

  beforeAll(async () => {
    stub = await startStubOpenAI(4101);
    process.env.OPENAI_API_BASE = stub.url;
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.OPENAI_REALTIME_MODEL = 'gpt-realtime';
    process.env.MCP_URL = 'https://mcp.dexter.cash/mcp';
    process.env.TOKEN_AI_MCP_TOKEN = 'abc123';
    process.env.MCP_ALLOWED_TOOLS_VOICE = 'buy,sell';
  });

  afterAll(async () => {
    await stub.close();
  });

  it('returns ephemeral payload and sends proper MCP tool config to OpenAI', async () => {
    const { app } = await import('../src/app.js');
    const r = await request(app)
      .post('/realtime/sessions')
      .set('Content-Type', 'application/json')
      .send({});
    expect(r.status).toBe(200);
    const json = r.body;
    expect(json?.client_secret?.value || json?.client_secret).toBeTruthy();

    const body = stub.getLastBody();
    expect(body).toBeTruthy();
    expect(body.model).toBe('gpt-realtime');
    const t = body.tools?.[0];
    expect(t.type).toBe('mcp');
    expect(t.server_url).toBe('https://mcp.dexter.cash/mcp');
    expect(t.require_approval).toBe('never');
    expect(t.headers.Authorization).toBe('Bearer abc123');
    expect(t.allowed_tools).toEqual(['buy', 'sell']);
  });
});

