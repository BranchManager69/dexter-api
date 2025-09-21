import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import prisma from '../prisma.js';
import { exchangeRefreshToken, getConnectorTokenTTLSeconds, getSupabaseUserFromAccessToken } from '../utils/supabaseAdmin.js';

const DEFAULT_ALLOWED_REDIRECTS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://chatgpt.com/connector_platform_oauth_redirect',
  'https://chat.openai.com/connector_platform_oauth_redirect',
  'https://dexter.cash/mcp/callback',
  'https://mcp.dexter.cash/callback',
  'https://branch.bet/mcp/callback',
  'https://branch.bet/callback',
];

const DEFAULT_ALLOWED_CLIENT_IDS = [
  process.env.CONNECTOR_CLAUDE_CLIENT_ID || 'cid_59e99d1247b444bca4631382ecff3e36',
  process.env.TOKEN_AI_OIDC_CLIENT_ID || 'cid_a859560609a6448aa2f3a1c29f6ab496',
  process.env.TOKEN_AI_OIDC_CLIENT_ID_CHATGPT || '',
].filter((value, index, array) => !!value && array.indexOf(value) === index);

const allowedRedirects = (() => {
  const extras = (process.env.CONNECTOR_ALLOWED_REDIRECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set<string>();
  for (const value of [...DEFAULT_ALLOWED_REDIRECTS, ...extras]) {
    const normalized = normalizeRedirectUri(value);
    if (normalized) set.add(normalized);
  }
  return set;
})();

const allowedClientIds = (() => {
  const extras = (process.env.CONNECTOR_ALLOWED_CLIENT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set<string>();
  for (const value of [...DEFAULT_ALLOWED_CLIENT_IDS, ...extras]) {
    if (value) set.add(value);
  }
  return set;
})();

const mobileRedirectTemplatesByClientId = new Map<string, string>();
const mobileRedirectTemplatesByRedirect = new Map<string, string>();
const defaultPlatformByClientId = new Map<string, string>();

function registerMobileRedirectTemplate(key: string, template: string) {
  if (!key || !template) return;
  if (/^https?:\/\//i.test(key)) {
    const normalized = normalizeRedirectUri(key);
    if (normalized) mobileRedirectTemplatesByRedirect.set(normalized, template);
    return;
  }
  mobileRedirectTemplatesByClientId.set(key, template);
}

function registerDefaultPlatform(clientId: string, platform: string) {
  if (clientId && platform) {
    defaultPlatformByClientId.set(clientId, platform);
  }
}

(function hydrateMobileRedirectTemplates() {
  const raw = process.env.CONNECTOR_MOBILE_REDIRECTS || '';
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [key, template] = entry.split('|');
    if (!key || !template) {
      console.warn('[connector/oauth] Ignoring CONNECTOR_MOBILE_REDIRECTS entry (expected "id|template")', entry);
      continue;
    }
    registerMobileRedirectTemplate(key.trim(), template.trim());
  }
})();

type RedirectTemplateContext = {
  code: string;
  code_encoded: string;
  state: string;
  state_encoded: string;
  redirect_uri: string;
  redirect_uri_encoded: string;
  redirect_url: string;
  redirect_url_encoded: string;
  platform: string;
  platform_encoded: string;
};

function applyRedirectTemplate(template: string, ctx: RedirectTemplateContext): string {
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_match, key) => {
    const normalized = String(key || '').toLowerCase();
    const value = (ctx as Record<string, string>)[normalized];
    return value != null ? value : '';
  });
}

function resolveMobileRedirectTemplate(clientId: string, redirectUri: string): string | null {
  const direct = mobileRedirectTemplatesByClientId.get(clientId);
  if (direct) return direct;
  const byUri = mobileRedirectTemplatesByRedirect.get(normalizeRedirectUri(redirectUri) || redirectUri);
  return byUri || null;
}

function buildMobileRedirectUrl(
  clientId: string,
  redirectUri: string,
  redirectUrl: string,
  code: string,
  state: string | null,
  platform: string | null | undefined,
): string | null {
  const template = resolveMobileRedirectTemplate(clientId, redirectUri);
  if (!template) return null;
  const platformHint = platform || defaultPlatformByClientId.get(clientId) || '';
  const ctx: RedirectTemplateContext = {
    code,
    code_encoded: encodeURIComponent(code),
    state: state || '',
    state_encoded: encodeURIComponent(state || ''),
    redirect_uri: redirectUri,
    redirect_uri_encoded: encodeURIComponent(redirectUri),
    redirect_url: redirectUrl,
    redirect_url_encoded: encodeURIComponent(redirectUrl),
    platform: platformHint,
    platform_encoded: encodeURIComponent(platformHint),
  };
  const candidate = applyRedirectTemplate(template, ctx).trim();
  if (!candidate) return null;
  try {
    // Validate format without altering non-HTTP schemes (chatgpt:// etc.).
    const parsed = new URL(candidate);
    return parsed.toString();
  } catch {
    // Allow custom schemes (e.g., claude://) by falling back to manual return when URL constructor rejects.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      return candidate;
    }
    console.warn('[connector/oauth] Ignoring mobile redirect candidate due to invalid format', { clientId, candidate });
    return null;
  }
}

function detectPlatformFromUserAgent(ua: string | undefined): 'ios' | 'android' | null {
  if (!ua) return null;
  const lowered = ua.toLowerCase();
  if (lowered.includes('android')) return 'android';
  if (lowered.includes('iphone') || lowered.includes('ipad') || lowered.includes('ipod')) return 'ios';
  return null;
}

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
async function cleanupExpired() {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    await Promise.all([
      prisma.connector_oauth_requests.deleteMany({ where: { created_at: { lt: cutoff } } }),
      prisma.connector_oauth_codes.deleteMany({ where: { created_at: { lt: cutoff } } }),
    ]);
  } catch (error) {
    console.error('[connector/oauth] cleanup failed', (error as Error)?.message || error);
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
  // Structured flow logging (non-invasive). Helps correlate authorize → exchange → token.
  const seenRequestIds: Set<string> = new Set();
  const seenCodes: Set<string> = new Set();
  function logFlow(event: string, props: Record<string, unknown> = {}) {
    try {
      const payload = {
        ts: new Date().toISOString(),
        event,
        ip: (props.ip as string) || '',
        ua: (props.ua as string) || '',
        ...props,
      };
      // Single-line JSON for easy grep
      console.log('[oauth-flow]', JSON.stringify(payload));
    } catch {}
  }
  app.get('/api/connector/oauth/authorize', async (req: Request, res: Response) => {
    await cleanupExpired();

    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id.trim() : '';
    const redirectUri = normalizeRedirectUri(req.query.redirect_uri as string | undefined);
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const codeChallenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : null;
    const codeChallengeMethod = typeof req.query.code_challenge_method === 'string' ? req.query.code_challenge_method : null;
    const scope = typeof req.query.scope === 'string' ? req.query.scope : null;

    if (!clientId || !redirectUri) {
      return res.status(400).json({ ok: false, error: 'invalid_request', message: 'client_id and redirect_uri are required' });
    }

    // Authorize if client is in static/env allowlist OR registered via DCR (DB lookup)
    let dcrAllowed = false;
    if (!(allowedClientIds.size && allowedClientIds.has(clientId))) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found: any = await prisma.mcp_oauth_clients.findUnique({ where: { client_id: clientId } });
        if (found) {
          // Enforce redirect_uri matches one of the registered URIs
          const list = Array.isArray(found.redirect_uris) ? (found.redirect_uris as unknown[]).map((x) => String(x)) : [];
          if (!list.includes(redirectUri)) {
            return res.status(400).json({ ok: false, error: 'invalid_redirect', message: 'redirect_uri not registered for client' });
          }
          dcrAllowed = true;
        }
      } catch (e) {
        console.warn('[connector/oauth/authorize] DCR lookup failed', (e as Error)?.message || e);
      }
      if (!dcrAllowed) {
        return res.status(400).json({ ok: false, error: 'unauthorized_client', message: 'client_id not allowed' });
      }
    } else {
      // Static clients must use an allowed redirect
      if (!allowedRedirects.has(redirectUri)) {
        return res.status(400).json({ ok: false, error: 'invalid_redirect', message: 'redirect_uri not allowed' });
      }
    }

    const requestId = randomToken('auth');
    try {
      await prisma.connector_oauth_requests.create({
        data: {
          id: requestId,
          client_id: clientId,
          redirect_uri: redirectUri,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: codeChallengeMethod,
          scope,
        },
      });
    } catch (error) {
      console.error('[connector/oauth/authorize] failed to persist request', (error as Error)?.message || error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }

    const redirect = new URL('/connector/auth', resolveAppBase());
    redirect.searchParams.set('request_id', requestId);

    console.log('[connector/oauth/authorize] issued request', { requestId, clientId, redirect_uri: redirectUri, scope });
    logFlow('authorize_issued', {
      request_id: requestId,
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      ip: req.ip,
      ua: req.headers['user-agent'] || req.headers['User-Agent'] || '',
    });

    const loginUrl = redirect.toString();
    const accepts = (req.headers['accept'] || req.headers['Accept'] || '') as string;
    const responseMode = typeof req.query.response_mode === 'string' ? req.query.response_mode.toLowerCase() : '';
    const preferJson = responseMode === 'json' || (accepts && accepts.includes('application/json'));

    const payload = {
      ok: true,
      request_id: requestId,
      login_url: loginUrl,
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope,
    };

    if (preferJson) {
      return res.json(payload);
    }

    return res.redirect(302, loginUrl);
  });

  app.get('/api/connector/oauth/request', async (req: Request, res: Response) => {
    const requestId = typeof req.query.request_id === 'string' ? req.query.request_id : '';
    if (!requestId) {
      return res.status(400).json({ ok: false, error: 'missing_request_id' });
    }
    let entry;
    try {
      entry = await prisma.connector_oauth_requests.findUnique({ where: { id: requestId } });
    } catch (error) {
      console.error('[connector/oauth/request] lookup failed', (error as Error)?.message || error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
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
    await cleanupExpired();

    const requestId = getParam(req, 'request_id').trim();
    const refreshToken = getParam(req, 'refresh_token').trim();

    if (!requestId || !refreshToken) {
      return res.status(400).json({ ok: false, error: 'invalid_request' });
    }

    let requestEntry;
    try {
      requestEntry = await prisma.connector_oauth_requests.findUnique({ where: { id: requestId } });
    } catch (error) {
      console.error('[connector/oauth/exchange] lookup failed', (error as Error)?.message || error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
    if (!requestEntry) {
      return res.status(404).json({ ok: false, error: 'request_not_found' });
    }

    try {
      logFlow('exchange_start', {
        request_id: requestId,
        has_refresh_token: !!refreshToken,
        client_id: requestEntry.client_id,
        ip: req.ip,
        ua: req.headers['user-agent'] || req.headers['User-Agent'] || '',
        duplicate_request: seenRequestIds.has(requestId),
      });
      seenRequestIds.add(requestId);
      // Do NOT refresh here. Store the supplied refresh_token and issue a code.
      // Actual refresh happens once during authorization_code exchange to avoid single-use token errors.
      const accessToken = '';
      const nextRefreshToken = refreshToken;
      const supabaseUserId = null;
      const expiresIn = getConnectorTokenTTLSeconds();

      const code = randomToken('code');
      await prisma.$transaction(async (tx) => {
        await tx.connector_oauth_requests.deleteMany({ where: { id: requestId } });
        await tx.connector_oauth_codes.create({
          data: {
            code,
            client_id: requestEntry.client_id,
            redirect_uri: requestEntry.redirect_uri,
            state: requestEntry.state,
            code_challenge: requestEntry.code_challenge,
            code_challenge_method: requestEntry.code_challenge_method,
            scope: requestEntry.scope,
            refresh_token: nextRefreshToken,
            access_token: accessToken,
            supabase_user_id: supabaseUserId,
            expires_in: expiresIn,
          },
        });
      });

      console.log('[connector/oauth/exchange] issued code', { codePreview: code.slice(0, 12), supabaseUserId });
      logFlow('exchange_issued_code', {
        request_id: requestId,
        code_preview: code.slice(0, 12),
        client_id: requestEntry.client_id,
        redirect_uri: requestEntry.redirect_uri,
      });

      const redirectUrl = new URL(requestEntry.redirect_uri);
      redirectUrl.searchParams.set('code', code);
      if (requestEntry.state) {
        redirectUrl.searchParams.set('state', requestEntry.state);
      }
      const redirectUrlString = redirectUrl.toString();
      const userAgent = (req.headers['user-agent'] || req.headers['User-Agent']) as string | undefined;
      const platform = detectPlatformFromUserAgent(userAgent);
      const mobileRedirectUrl = buildMobileRedirectUrl(
        requestEntry.client_id,
        requestEntry.redirect_uri,
        redirectUrlString,
        code,
        requestEntry.state,
        platform,
      );

      const payload: Record<string, unknown> = {
        ok: true,
        redirect_uri: requestEntry.redirect_uri,
        redirect_url: redirectUrlString,
        code,
        state: requestEntry.state,
      };
      if (mobileRedirectUrl) {
        payload.mobile_redirect_url = mobileRedirectUrl;
      }

      return res.json(payload);
    } catch (error: any) {
      console.error('[connector/oauth/exchange] failed', error?.message || error);
      logFlow('exchange_failed', {
        request_id: requestId,
        error: (error?.message || String(error)),
      });
      return res.status(500).json({ ok: false, error: 'exchange_failed' });
    }
  });

  app.post('/api/connector/oauth/token', async (req: Request, res: Response) => {
    await cleanupExpired();

    const grantType = getParam(req, 'grant_type').trim();

    if (grantType === 'authorization_code') {
      const code = getParam(req, 'code').trim();
      if (!code) return res.status(400).json({ error: 'invalid_request' });

      let record;
      try {
        record = await prisma.connector_oauth_codes.findUnique({ where: { code } });
      } catch (error) {
        console.error('[connector/oauth/token] lookup failed', (error as Error)?.message || error);
        return res.status(500).json({ error: 'invalid_grant' });
      }
      if (!record) {
        return res.status(400).json({ error: 'invalid_grant' });
      }

      logFlow('token_code_start', {
        code_preview: code.slice(0, 12),
        client_id: record.client_id,
        duplicate_token_call: seenCodes.has(code),
        ip: req.ip,
        ua: req.headers['user-agent'] || req.headers['User-Agent'] || '',
      });
      seenCodes.add(code);

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
        await prisma.connector_oauth_codes.delete({ where: { code } });
        const refreshed = await exchangeRefreshToken(record.refresh_token);
        const accessToken = refreshed.access_token;
        const refreshToken = refreshed.refresh_token || record.refresh_token;
        const supabaseUserId = refreshed.user?.id || record.supabase_user_id;
        const expiresIn = refreshed.expires_in || record.expires_in || getConnectorTokenTTLSeconds();

        const body = {
          token_type: 'bearer',
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: expiresIn,
          supabase_user_id: supabaseUserId,
          scope: record.scope || undefined,
        } as const;
        logFlow('token_code_success', {
          code_preview: code.slice(0, 12),
          client_id: record.client_id,
          supabase_user_id: supabaseUserId,
        });
        return res.json(body);
      } catch (error: any) {
        console.error('[connector/oauth/token] authorization_code failed', error?.message || error);
        logFlow('token_code_failed', {
          code_preview: code.slice(0, 12),
          client_id: record.client_id,
          error: (error?.message || String(error)),
        });
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
        const body = {
          token_type: 'bearer',
          access_token: accessToken,
          refresh_token: nextRefreshToken,
          expires_in: expiresIn,
          supabase_user_id: supabaseUserId,
        } as const;
        logFlow('token_refresh_success', { supabase_user_id: supabaseUserId });
        return res.json(body);
      } catch (error: any) {
        console.error('[connector/oauth/token] refresh_token failed', error?.message || error);
        logFlow('token_refresh_failed', { error: (error?.message || String(error)) });
        return res.status(400).json({ error: 'invalid_grant' });
      }
    }

    return res.status(400).json({ error: 'unsupported_grant_type' });
  });

  app.get('/api/connector/oauth/userinfo', async (req: Request, res: Response) => {
    const header = req.headers['authorization'] || req.headers['Authorization'];
    const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '').trim() : '';
    if (!token) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    try {
      const user = await getSupabaseUserFromAccessToken(token);
      return res.json({
        sub: user.id,
        email: user.email || null,
        app_metadata: user.app_metadata || {},
        user_metadata: user.user_metadata || {},
      });
    } catch (error: any) {
      console.error('[connector/oauth/userinfo] failed', error?.message || error);
      return res.status(401).json({ error: 'invalid_token' });
    }
  });
}
