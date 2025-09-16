import type { Request, Response } from 'express';
import { Agent, Runner, hostedMcpTool } from '@openai/agents-core';
import { OpenAIProvider, setDefaultOpenAIKey } from '@openai/agents-openai';
import { loadEnv } from './env.js';

const env = loadEnv();
setDefaultOpenAIKey(env.OPENAI_API_KEY || '');
const provider = new OpenAIProvider({ apiKey: env.OPENAI_API_KEY });
const runner = new Runner({ modelProvider: provider });

export async function chatStreamHandler(req: Request, res: Response) {
  try {
    const input = String(req.query.q || req.body?.input || '').trim();
    const model = String(req.query.model || req.body?.model || env.TEXT_MODEL);
    if (!input) {
      res.status(400).json({ ok: false, error: 'input_required' });
      return;
    }

    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    } as Record<string, string>;
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);

    // Build agent
    const tools: any[] = [];
    if (env.TOKEN_AI_MCP_TOKEN) {
      tools.push(
        hostedMcpTool({
          serverLabel: 'dexter',
          serverUrl: env.MCP_URL,
          headers: { Authorization: `Bearer ${env.TOKEN_AI_MCP_TOKEN}` },
        })
      );
    }
    const agent = new Agent({ name: 'Dexter Agent', instructions: 'Be concise. Use hosted MCP tools when needed.', model, tools });
    const modelInst = await provider.getModel(model);
    const agentWithModel = agent.clone({ model: modelInst });

    const streamResult = await runner.run(agentWithModel, input, { stream: true });
    const send = (obj: any) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
    // Forward low-level stream events for full visibility (tools, handoffs, items, etc.)
    (async () => {
      try {
        for await (const ev of streamResult) {
          send({ type: 'event', event: ev });
        }
        // Also flush final text
        const finalTextStream = streamResult.toTextStream({ compatibleWithNodeStreams: true });
        finalTextStream.on('data', (chunk: Buffer | string) => send({ type: 'text', data: chunk.toString() }));
        finalTextStream.on('end', () => { send({ type: 'done' }); try { res.end(); } catch {} });
        finalTextStream.on('error', (err: any) => { send({ type: 'error', error: String(err?.message || err) }); try { res.end(); } catch {} });
      } catch (err: any) {
        send({ type: 'error', error: String(err?.message || err) });
        try { res.end(); } catch {}
      }
    })();
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (!res.headersSent) res.status(500).json({ ok: false, error: msg });
    else try { res.end(); } catch {}
  }
}
