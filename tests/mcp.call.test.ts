import { describe, it, expect } from 'vitest';
import http from 'http';

// For a concrete call, use a small test-only client that POSTs to a stub MCP
import { callMcpToolTestOnly } from '../src/mcpTestClient.js';

function startStubMcp(port: number): Promise<{ url: string; close: () => Promise<void>; getLastAuth: () => string | null }>{
  return new Promise((resolve) => {
    let lastAuth: string | null = null;
    const srv = http.createServer(async (req, res) => {
      lastAuth = (req.headers['authorization'] as string) || null;
      if (req.method === 'GET' && req.url === '/listTools') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          tools: [
            {
              name: 'echo',
              description: 'Echo back your text uppercased',
              inputSchema: {
                type: 'object',
                properties: { text: { type: 'string' } },
                required: ['text'],
                additionalProperties: false,
              },
            },
          ],
        }));
        return;
      }
      if (req.method === 'POST' && req.url === '/callTool') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const text = String(body?.arguments?.text || '').toUpperCase();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });
    srv.listen(port, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${port}`, getLastAuth: () => lastAuth, close: () => new Promise(r => srv.close(() => r())) });
    });
  });
}

describe('MCP tool call (concrete echo) with bearer', () => {
  it('calls echo and returns uppercase with Authorization header', async () => {
    const stub = await startStubMcp(4102);
    const out = await callMcpToolTestOnly(stub.url, 'abc123', 'echo', { text: 'hello' });
    expect(out?.content?.[0]?.text).toBe('HELLO');
    expect(stub.getLastAuth()).toBe('Bearer abc123');
    await stub.close();
  });
});
