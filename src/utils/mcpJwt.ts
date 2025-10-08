import jwt from 'jsonwebtoken';
import type { Env } from '../env.js';
import { logger, style } from '../logger.js';

const log = logger.child('mcpJwt');

export type McpJwtPayload = {
  supabase_user_id: string | null;
  supabase_email?: string | null;
  scope?: string | null;
  wallet_public_key?: string | null;
  roles?: string[] | null;
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

  const tokenPayload: Record<string, any> = {
    iss: resolveIssuer(env.MCP_URL),
    aud: resolveIssuer(env.MCP_URL),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    sub: subject,
    supabase_user_id: supabaseUserId,
  };

  const optionalClaims: Array<'supabase_email' | 'scope'> = [];

  if (payload.supabase_email) {
    tokenPayload.supabase_email = payload.supabase_email;
    optionalClaims.push('supabase_email');
  }
  if (payload.scope) {
    tokenPayload.scope = payload.scope;
    optionalClaims.push('scope');
  }
  if (payload.wallet_public_key) {
    tokenPayload.wallet_public_key = payload.wallet_public_key;
  }
  if (Array.isArray(payload.roles) && payload.roles.length > 0) {
    const normalizedRoles = payload.roles
      .map((role) => {
        if (role == null) {
          return '';
        }
        return String(role).trim().toLowerCase();
      })
      .filter(Boolean);
    if (normalizedRoles.length > 0) {
      const uniqueRoles = Array.from(new Set(normalizedRoles)).sort();
      tokenPayload.roles = uniqueRoles;
    }
  }

  const BEARER_PREFIX = 'Bearer ';
  const MAX_AUTH_HEADER_LENGTH = 512;
  const MAX_TOKEN_LENGTH = MAX_AUTH_HEADER_LENGTH - BEARER_PREFIX.length;

  const signToken = (payloadToSign: Record<string, any>) =>
    jwt.sign(payloadToSign, secret, {
      algorithm: 'HS256',
      header: {
        typ: 'JWT',
        alg: 'HS256',
      },
    });

  const trySign = (payloadToSign: Record<string, any>) => {
    const token = signToken(payloadToSign);
    const headerLength = BEARER_PREFIX.length + token.length;
    return { token, headerLength };
  };

  const payloadForSigning: Record<string, any> = { ...tokenPayload };
  let { token, headerLength } = trySign(payloadForSigning);
  if (headerLength <= MAX_AUTH_HEADER_LENGTH && token.length <= MAX_TOKEN_LENGTH) {
    return token;
  }

  const trimmed: string[] = [];
  for (const claim of optionalClaims) {
    if (payloadForSigning[claim] === undefined) {
      continue;
    }
    delete payloadForSigning[claim];
    trimmed.push(claim);

    ({ token, headerLength } = trySign(payloadForSigning));
    if (headerLength <= MAX_AUTH_HEADER_LENGTH && token.length <= MAX_TOKEN_LENGTH) {
      if (trimmed.length) {
        log.warn(
          `${style.status('mcp_jwt', 'warn')} ${style.kv('event', 'trimmed_claims')} ${style.kv('claims', trimmed.join(','))} ${style.kv('header_length', headerLength)}`,
        );
      }
      return token;
    }
  }

  log.error(
    `${style.status('mcp_jwt', 'error')} ${style.kv('error', 'jwt_too_long')} ${style.kv('header_length', headerLength)} ${style.kv('token_length', token.length)}`,
    {
      trimmed,
      headerLength,
      tokenLength: token.length,
    },
  );
  return null;
}
