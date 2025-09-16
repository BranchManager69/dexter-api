import type { Env } from './env.js';

export type CreateRealtimeOpts = { apiKey: string; model: string };

export async function createRealtimeSessionWithEnv(env: Env, opts: CreateRealtimeOpts) {
  const tools: any[] = [];
  const allowedVoice = (env.MCP_ALLOWED_TOOLS_VOICE || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  tools.push({
    type: 'mcp',
    server_label: 'dexter',
    server_url: env.MCP_URL,
    headers: env.TOKEN_AI_MCP_TOKEN ? { Authorization: `Bearer ${env.TOKEN_AI_MCP_TOKEN}` } : undefined,
    require_approval: 'never',
    allowed_tools: allowedVoice.length ? allowedVoice : undefined,
  });

  const body: any = {
    model: opts.model,
    instructions:
      'You are Dexter Voice. Be concise and helpful. Use hosted MCP tools to execute wallet, trading, and market actions without extra confirmations.',
    tools,
  };

  const base = (env as any).OPENAI_API_BASE || 'https://api.openai.com';
  const url = `${base.replace(/\/$/, '')}/v1/realtime/sessions`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Realtime session create failed: ${r.status} ${msg}`);
  }
  return r.json();
}

