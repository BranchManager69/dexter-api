import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from './env.js';
import { Agent, hostedMcpTool, Runner } from '@openai/agents-core';
import { OpenAIProvider, setDefaultOpenAIKey } from '@openai/agents-openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { chatStreamHandler } from './chatStream.js';
import { buildSpecialistAgents } from './agents.js';
import { resolveConciergeProfile, fetchResolvedProfileForUser, missingPromptFallback } from './promptProfiles.js';
import { createRealtimeSessionWithEnv, type SessionIdentity } from './realtime.js';
import { ensureUserWallet } from './wallets/allocator.js';
import { getSupabaseUserFromAccessToken } from './utils/supabaseAdmin.js';
import prisma from './prisma.js';

import { registerAuthConfigRoute } from './routes/authConfig.js';
import { registerWalletRoutes } from './routes/wallets.js';
import { registerConnectorOAuthRoutes } from './routes/connectorOAuth.js';
import { registerMcpDcrRoutes } from './routes/mcpDcr.js';
import { registerX402Routes } from './payments/registerX402.js';
import { registerSolanaRoutes } from './routes/solana.js';
import { registerStreamSceneRoutes } from './routes/streamScenes.js';
import { registerPromptModuleRoutes } from './routes/promptModules.js';
import { registerPromptProfileRoutes } from './routes/promptProfiles.js';
import { registerConversationLogRoutes } from './routes/conversationLogs.js';
import { registerDossierRoutes } from './routes/dossier.js';
import { registerRealtimeMemoryRoutes } from './routes/realtimeMemories.js';
import { buildUserMemoryInstructions } from './utils/memory.js';
import { logger, style } from './logger.js';

export const env = loadEnv();
export const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '2mb' }));

const realtimeLog = logger.child('realtime.sessions');
const mcpToolsLog = logger.child('mcp-tools');
const healthLog = logger.child('health.probe');

function normalizeIdentity(input: SessionIdentity): SessionIdentity {
  if (input.sessionType === 'user') {
    return {
      sessionType: 'user',
      supabaseUserId: input.supabaseUserId ?? null,
      supabaseEmail: input.supabaseEmail ?? null,
    };
  }
  return {
    sessionType: 'guest',
    supabaseUserId: null,
    supabaseEmail: null,
  };
}

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

const ADMIN_ROLES = new Set(['admin', 'superadmin']);

function extractRoles(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry).toLowerCase());
  if (typeof value === 'string') return [value.toLowerCase()];
  return [];
}

function isAdminUser(user: { app_metadata?: Record<string, unknown> | null }): boolean {
  if (!user) return false;
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const roles = extractRoles(appMeta.roles);
  return roles.some((role) => ADMIN_ROLES.has(role));
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
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
    if (!env.OPENAI_API_KEY) {
      return res.status(501).json({ ok: false, error: 'OPENAI_API_KEY not configured' });
    }

    const voice =
      typeof req.body?.voice === 'string' && req.body.voice.trim()
        ? req.body.voice.trim()
        : null;

    const accessToken = typeof req.body?.supabaseAccessToken === 'string' && req.body.supabaseAccessToken.trim()
      ? String(req.body.supabaseAccessToken).trim()
      : '';

    let identity = normalizeIdentity({ sessionType: 'guest' });
    if (accessToken) {
      try {
        const user = await getSupabaseUserFromAccessToken(accessToken);
        identity = normalizeIdentity({
          sessionType: 'user',
          supabaseUserId: user.id,
          supabaseEmail: user.email ?? null,
        });
      } catch (error: any) {
        realtimeLog.warn(
          `${style.status('verify', 'warn')} ${style.kv('error', error?.message || error)}`,
          error
        );
      }
    }

    const guestFallbackMarker = missingPromptFallback('agent.concierge.guest');
    let defaultGuestInstructions: string | null = null;
    let resolvedUserProfile = null;
    if (identity.sessionType === 'guest') {
      try {
        const conciergeProfile = await resolveConciergeProfile({ skipCache: true });
        const guestInstructions = conciergeProfile.guestInstructions?.trim() || null;
        if (!guestInstructions || guestInstructions === guestFallbackMarker) {
          realtimeLog.error(
            `${style.status('profile', 'error')} ${style.kv('error', 'guest_prompt_missing')}`,
          );
          return res.status(500).json({ ok: false, error: 'guest_prompt_missing' });
        }
        defaultGuestInstructions = guestInstructions;
      } catch (error: any) {
        realtimeLog.warn(
          `${style.status('profile', 'warn')} ${style.kv('error', error?.message || error)}`,
        );
        return res.status(500).json({ ok: false, error: 'guest_prompt_load_failed' });
      }
    } else if (identity.sessionType === 'user' && identity.supabaseUserId) {
      try {
        resolvedUserProfile = await fetchResolvedProfileForUser(identity.supabaseUserId);
      } catch (error: any) {
        realtimeLog.warn(
          `${style.status('profile', 'warn')} ${style.kv('error', error?.message || error)}`,
        );
      }
    }

    let memoryInstructions: string | null = null;
    if (identity.sessionType === 'user' && identity.supabaseUserId) {
      try {
        memoryInstructions = await buildUserMemoryInstructions(identity.supabaseUserId);
      } catch (error: any) {
        realtimeLog.warn(
          `${style.status('memory', 'warn')} ${style.kv('error', error?.message || error)}`,
        );
      }
    }

    const guestProfile =
      identity.sessionType === 'guest'
        ? {
            label: req.body?.guestProfile?.label || 'Dexter Demo Wallet',
            instructions:
              req.body?.guestProfile?.instructions || defaultGuestInstructions,
          }
        : null;

    if (identity.sessionType === 'guest' && (!guestProfile || !guestProfile.instructions)) {
      return res.status(500).json({ ok: false, error: 'guest_prompt_missing' });
    }

    let walletAssignment: Awaited<ReturnType<typeof ensureUserWallet>> | null = null;
    if (identity.sessionType === 'user' && identity.supabaseUserId) {
      walletAssignment = await ensureUserWallet(env, {
        supabaseUserId: identity.supabaseUserId,
        email: identity.supabaseEmail ?? null,
      });
    }

    realtimeLog.info(
      `${style.status('start', 'start')} ${style.kv('type', identity.sessionType)} ${style.kv('model', model)} ${style.kv('voice', voice || 'default')}`,
      {
        sessionType: identity.sessionType,
        supabaseUserId: identity.supabaseUserId || null,
        supabaseEmail: identity.supabaseEmail || null,
        wallet: walletAssignment?.wallet.public_key || null,
        model,
        voice: voice || null,
      }
    );

    const out = await createRealtimeSessionWithEnv(env, {
      apiKey: env.OPENAI_API_KEY,
      model,
      identity,
      guestProfile,
      mcpJwt: walletAssignment?.mcpJwt ?? null,
      walletPublicKey: walletAssignment?.wallet.public_key ?? null,
      voice,
      memoryInstructions,
    });

    return res.json({
      ...out,
      dexter_session: {
        type: identity.sessionType,
        user: identity.sessionType === 'user'
          ? { id: identity.supabaseUserId, email: identity.supabaseEmail }
          : null,
        guest_profile: guestProfile,
        wallet: walletAssignment?.wallet
          ? {
              public_key: walletAssignment.wallet.public_key,
              label: walletAssignment.wallet.label,
            }
          : null,
        prompt_profile: resolvedUserProfile
          ? {
              id: resolvedUserProfile.id,
              agent_name: resolvedUserProfile.agentName,
              voice_key: resolvedUserProfile.voiceKey,
            }
          : null,
      },
    });
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
const handleToolsListing = async (_req: Request, res: Response) => {
  let transport: StreamableHTTPClientTransport | null = null;
  let client: Client | null = null;
  try {
    mcpToolsLog.info(
      `${style.status('proxy', 'info')} ${style.kv('url', style.url(env.MCP_URL))}`
    );
    const baseUrl = new URL(env.MCP_URL);
    client = new Client({ name: 'dexter-api-tools-proxy', version: '1.0.0' });
    transport = new StreamableHTTPClientTransport(baseUrl, {
      fetch,
      requestInit: env.TOKEN_AI_MCP_TOKEN
        ? { headers: { Authorization: `Bearer ${env.TOKEN_AI_MCP_TOKEN}` } }
        : undefined,
    });
    await client.connect(transport);
    const result = await client.request({ method: 'tools/list', params: {} }, ListToolsResultSchema);
    mcpToolsLog.success(
      `${style.status('ok', 'success')} ${style.kv('count', result.tools.length)}`,
      { count: result.tools.length }
    );
    res.json({ tools: result.tools });
  } catch (e: any) {
    mcpToolsLog.error(
      `${style.status('fail', 'error')} ${style.kv('error', e?.message || e)}`,
      e
    );
    res.status(502).json({ ok: false, error: e?.message || String(e) });
  } finally {
    try {
      await transport?.close();
    } catch {}
    try {
      await client?.close();
    } catch {}
  }
};

app.get('/tools', handleToolsListing);
app.get('/api/tools', handleToolsListing);

registerAuthConfigRoute(app);
registerWalletRoutes(app, env);
registerConnectorOAuthRoutes(app, env);
registerMcpDcrRoutes(app);
registerX402Routes(app, env);
registerSolanaRoutes(app);
registerStreamSceneRoutes(app, env);
registerPromptModuleRoutes(app);
registerPromptProfileRoutes(app);
registerConversationLogRoutes(app);
registerDossierRoutes(app);
registerRealtimeMemoryRoutes(app);

const CONNECTOR_PROBE_TARGETS = [
  {
    name: 'alexa',
    displayName: 'Amazon Alexa',
    redirectCandidates: [
      'https://pitangui.amazon.com/api/skill/link/M28N0DJM2U0LFQ',
      'https://pitangui.amazon.com/api/skill/link/amzn1.ask.skill.b4347dae-06f3-415c-b5d0-12f68537241d',
    ],
  },
  {
    name: 'chatgpt',
    displayName: 'ChatGPT Connector',
    redirectCandidates: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  },
  {
    name: 'claude',
    displayName: 'Claude Connector',
    redirectCandidates: ['https://claude.ai/api/mcp/auth_callback'],
  },
] as const;

const HEALTH_CACHE_PATH = path.join(
  process.env.HOME || '/home/branchmanager',
  '.codex',
  'dexter-health.json'
);

type ConnectorProbeTarget = (typeof CONNECTOR_PROBE_TARGETS)[number];

type ConnectorProbeResult = {
  ok: boolean;
  duration_ms: number;
  client_id: string | null;
  redirect_uri: string | null;
  request_id: string | null;
  code: string | null;
  supabase_user_id: string | null;
  error?: string;
};

type RealtimeProbeResult = {
  ok: boolean;
  duration_ms: number;
  error?: string;
  session?: {
    id: string;
    model: string;
    modalities?: unknown;
    expires_at?: number;
  };
};

async function probeRealtime(): Promise<RealtimeProbeResult> {
  const start = Date.now();
  if (!env.OPENAI_API_KEY) {
    return {
      ok: false,
      duration_ms: Date.now() - start,
      error: 'OPENAI_API_KEY not configured',
    };
  }
  try {
    const out = await createRealtimeSessionWithEnv(env, {
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_REALTIME_MODEL,
      guestProfile: {
        label: 'health-check',
        instructions: 'Run connectivity diagnostics and terminate.',
      },
    });
    return {
      ok: true,
      duration_ms: Date.now() - start,
      session: {
        id: out?.id ?? 'unknown',
        model: out?.model ?? env.OPENAI_REALTIME_MODEL,
        modalities: out?.modalities ?? null,
        expires_at: out?.expires_at ?? null,
      },
    };
  } catch (error: any) {
    const message = error?.message || String(error);
    healthLog.error(
      `${style.status('realtime', 'error')} ${style.kv('error', message)}`,
      error
    );
    return {
      ok: false,
      duration_ms: Date.now() - start,
      error: message,
    };
  }
}

async function findConnectorClient(target: ConnectorProbeTarget): Promise<{
  client_id: string;
  redirect_uri: string;
} | null> {
  for (const candidate of target.redirectCandidates) {
    const match = await prisma.mcp_oauth_clients.findFirst({
      where: {
        redirect_uris: {
          array_contains: candidate,
        },
      },
      orderBy: { created_at: 'desc' },
    });
    if (match) {
      return { client_id: match.client_id, redirect_uri: candidate };
    }
  }
  return null;
}

type ProbeUser = {
  userId: string;
  email: string;
  password: string;
  refreshToken: string;
};

async function createProbeUser(label: string): Promise<ProbeUser> {
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Supabase service credentials are not configured');
  }
  const adminHeaders = {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  };
  const uniq = crypto.randomBytes(6).toString('hex');
  const email = `health_${label}_${uniq}@dexter.cash`;
  const password = `Hp_${crypto.randomBytes(12).toString('hex')}`;

  const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createJson = await createResp.json().catch(() => null);
  if (!createResp.ok) {
    throw new Error(`supabase_admin_create_failed:${createResp.status}`);
  }
  const userId = createJson?.user?.id || createJson?.id;
  if (!userId) {
    throw new Error('supabase_admin_create_missing_user_id');
  }

  const signResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email, password }),
  });
  const signJson = await signResp.json().catch(() => null);
  if (!signResp.ok) {
    throw new Error(`supabase_password_signin_failed:${signResp.status}`);
  }
  const refreshToken = signJson?.refresh_token;
  if (!refreshToken) {
    throw new Error('supabase_missing_refresh_token');
  }

  return { userId, email, password, refreshToken };
}

async function deleteProbeUser(user: ProbeUser | null) {
  if (!user) return;
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.userId}`, {
      method: 'DELETE',
      headers: {
        apikey: SERVICE_KEY,
        authorization: `Bearer ${SERVICE_KEY}`,
      },
    });
  } catch (err) {
    healthLog.warn(
      `${style.status('cleanup', 'warn')} ${style.kv('user', user.userId)} ${style.kv('error', err instanceof Error ? err.message : String(err))}`
    );
  }
}

async function probeConnector(target: ConnectorProbeTarget): Promise<ConnectorProbeResult> {
  const start = Date.now();
  const apiBase = `http://127.0.0.1:${env.PORT}/api/`;
  const result: ConnectorProbeResult = {
    ok: false,
    duration_ms: 0,
    client_id: null,
    redirect_uri: null,
    request_id: null,
    code: null,
    supabase_user_id: null,
  };
  let user: ProbeUser | null = null;
  try {
    const client = await findConnectorClient(target);
    if (!client) {
      throw new Error('client_not_found');
    }
    result.client_id = client.client_id;
    result.redirect_uri = client.redirect_uri;

    user = await createProbeUser(target.name);

    const authorizeUrl = new URL('connector/oauth/authorize', apiBase);
    authorizeUrl.searchParams.set('client_id', client.client_id);
    authorizeUrl.searchParams.set('redirect_uri', client.redirect_uri);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('response_mode', 'json');
    authorizeUrl.searchParams.set('scope', 'wallet.read wallet.trade openid');
    authorizeUrl.searchParams.set('state', `health-${target.name}-${Date.now()}`);

    const authResp = await fetch(authorizeUrl.toString());
    const authJson = await authResp.json().catch(() => null);
    if (!authResp.ok || !authJson?.request_id) {
      throw new Error(`authorize_failed:${authResp.status}`);
    }
    result.request_id = String(authJson.request_id).slice(0, 24);

    const exchangeResp = await fetch(new URL('connector/oauth/exchange', apiBase).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: authJson.request_id, refresh_token: user.refreshToken }),
    });
    const exchangeJson = await exchangeResp.json().catch(() => null);
    if (!exchangeResp.ok || !exchangeJson?.code) {
      throw new Error(`exchange_failed:${exchangeResp.status}`);
    }
    result.code = String(exchangeJson.code).slice(0, 24);

    const tokenResp = await fetch(new URL('connector/oauth/token', apiBase).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: exchangeJson.code }),
    });
    const tokenJson = await tokenResp.json().catch(() => null);
    if (!tokenResp.ok || !tokenJson?.access_token) {
      throw new Error(`token_failed:${tokenResp.status}`);
    }
    result.supabase_user_id = tokenJson?.supabase_user_id ?? null;

    const userinfoResp = await fetch(new URL('connector/oauth/userinfo', apiBase).toString(), {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userinfoResp.ok) {
      throw new Error(`userinfo_failed:${userinfoResp.status}`);
    }

    result.ok = true;
  } catch (error: any) {
    const message = error?.message || String(error);
    result.error = message;
    healthLog.error(
      `${style.status('connector', 'error')} ${style.kv('target', target.name)} ${style.kv('error', message)}`,
      error
    );
  } finally {
    result.duration_ms = Date.now() - start;
    await deleteProbeUser(user);
  }
  return result;
}

async function handleHealthFull(req: Request, res: Response) {
  if (!env.HEALTH_PROBE_TOKEN) {
    return res.status(503).json({ ok: false, error: 'HEALTH_PROBE_TOKEN not configured' });
  }

  const headerToken = Array.isArray(req.headers['x-health-token'])
    ? req.headers['x-health-token'][0]
    : (req.headers['x-health-token'] as string | undefined);
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (headerToken !== env.HEALTH_PROBE_TOKEN && queryToken !== env.HEALTH_PROBE_TOKEN) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const hasHealthToken =
    headerToken === env.HEALTH_PROBE_TOKEN || queryToken === env.HEALTH_PROBE_TOKEN;

  if (!hasHealthToken) {
    const authorization = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;
    if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
      return res.status(403).json({ ok: false, error: 'admin_required' });
    }

    const accessToken = authorization.split(' ')[1]?.trim();
    if (!accessToken) {
      return res.status(403).json({ ok: false, error: 'admin_required' });
    }

    let requesterUser: any = null;
    try {
      requesterUser = await getSupabaseUserFromAccessToken(accessToken);
    } catch (error: any) {
      healthLog.warn(
        `${style.status('auth', 'warn')} ${style.kv('error', error?.message || error)}`,
        error
      );
      return res.status(403).json({ ok: false, error: 'admin_required' });
    }

    if (!isAdminUser(requesterUser)) {
      return res.status(403).json({ ok: false, error: 'admin_required' });
    }
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({
      ok: false,
      error: 'Supabase service credentials are not configured',
    });
  }

  const started = Date.now();
  const realtime = await probeRealtime();
  const connectors: Record<string, ConnectorProbeResult> = {};
  for (const target of CONNECTOR_PROBE_TARGETS) {
    connectors[target.name] = await probeConnector(target);
  }

  const allOk =
    realtime.ok &&
    Object.values(connectors).every((c) => c.ok);

  const payload = {
    ok: allOk,
    service: 'dexter-health',
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - started,
    realtime,
    connectors,
  };

  try {
    fs.mkdirSync(path.dirname(HEALTH_CACHE_PATH), { recursive: true });
    fs.writeFileSync(HEALTH_CACHE_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    healthLog.warn(
      `${style.status('cache', 'warn')} ${style.kv('path', HEALTH_CACHE_PATH)} ${style.kv('error', err instanceof Error ? err.message : String(err))}`
    );
  }

  res.json(payload);
}

function handleHealthDeep(_req: Request, res: Response) {
  try {
    const raw = fs.readFileSync(HEALTH_CACHE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return res.json({ ok: true, cached: true, snapshot: parsed });
  } catch (error: any) {
    const message = error?.code === 'ENOENT'
      ? 'No deep health snapshot recorded yet'
      : (error?.message || String(error));
    return res.status(error?.code === 'ENOENT' ? 404 : 500).json({ ok: false, error: message });
  }
}

app.post('/health/full', handleHealthFull);
app.post('/api/health/full', handleHealthFull);

app.get('/health/deep', handleHealthDeep);
app.get('/api/health/deep', handleHealthDeep);
