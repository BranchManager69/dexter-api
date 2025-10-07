import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { logger, style } from '../logger.js';
import { getSupabaseUserFromAccessToken } from '../utils/supabaseAdmin.js';

function extractBearerToken(req: Request): string | null {
  const rawAuth = req.headers['authorization'] || req.headers['Authorization'];
  if (!rawAuth) return null;
  const header = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function extractRoles(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry == null) return '';
        return String(entry).trim().toLowerCase();
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered ? [lowered] : [];
  }
  return [];
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    return lowered === 'true' || lowered === '1' || lowered === 'yes';
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return false;
}

function extractSupabaseAuthStatus(error: unknown): number | null {
  const message = typeof error === 'string'
    ? error
    : typeof (error as any)?.message === 'string'
      ? (error as any).message
      : null;

  if (!message) return null;

  const match = /^supabase_userinfo_failed:(\d+)/.exec(message);
  if (!match) return null;

  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export function registerDossierRoutes(app: Express) {
  const log = logger.child('dossier');

  app.get('/api/dossier', async (req: Request, res: Response) => {
    try {
      const bearerToken = extractBearerToken(req);
      if (!bearerToken) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      let user: Awaited<ReturnType<typeof getSupabaseUserFromAccessToken>>;
      try {
        user = await getSupabaseUserFromAccessToken(bearerToken);
      } catch (supabaseError: any) {
        const statusCode = extractSupabaseAuthStatus(supabaseError);
        if (statusCode && statusCode >= 400 && statusCode < 500) {
          log.warn(
            `${style.status('dossier', 'warn')} ${style.kv('auth_status', statusCode)} ${style.kv('reason', 'supabase_user_lookup_failed')}`,
            { statusCode }
          );
          return res.status(401).json({ ok: false, error: 'authentication_required' });
        }
        throw supabaseError;
      }
      const roles = extractRoles(user.app_metadata?.roles);
      const isSuperAdmin = roles.includes('superadmin') || normalizeBoolean(user.user_metadata?.isSuperAdmin);
      const isAdmin = roles.includes('admin') || normalizeBoolean(user.user_metadata?.isAdmin);

      if (!isSuperAdmin && !isAdmin) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const targetSupabaseUserId = typeof req.query?.supabaseUserId === 'string' && req.query.supabaseUserId.trim().length
        ? req.query.supabaseUserId.trim()
        : String(user.id);

      const profile = await prisma.user_profiles.findFirst({
        where: { supabase_user_id: targetSupabaseUserId },
      });

      const memoriesTotal = await prisma.user_memories.count({
        where: { supabase_user_id: targetSupabaseUserId },
      });

      const skippedTotal = await prisma.conversation_logs.count({
        where: {
          supabase_user_id: targetSupabaseUserId,
          status: 'skipped',
        },
      });

      return res.json({
        ok: true,
        user: {
          id: String(user.id),
          email: user.email ?? null,
          roles,
          isSuperAdmin,
          isAdmin,
        },
        target: {
          supabaseUserId: targetSupabaseUserId,
          preferredName: profile?.preferred_name ?? null,
          displayName: profile?.display_name ?? null,
          twitterHandle: profile?.twitter_handle ?? null,
          metadata: profile?.metadata ?? {},
          updatedAt: profile?.updated_at ?? null,
          onboardedAt: profile?.onboarded_at ?? null,
        },
        dossier: profile?.dossier ?? null,
        stats: {
          memoriesTotal,
          skippedTotal,
        },
      });
    } catch (error: any) {
      log.error(
        `${style.status('dossier', 'error')} ${style.kv('error', error?.message || error)}`,
        error
      );
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
