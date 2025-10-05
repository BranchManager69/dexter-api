import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { logger } from './logger.js';

const log = logger.child('prompt-service');

export async function fetchPromptSegment(slug: string): Promise<string> {
  const trimmed = String(slug ?? '').trim();
  if (!trimmed) {
    throw new Error('prompt_slug_missing');
  }

  try {
    const rows = await prisma.$queryRaw<{ segment: string | null }[]>(Prisma.sql`
      SELECT segment
      FROM public.prompt_modules
      WHERE slug = ${trimmed}
      LIMIT 1
    `);

    if (rows.length && typeof rows[0].segment === 'string' && rows[0].segment.trim().length) {
      return rows[0].segment;
    }

    log.error({ slug: trimmed }, 'prompt-module-missing');
    throw new Error(`prompt_module_missing:${trimmed}`);
  } catch (error: any) {
    log.error({ slug: trimmed, error: error?.message || error }, 'prompt-module-fetch-failed');
    if (error instanceof Error) throw error;
    throw new Error(`prompt_module_fetch_failed:${trimmed}`);
  }
}

