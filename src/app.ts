import 'dotenv/config';
import express from 'express';
import { loadEnv } from './env.js';
import { Agent, hostedMcpTool, Runner } from '@openai/agents-core';
import { OpenAIProvider, setDefaultOpenAIKey } from '@openai/agents-openai';
import { chatStreamHandler } from './chatStream.js';
import { buildSpecialistAgents } from './agents.js';
import { createRealtimeSessionWithEnv } from './realtime.js';

import { registerAuthConfigRoute } from './routes/authConfig.js';
import { registerWalletRoutes } from './routes/wallets.js';
import { registerConnectorOAuthRoutes } from './routes/connectorOAuth.js';
import { registerX402Routes } from './payments/registerX402.js';

export const env = loadEnv();
export const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '2mb' }));

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

function mergeContentSecurityPolicy(existing: undefined | string | string[] | number): string {
  const normalizeExisting = (): string => {
    if (Array.isArray(existing)) return existing.join('; ');
    if (typeof existing === 'number') return existing.toString();
    return existing ? String(existing) : '';
  };

  const raw = normalizeExisting();
  const directives = new Map<string, string[]>();
  const order: string[] = [];

  const registerDirective = (name: string, values: string[]) => {
    const lower = name.toLowerCase();
    directives.set(lower, values);
    if (!order.includes(lower)) order.push(lower);
  };

  if (raw) {
    for (const chunk of raw.split(';')) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const [name, ...values] = trimmed.split(/\s+/);
      if (!name) continue;
      registerDirective(name, values);
    }
  }

  const ensureDirective = (name: string, defaults: string[]) => {
    const lower = name.toLowerCase();
    if (!directives.has(lower)) {
      registerDirective(lower, [...defaults]);
    }
  };

  const addValues = (name: string, additions: Iterable<string>) => {
    const lower = name.toLowerCase();
    const current = directives.get(lower) ?? [];
    const unique = new Set(current);
    for (const value of additions) {
      if (!value) continue;
      unique.add(value);
    }
    directives.set(lower, Array.from(unique));
  };

  ensureDirective('script-src', ["'self'", "'unsafe-inline'", "'unsafe-eval'"]); // keep parity with prior policy
  ensureDirective('script-src-elem', directives.get('script-src') ?? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
  ensureDirective('frame-src', ["'self'"]);

  addValues('script-src', [TURNSTILE_ORIGIN]);
  addValues('script-src-elem', [TURNSTILE_ORIGIN]);
  addValues('frame-src', [TURNSTILE_ORIGIN]);

  return order
    .map((name) => {
      const values = directives.get(name) ?? [];
      return values.length ? `${name} ${values.join(' ')}` : name;
    })
    .join('; ');
}

// Basic CORS
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  const allowed = env.ALLOWED_ORIGINS === '*' || (env.ALLOWED_ORIGINS || '').split(',').map((s: string) => s.trim()).includes(origin as string);
  res.setHeader('Access-Control-Allow-Origin', allowed ? (origin as string) : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (allowed && origin !== '*') {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Ensure Turnstile challenge assets are permitted by CSP
app.use((_req, res, next) => {
  const merged = mergeContentSecurityPolicy(res.getHeader('Content-Security-Policy'));
  res.setHeader('Content-Security-Policy', merged);
  next();
});

app.get('/health', async (_req, res) => {
  res.json({ ok: true, service: 'dexter-api', mcp: env.MCP_URL });
});

// Ephemeral Realtime session token for browser
app.post('/realtime/sessions', async (req, res) => {
  try {
    const model = (req.body?.model as string) || env.OPENAI_REALTIME_MODEL;
    const out = await createRealtimeSessionWithEnv(env, { apiKey: env.OPENAI_API_KEY, model });
    return res.json(out);
  } catch (err: any) {
    const msg = err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Canonical chat endpoint (Agents SDK)
app.post('/chat', async (req, res) => {
  try {
    const input = String(req.body?.input || '').trim();
    if (!input) return res.status(400).json({ ok: false, error: 'input_required' });
    const model = typeof req.body?.model === 'string' && req.body.model.trim() ? String(req.body.model) : env.TEXT_MODEL;

    if (!env.OPENAI_API_KEY) {
      return res.status(501).json({ ok: false, error: 'OPENAI_API_KEY not set' });
    }

    // Build Agent with hosted MCP tools (no duplication of tool logic)
    const { traderTool, walletTool, marketTool, dexterMcp } = buildSpecialistAgents(env);
    const agent = new Agent({
      name: 'Dexter Agent',
      instructions: 'Be concise. Use hosted MCP tools when needed (web, twitter, wallet, reports, etc.).',
      model,
      tools: [traderTool, walletTool, marketTool, dexterMcp],
    });

    // Run via Agents SDK using OpenAI model provider
    setDefaultOpenAIKey(env.OPENAI_API_KEY);
    const provider = new OpenAIProvider({ apiKey: env.OPENAI_API_KEY });
    const runner = new Runner({ modelProvider: provider });
    const modelInst = await provider.getModel(model);
    const agentWithModel = agent.clone({ model: modelInst });
    const result = await runner.run(agentWithModel, input, { stream: false });
    const text = (result as any)?.finalOutput?.text || (result as any)?.finalOutput || null;
    return res.json({ ok: true, result: { text, raw: result } });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Streaming chat (SSE)
app.get('/chat/stream', chatStreamHandler);

// MCP health pass-through
app.get('/mcp/health', async (_req, res) => {
  try {
    const u = new URL('/mcp/health', env.MCP_URL);
    const r = await fetch(u.toString());
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'text/plain').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || String(e) });
  }
});

// MCP tools passthrough
app.get('/tools', async (_req, res) => {
  try {
    const base = env.MCP_URL.replace(/\/$/, '');
    const upstream = `${base}/tools`;
    const r = await fetch(upstream, {
      headers: env.TOKEN_AI_MCP_TOKEN ? { Authorization: `Bearer ${env.TOKEN_AI_MCP_TOKEN}` } : {},
    });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e: any) {
    res.status(502).json({ ok: false, error: e?.message || String(e) });
  }
});

registerAuthConfigRoute(app);
registerWalletRoutes(app);
registerConnectorOAuthRoutes(app);
registerX402Routes(app, env);
