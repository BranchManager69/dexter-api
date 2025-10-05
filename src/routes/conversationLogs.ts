import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import { logger, style } from '../logger.js';

function coerceIsoDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function sanitizeJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return null;
  }
}

function coerceDurationMs(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.max(0, Math.round(value));
    return BigInt(rounded);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return BigInt(Math.max(0, Math.round(parsed)));
    }
  }
  return null;
}

export function registerConversationLogRoutes(app: Express) {
  const log = logger.child('realtime.logs');

  app.post('/api/realtime/logs', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }

      const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
      if (!sessionId) {
        return res.status(400).json({ ok: false, error: 'session_id_required' });
      }

      const startedAt = coerceIsoDate(req.body?.startedAt) ?? new Date();
      const endedAt = coerceIsoDate(req.body?.endedAt);
      const durationMs = coerceDurationMs(req.body?.durationMs);
      const transcript = sanitizeJson(req.body?.transcript);
      const toolCalls = sanitizeJson(req.body?.toolCalls);
      const metadata = sanitizeJson(req.body?.metadata) ?? {};

      const status = typeof req.body?.status === 'string' ? req.body.status.trim() : 'pending_summary';

      const existing = await prisma.conversation_logs.findFirst({
        where: {
          session_id: sessionId,
          supabase_user_id: supabaseUserId,
        },
      });

      const payload = {
        supabase_user_id: supabaseUserId,
        session_id: sessionId,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: durationMs ?? undefined,
        transcript,
        tool_calls: toolCalls,
        metadata,
        status,
        error_message: typeof req.body?.error === 'string' ? req.body.error : null,
      } as const;

      const record = existing
        ? await prisma.conversation_logs.update({
            where: { id: existing.id },
            data: payload,
          })
        : await prisma.conversation_logs.create({
            data: payload,
          });

      log.info(
        `${style.status('log', 'success')} ${style.kv('session', sessionId)} ${style.kv('user', supabaseUserId)}`,
        {
          sessionId,
          supabaseUserId,
          conversationLogId: record.id,
          status: record.status,
        }
      );

      return res.json({ ok: true, id: record.id, status: record.status });
    } catch (error: any) {
      log.error(
        `${style.status('log', 'error')} ${style.kv('error', error?.message || error)}`,
        error
      );
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
