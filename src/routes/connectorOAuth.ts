import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { exchangeRefreshToken, getConnectorTokenTTLSeconds } from '../utils/supabaseAdmin.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function registerConnectorOAuthRoutes(app: Express) {
  // Lightweight authorize handler: instructs clients to open the Dexter login page.
  app.get('/api/connector/oauth/authorize', async (req: Request, res: Response) => {
    const { redirect_uri: redirectUri, state, scope } = req.query as Record<string, string | undefined>;
    const loginUrl = process.env.CONNECTOR_LOGIN_URL || 'https://dexter.cash/login';

    return res.json({
      ok: true,
      action: 'login_required',
      login_url: loginUrl,
      redirect_uri: redirectUri || null,
      state: state || null,
      scope: scope || null,
      note: 'Open login_url to authenticate, then submit the refresh token to the token endpoint.',
    });
  });

  app.post('/api/connector/oauth/token', async (req: Request, res: Response) => {
    try {
      const grantType = String(req.body?.grant_type || '').trim();
      if (grantType !== 'refresh_token') {
        return res.status(400).json({ ok: false, error: 'unsupported_grant_type' });
      }

      const refreshToken = String(req.body?.refresh_token || '').trim();
      if (!refreshToken) {
        return res.status(400).json({ ok: false, error: 'refresh_token_required' });
      }

      const ttlSeconds = getConnectorTokenTTLSeconds();
      const supabaseSession = await exchangeRefreshToken(refreshToken);
      const expiresIn = supabaseSession.expires_in || ttlSeconds;
      const accessToken = supabaseSession.access_token;
      const nextRefreshToken = supabaseSession.refresh_token || refreshToken;
      const supabaseUserId = supabaseSession.user?.id || null;

      if (!accessToken) {
        return res.status(502).json({ ok: false, error: 'supabase_session_missing_access_token' });
      }

      // TODO: persist hashed tokens in connector_sessions once migration is ready.
      const tokenPreview = hashToken(accessToken).slice(0, 12);
      console.log('[connector/oauth/token] issued', {
        supabaseUserId,
        expiresIn,
        preview: tokenPreview,
      });

      return res.json({
        ok: true,
        token_type: 'bearer',
        access_token: accessToken,
        refresh_token: nextRefreshToken,
        expires_in: expiresIn,
        supabase_user_id: supabaseUserId,
      });
    } catch (error: any) {
      console.error('[connector/oauth/token] error', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
