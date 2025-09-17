import type { Express, Request, Response } from 'express';
import prisma from '../../../../config/prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';

export function registerIdentityRoutes(app: Express) {
  app.get('/api/identity/resolve', async (req: Request, res: Response) => {
    try {
      const provider = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
      const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';

      if (!provider || !subject) {
        return res.status(400).json({ ok: false, error: 'missing_params' });
      }

      const link = await prisma.account_links.findUnique({
        where: {
          oauth_provider_oauth_subject: {
            oauth_provider: provider,
            oauth_subject: subject,
          },
        },
      });

      if (!link) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      return res.json({
        ok: true,
        supabase_user_id: link.supabase_user_id,
        linked_at: link.linked_at.toISOString(),
        provider: link.oauth_provider,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.post('/api/identity/link', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const provider = typeof (req.body as any)?.provider === 'string' ? (req.body as any).provider.trim() : '';
      const subject = typeof (req.body as any)?.subject === 'string' ? (req.body as any).subject.trim() : '';

      if (!provider || !subject) {
        return res.status(400).json({ ok: false, error: 'missing_params' });
      }

      const existing = await prisma.account_links.findUnique({
        where: {
          oauth_provider_oauth_subject: {
            oauth_provider: provider,
            oauth_subject: subject,
          },
        },
      });

      if (existing && existing.supabase_user_id !== supabaseUserId) {
        return res.status(409).json({ ok: false, error: 'identity_claimed_by_another_user' });
      }

      if (existing && existing.supabase_user_id === supabaseUserId) {
        return res.json({ ok: true, already_linked: true });
      }

      await prisma.account_links.create({
        data: {
          oauth_provider: provider,
          oauth_subject: subject,
          supabase_user_id: supabaseUserId,
          link_initiated_by: 'web',
        },
      });

      return res.status(201).json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.post('/api/identity/unlink', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const provider = typeof (req.body as any)?.provider === 'string' ? (req.body as any).provider.trim() : '';
      const subject = typeof (req.body as any)?.subject === 'string' ? (req.body as any).subject.trim() : '';

      if (!provider || !subject) {
        return res.status(400).json({ ok: false, error: 'missing_params' });
      }

      await prisma.account_links.deleteMany({
        where: {
          supabase_user_id: supabaseUserId,
          oauth_provider: provider,
          oauth_subject: subject,
        },
      });

      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });

  app.get('/api/identity/status', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const links = await prisma.account_links.findMany({
        where: { supabase_user_id: supabaseUserId },
        orderBy: { linked_at: 'desc' },
      });

      return res.json({
        ok: true,
        links: links.map((link) => ({
          provider: link.oauth_provider,
          subject: link.oauth_subject,
          linked_at: link.linked_at.toISOString(),
        })),
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: error?.message || 'internal_error' });
    }
  });
}
