import type { Env } from './env.js';

export type SessionIdentity = {
  sessionType: 'guest' | 'user';
  supabaseUserId?: string | null;
  supabaseEmail?: string | null;
};

export type GuestProfile = {
  label: string;
  instructions?: string;
};

const DEFAULT_REALTIME_VOICE = 'cedar';

export type CreateRealtimeOpts = {
  apiKey: string;
  model: string;
  identity?: SessionIdentity | null;
  guestProfile?: GuestProfile | null;
  mcpJwt?: string | null;
  walletPublicKey?: string | null;
  voice?: string | null;
};

export async function createRealtimeSessionWithEnv(env: Env, opts: CreateRealtimeOpts) {
  const identity: SessionIdentity = opts.identity
    ? {
        sessionType: opts.identity.sessionType,
        supabaseUserId: opts.identity.supabaseUserId ?? null,
        supabaseEmail: opts.identity.supabaseEmail ?? null,
      }
    : {
        sessionType: 'guest',
        supabaseUserId: null,
        supabaseEmail: null,
      };

  const isGuest = identity.sessionType === 'guest';

  const tools: any[] = [];
  const allowedVoice = (env.MCP_ALLOWED_TOOLS_VOICE || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  tools.push({
    type: 'mcp',
    server_label: 'dexter',
    server_url: env.MCP_URL,
    headers: opts.mcpJwt
      ? { Authorization: `Bearer ${opts.mcpJwt}` }
      : env.TOKEN_AI_MCP_TOKEN
        ? { Authorization: `Bearer ${env.TOKEN_AI_MCP_TOKEN}` }
        : undefined,
    require_approval: 'never',
    allowed_tools: allowedVoice.length ? allowedVoice : undefined,
  });

  const baseInstructions =
    'You are Dexter Voice. Be concise and helpful. Use hosted MCP tools to execute wallet, trading, and market actions without extra confirmations.';

  const resolvedVoice = opts.voice?.trim() || env.DEXTER_VOICE_PRIMARY?.trim() || DEFAULT_REALTIME_VOICE;
  const body: any = {
    model: opts.model,
    instructions: baseInstructions,
    tools,
    voice: resolvedVoice,
  };

  if (isGuest) {
    const guestInstructions = opts.guestProfile?.instructions?.trim();
    if (!guestInstructions) {
      throw new Error('Guest concierge instructions missing');
    }
    body.instructions = `${baseInstructions}\n\n${guestInstructions}`;
  }

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
