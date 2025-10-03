import express from 'express';
import type { Express } from 'express';
import prisma from '../prisma.js';
import { logger } from '../logger.js';

const log = logger.child('routes.prompt-modules');

export function registerPromptModuleRoutes(app: Express) {
  const router = express.Router();

  router.get('/:slug', async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'missing_slug' });
    }

    try {
      const result = await prisma.$queryRaw<{ slug: string; title: string | null; segment: string; version: number; updated_at: Date }[]>`
        SELECT slug, title, segment, version, updated_at
        FROM prompt_modules
        WHERE slug = ${slug}
        LIMIT 1
      `;

      if (!result.length) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const row = result[0];
      return res.json({
        ok: true,
        prompt: {
          slug: row.slug,
          title: row.title,
          segment: row.segment,
          version: row.version,
          updatedAt: row.updated_at?.toISOString?.() ?? null,
        },
      });
    } catch (error) {
      log.error({ error, slug }, 'prompt-module-lookup-failed');
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.use('/prompt-modules', router);
}

export default registerPromptModuleRoutes;
