import type { Express, Request, Response } from 'express';
import prisma from '../../../../config/prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateLinkingCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    const index = Math.floor(Math.random() * CODE_CHARS.length);
    code += CODE_CHARS[index];
  }
  return code;
}

function normalizeCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const normalized = code.trim().toUpperCase();
  return normalized.length >= 6 ? normalized : null;
}

export function registerLinkingRoutes(app: Express) {
  app.post('/api/link/verify', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const normalizedCode = normalizeCode((req.body as any)?.code);
      if (!normalizedCode) {
        return res.status(400).json({ ok: false, error: 'invalid_code' });
      }

      const linkingCode = await prisma.linking_codes.findUnique({
        where: { code: normalizedCode },
      });

      if (!linkingCode) {
        return res.status(404).json({ ok: false, error: 'code_not_found' });
      }

      if (linkingCode.expires_at < new Date()) {
        return res.status(410).json({ ok: false, error: 'code_expired' });
      }

      const attempts = linkingCode.attempts ?? 0;
      if (attempts >= 3) {
        return res.status(429).json({ ok: false, error: 'too_many_attempts' });
      }

      await prisma.linking_codes.update({
        where: { code: normalizedCode },
        data: { attempts: attempts + 1 },
      });

      if (linkingCode.used) {
        return res.status(410).json({ ok: false, error: 'code_already_used' });
      }

      if (linkingCode.oauth_provider && linkingCode.oauth_subject) {
        const existing = await prisma.account_links.findUnique({
          where: {
            oauth_provider_oauth_subject: {
              oauth_provider: linkingCode.oauth_provider,
              oauth_subject: linkingCode.oauth_subject,
            },
          },
        });

        if (existing) {
          return res.status(409).json({ ok: false, error: 'already_linked' });
        }

        await prisma.account_links.create({
          data: {
            oauth_provider: linkingCode.oauth_provider,
            oauth_subject: linkingCode.oauth_subject,
            supabase_user_id: supabaseUserId,
            link_initiated_by: 'mcp',
          },
        });

        await prisma.linking_codes.update({
          where: { code: normalizedCode },
          data: { used: true },
        });

        return res.json({
          ok: true,
          message: 'Successfully linked MCP account',
          provider: linkingCode.oauth_provider,
        });
      }

      if (linkingCode.supabase_user_id) {
        return res.status(501).json({ ok: false, error: 'reverse_flow_not_implemented' });
      }

      return res.status(400).json({ ok: false, error: 'invalid_code_type' });
    } catch (error: any) {
      console.error('Link verify error:', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.get('/api/link/status', async (req: Request, res: Response) => {
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
        is_linked: links.length > 0,
        links: links.map((link) => ({
          provider: link.oauth_provider,
          linked_at: link.linked_at.toISOString(),
          initiated_by: link.link_initiated_by,
          subject: link.oauth_subject,
        })),
      });
    } catch (error: any) {
      console.error('Link status error:', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.post('/api/link/generate', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const existingLinks = await prisma.account_links.count({
        where: { supabase_user_id: supabaseUserId },
      });

      await prisma.linking_codes.deleteMany({
        where: {
          supabase_user_id: supabaseUserId,
          expires_at: { lt: new Date() },
        },
      });

      const recentCode = await prisma.linking_codes.findFirst({
        where: {
          supabase_user_id: supabaseUserId,
          expires_at: { gt: new Date() },
          used: false,
        },
        orderBy: { created_at: 'desc' },
      });

      if (recentCode && recentCode.created_at > new Date(Date.now() - 60_000)) {
        return res.json({
          ok: true,
          code: recentCode.code,
          expires_at: recentCode.expires_at.toISOString(),
          instructions: `Enter this code in your MCP tool: ${recentCode.code}`,
        });
      }

      const code = generateLinkingCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.linking_codes.create({
        data: {
          code,
          supabase_user_id: supabaseUserId,
          expires_at: expiresAt,
          used: false,
          attempts: 0,
        },
      });

      return res.json({
        ok: true,
        code,
        expires_at: expiresAt.toISOString(),
        instructions: `Enter this code in your MCP tool: ${code}`,
        has_existing_links: existingLinks > 0,
      });
    } catch (error: any) {
      console.error('Generate code error:', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.post('/api/link/remove', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const provider = typeof (req.body as any)?.provider === 'string' ? (req.body as any).provider.trim() : '';
      const subject = typeof (req.body as any)?.subject === 'string' ? (req.body as any).subject.trim() : '';

      if (!provider) {
        await prisma.account_links.deleteMany({
          where: { supabase_user_id: supabaseUserId },
        });

        return res.json({ ok: true, message: 'All linked accounts removed' });
      }

      if (subject) {
        await prisma.account_links.deleteMany({
          where: {
            supabase_user_id: supabaseUserId,
            oauth_provider: provider,
            oauth_subject: subject,
          },
        });
      } else {
        await prisma.account_links.deleteMany({
          where: {
            supabase_user_id: supabaseUserId,
            oauth_provider: provider,
          },
        });
      }

      return res.json({ ok: true, message: `Unlinked ${provider} account` });
    } catch (error: any) {
      console.error('Unlink error:', error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
