import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import { MEMORY_LIMITS } from '../config/memory.js';
import { logger, style } from '../logger.js';

function normalizeStringList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }
  if (value && typeof value === 'object' && Array.isArray((value as any).items)) {
    return (value as any).items
      .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item: string) => item.length > 0);
  }
  return [];
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

export function registerRealtimeMemoryRoutes(app: Express) {
  const log = logger.child('realtime.memories');
  const fetchLimit = MEMORY_LIMITS.adminPanel.recentCount ?? 50;

  app.get('/api/realtime/memories', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const [memoryRows, totalMemories, skippedRows, totalSkipped, profile] = await Promise.all([
        prisma.user_memories.findMany({
          where: { supabase_user_id: supabaseUserId },
          orderBy: { created_at: 'desc' },
          take: fetchLimit,
        }),
        prisma.user_memories.count({ where: { supabase_user_id: supabaseUserId } }),
        prisma.conversation_logs.findMany({
          where: { supabase_user_id: supabaseUserId, status: 'skipped' },
          orderBy: { started_at: 'desc' },
          take: fetchLimit,
        }),
        prisma.conversation_logs.count({ where: { supabase_user_id: supabaseUserId, status: 'skipped' } }),
        prisma.user_profiles.findUnique({
          where: { supabase_user_id: supabaseUserId },
          select: { dossier: true },
        }),
      ]);

      const memories = memoryRows.map((entry) => {
        const metadata = entry?.metadata && typeof entry.metadata === 'object'
          ? entry.metadata as Record<string, any>
          : {};

        return {
          id: entry.id,
          summary: typeof entry.summary === 'string' ? entry.summary : '',
          facts: normalizeStringList(entry.facts),
          followUps: normalizeStringList(entry.follow_ups),
          createdAt: entry.created_at ?? null,
          sessionId: toNullableString(metadata?.session_id),
          startedAt: toNullableString(metadata?.started_at),
          endedAt: toNullableString(metadata?.ended_at),
          status: 'summarized' as const,
        };
      });

      const skipped = skippedRows.map((entry) => ({
        id: entry.id,
        summary: 'Session skipped (no retained content)',
        facts: [] as string[],
        followUps: [] as string[],
        createdAt: entry.created_at ?? entry.started_at ?? null,
        sessionId: toNullableString(entry.session_id),
        startedAt: entry.started_at ?? null,
        endedAt: entry.ended_at ?? null,
        status: 'skipped' as const,
      }));

      let nextConversationPrompt = '';
      const dossier = profile?.dossier && typeof profile.dossier === 'object' ? profile.dossier as Record<string, any> : null;
      if (dossier) {
        const raw = typeof dossier.nextConversationPrompt === 'string'
          ? dossier.nextConversationPrompt
          : typeof dossier.next_conversation_prompt === 'string'
            ? dossier.next_conversation_prompt
            : '';
        if (typeof raw === 'string' && raw.trim().length) {
          nextConversationPrompt = raw.trim();
        }
      }

      return res.json({
        memories,
        skipped,
        total: totalMemories,
        totalSkipped,
        limit: fetchLimit,
        nextConversationPrompt,
      });
    } catch (error: any) {
      log.error(
        `${style.status('memories', 'error')} ${style.kv('error', error?.message || error)}`,
        error,
      );
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
