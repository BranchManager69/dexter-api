import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { exchangeRefreshToken, getConnectorTokenTTLSeconds } from '../utils/supabaseAdmin.js';

type PendingAuthRequest = {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  scope: string | null;
  createdAt: number;
};

type AuthorizationCodeRecord = {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  scope: string | null;
  refresh_token: string;
  access_token: string;
  supabase_user_id: string | null;
  expiresIn: number;
  createdAt: number;
};

const pendingAuthRequests = new Map<string, PendingAuthRequest>();
const authorizationCodes = new Map<string, AuthorizationCodeRecord>();

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(18).toString('hex')}`;
}

function base64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlSha256(input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest();
  return base64Url(hash);
}

function cleanupExpired() {
  const now = Date.now();
  const authTtl = 5 * 60 * 1000; // 5 minutes
  const codeTtl = 5 * 60 * 1000; // 5 minutes
  for (const [id, entry] of pendingAuthRequests.entries()) {
    if (now - entry.createdAt > authTtl) {
      pendingAuthRequests.delete(id);
    }
  }
  for (const [code, entry] of authorizationCodes.entries()) {
    if (now - entry.createdAt > codeTtl) {
      authorizationCodes.delete(code);
    }
  }
}

function normalizeRedirectUri(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function resolveAppBase(): string {
  const configured = process.env.CONNECTOR_LOGIN_BASE || process.env.PUBLIC_CONNECTOR_BASE;
  if (configured) return configured.replace(/\/$/, '');
  return 'https://dexter.cash';
}

function getParam(req: Request, key: string): string {
  const body: any = req.body || {};
  if (body && typeof body === 'object' && body[key] != null) {
    const value = body[key];
    if (Array.isArray(value)) return value.length ? String(value[0]) : '';
    return String(value);
  }
  const query: any = req.query || {};
  if (query && typeof query === 'object' && query[key] != null) {
    const value = query[key];
    if (Array.isArray(value)) return value.length ? String(value[0]) : '';
    return String(value);
  }
  return '';
}

export function registerConnectorOAuthRoutes(app: Express) {
  app.get('/api/connector/oauth/authorize', (req: Request, res: Response) => {
    cleanupExpired();

    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';
    const redirectUri = normalizeRedirectUri(req.query.redirect_uri as string | undefined);
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const codeChallenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : null;
    const codeChallengeMethod = typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : null;
    const scope = typeof req.query.scope === 'string' ? req.query.scope : null;

    if (!clientId || !redirectUri) {
      return res.status(400).json({ ok: false, error: 'invalid_request', message: 'client_id and redirect_uri are required' });
    }

    const requestId = randomToken('auth');
    pendingAuthRequests.set(requestId, {
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scope,
      createdAt: Date.now(),
    });

    const redirect = new URL('/connector/auth', resolveAppBase());
    redirect.searchParams.set('request_id', requestId);

    console.log('[connector/oauth/authorize] issued request', { requestId, clientId, redirect_uri: redirectUri, scope });

    return res.json({
      ok: true,
      request_id: requestId,
      login_url: redirect.toString(),
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope,
    });
  });

  app.get('/api/connector/oauth/request', (req: Request, res: Response) => {
    const requestId = typeof req.query.request_id === 'string' ? req.query.request_id : '';
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'missing_request_id' });
    }
    const entry = pendingAuthRequests.get(requestId);
    if (!entry) {
      return res.status(404).json({ ok: false, error: 'request_not_found' });
    }
    res.json({ ok: true, request: {
      client_id: entry.client_id,
      redirect_uri: entry.redirect_uri,
      state: entry.state,
      scope: entry.scope,
    }});
  });

  app.post('/api/connector/oauth/exchange', async (req: Request, res: Response) => {
    cleanupExpired();

    const requestId = getParam(req, 'request_id').trim();
    const refreshToken = getParam(req, 'refresh_token').trim();

    if (!requestId || !refreshToken) {
      return res.status(400).json({ ok: false, error: 'invalid_request' });
    }

    const requestEntry = pendingAuthRequests.get(requestId);
    if (!requestEntry) {
      return res.status(404).json({ ok: false, error: 'request_not_found' });
    }

    try {
      const supSession = await exchangeRefreshToken(refreshToken);
      const accessToken = supSession.access_token;
      const nextRefreshToken = supSession.refresh_token || refreshToken;
      const supabaseUserId = supSession.user?.id || null;
      const expiresIn = supSession.expires_in || getConnectorTokenTTLSeconds();

      const code = randomToken('code');
      authorizationCodes.set(code, {
        client_id: requestEntry.client_id,
        redirect_uri: requestEntry.redirect_uri,
        state: requestEntry.state,
        code_challenge: requestEntry.code_challenge,
        code_challenge_method: requestEntry.code_challenge_method,
        scope: requestEntry.scope,
        refresh_token: nextRefreshToken,
        access_token: accessToken,
        supabase_user_id: supabaseUserId,
        expiresIn,
        createdAt: Date.now(),
      });

      pendingAuthRequests.delete(requestId);

      console.log('[connector/oauth/exchange] issued code', { codePreview: code.slice(0, 12), supabaseUserId });

      return res.json({
        ok: true,
        redirect_uri: requestEntry.redirect_uri,
        code,
        state: requestEntry.state,
      });
    } catch (error: any) {
      console.error('[connector/oauth/exchange] failed', error?.message || error);
      return res.status(500).json({ ok: false, error: 'exchange_failed' });
    }
  });

  app.post('/api/connector/oauth/token', async (req: Request, res: Response) => {
    cleanupExpired();

    const grantType = getParam(req, 'grant_type').trim();

    if (grantType === 'authorization_code') {
      const code = getParam(req, 'code').trim();
      if (!code) return res.status(400).json({ error: 'invalid_request' });

      const record = authorizationCodes.get(code);
      if (!record) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      authorizationCodes.delete(code);

      if (record.code_challenge) {
        const verifier = getParam(req, 'code_verifier').trim();
        if (verifier && (record.code_challenge_method || 'S256').toUpperCase() === 'S256') {
          const hashed = base64UrlSha256(verifier);
          if (hashed !== record.code_challenge) {
            return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
          }
        }
      }

      try {
        const refreshed = await exchangeRefreshToken(record.refresh_token);
        const accessToken = refreshed.access_token;
        const refreshToken = refreshed.refresh_token || record.refresh_token;
        const supabaseUserId = refreshed.user?.id || record.supabase_user_id;
        const expiresIn = refreshed.expires_in || record.expiresIn;

        return res.json({
          token_type: 'bearer',
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
          supabase_user_id: supabaseUserId,
          scope: record.scope || undefined,
        });
      } catch (error: any) {
        console.error('[connector/oauth/token] authorization_code failed', error?.message || error);
        return res.status(500).json({ error: 'invalid_grant' });
      }
    }

    if (grantType === 'refresh_token') {
      const refreshToken = getParam(req, 'refresh_token').trim();
      if (!refreshToken) {
        return res.status(400).json({ error: 'invalid_request' });
      }
      try {
        const session = await exchangeRefreshToken(refreshToken);
        const accessToken = session.access_token;
        const nextRefreshToken = session.refresh_token || refreshToken;
        const supabaseUserId = session.user?.id || null;
        const expiresIn = session.expires_in || getConnectorTokenTTLSeconds();
        return res.json({
          token_type: 'bearer',
          access_token: accessToken,
          refresh_token: nextRefreshToken,
          expires_in: expiresIn,
          supabase_user_id: supabaseUserId,
        });
      } catch (error: any) {
        console.error('[connector/oauth/token] refresh_token failed', error?.message || error);
        return res.status(400).json({ error: 'invalid_grant' });
      }
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });
  });
}
