import jwt from 'jsonwebtoken';
import type { Env } from '../env.js';

export type McpJwtPayload = {
  supabase_user_id: string | null;
  supabase_email?: string | null;
  scope?: string | null;
};

function resolveIssuer(url: string): string {
  try {
    const parsed = new URL(url);
    // Ensure trailing /mcp when URL path is empty or root
    if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
      parsed.pathname = '/mcp';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'https://dexter.cash/mcp';
  }
}

export function issueMcpJwt(
  env: Env,
  payload: McpJwtPayload,
): string | null {
  const secret = env.MCP_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('MCP_JWT_SECRET missing');
  }

  const ttlInput = env.MCP_JWT_TTL_SECONDS ? Number(env.MCP_JWT_TTL_SECONDS) : NaN;
  const ttlSeconds = Number.isFinite(ttlInput) && ttlInput > 0 ? Math.floor(ttlInput) : 900;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const supabaseUserId = payload.supabase_user_id ?? null;
  const subject = supabaseUserId && typeof supabaseUserId === 'string' ? supabaseUserId : 'guest';

  const tokenPayload = {
    iss: resolveIssuer(env.MCP_URL),
    aud: resolveIssuer(env.MCP_URL),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    sub: subject,
    supabase_user_id: supabaseUserId,
    supabase_email: payload.supabase_email ?? null,
    scope: payload.scope ?? null,
  };

  return jwt.sign(tokenPayload, secret, {
    algorithm: 'HS256',
    header: {
      typ: 'JWT',
      alg: 'HS256',
    },
  });
}
