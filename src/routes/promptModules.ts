import express from 'express';
import type { Express, Request, Response } from 'express';
import prisma from '../prisma.js';
import { logger } from '../logger.js';
import { getSupabaseUserFromAccessToken } from '../utils/supabaseAdmin.js';

const log = logger.child('routes.prompt-modules');

type SupabaseUser = Awaited<ReturnType<typeof getSupabaseUserFromAccessToken>>;

type AuthContext = {
  userId: string;
  email: string | null;
  roles: string[];
};

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

function ensureSuperAdmin(user: SupabaseUser): { ok: boolean; context?: AuthContext } {
  const roles = extractRoles(user.app_metadata?.roles);
  const roleAllows = roles.includes('superadmin');
  const metaAllows = normalizeBoolean(user.user_metadata?.isSuperAdmin);
  if (!roleAllows && !metaAllows) {
    return { ok: false };
  }
  return {
    ok: true,
    context: {
      userId: String(user.id),
      email: (typeof user.email === 'string' && user.email.trim()) ? String(user.email) : null,
      roles,
    },
  };
}

function extractBearerToken(req: Request): string | null {
  const rawAuth = req.headers['authorization'] || req.headers['Authorization'];
  if (!rawAuth) return null;
  const header = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (typeof header !== 'string') return null;
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function requireSuperAdmin(req: Request, res: Response): Promise<AuthContext | null> {
  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    res.status(401).json({ ok: false, error: 'authentication_required' });
    return null;
  }

  let user: SupabaseUser;
  try {
    user = await getSupabaseUserFromAccessToken(bearerToken);
  } catch (error: any) {
    log.warn({ event: 'supabase_user_lookup_failed', error: error?.message || error }, 'prompt-superadmin-auth-failed');
    res.status(403).json({ ok: false, error: 'superadmin_required' });
    return null;
  }

  const { ok, context } = ensureSuperAdmin(user);
  if (!ok || !context) {
    res.status(403).json({ ok: false, error: 'superadmin_required' });
    return null;
  }

  return context;
}

function serializePromptRow(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? null,
    segment: row.segment,
    version: Number(row.version ?? 0),
    checksum: row.checksum ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
    updatedBy: row.updated_by
      ? {
          id: row.updated_by,
          email: row.updated_by_email ?? null,
        }
      : null,
  };
}

function serializeRevisionRow(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? null,
    segment: row.segment,
    version: Number(row.version ?? 0),
    checksum: row.checksum ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    updatedBy: row.updated_by
      ? {
          id: row.updated_by,
          email: row.updated_by_email ?? null,
        }
      : null,
  };
}

export function registerPromptModuleRoutes(app: Express) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const auth = await requireSuperAdmin(req, res);
    if (!auth) return;

    try {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT pm.id,
               pm.slug,
               pm.title,
               pm.segment,
               pm.version,
               pm.checksum,
               pm.created_at,
               pm.updated_at,
               pm.updated_by,
               u.email AS updated_by_email
        FROM public.prompt_modules pm
        LEFT JOIN auth.users u ON u.id = pm.updated_by
        ORDER BY pm.slug ASC
      `;

      const prompts = rows.map(serializePromptRow);
      res.json({ ok: true, prompts });
    } catch (error: any) {
      log.error({ error: error?.message || error }, 'prompt-module-list-failed');
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  router.get('/:slug', async (req, res) => {
    const slug = String(req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'missing_slug' });
    }

    try {
      const result = await prisma.$queryRaw<{ id: string; slug: string; title: string | null; segment: string; version: number; checksum: string | null; created_at: Date; updated_at: Date; updated_by: string | null; updated_by_email: string | null }[]>`
        SELECT pm.id,
               pm.slug,
               pm.title,
               pm.segment,
               pm.version,
               pm.checksum,
               pm.created_at,
               pm.updated_at,
               pm.updated_by,
               u.email AS updated_by_email
        FROM public.prompt_modules pm
        LEFT JOIN auth.users u ON u.id = pm.updated_by
        WHERE pm.slug = ${slug}
        LIMIT 1
      `;

      if (!result.length) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const row = result[0];
      return res.json({
        ok: true,
        prompt: serializePromptRow(row),
      });
    } catch (error) {
      log.error({ error, slug }, 'prompt-module-lookup-failed');
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  router.get('/:slug/history', async (req, res) => {
    const auth = await requireSuperAdmin(req, res);
    if (!auth) return;

    const slug = String(req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'missing_slug' });
    }

    try {
      const rows = await prisma.$queryRaw<{ id: string; slug: string; title: string | null; segment: string; version: number; checksum: string | null; created_at: Date; notes: string | null; updated_by: string | null; updated_by_email: string | null }[]>`
        SELECT rev.id,
               rev.slug,
               rev.title,
               rev.segment,
               rev.version,
               rev.checksum,
               rev.notes,
               rev.created_at,
               rev.updated_by,
               u.email AS updated_by_email
        FROM prompt_module_revisions rev
        LEFT JOIN auth.users u ON u.id = rev.updated_by
        WHERE rev.slug = ${slug}
        ORDER BY rev.created_at DESC
        LIMIT 50
      `;

      const history = rows.map(serializeRevisionRow);
      res.json({ ok: true, history });
    } catch (error: any) {
      log.error({ error: error?.message || error, slug }, 'prompt-module-history-failed');
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  router.post('/', async (req, res) => {
    const auth = await requireSuperAdmin(req, res);
    if (!auth) return;

    const rawSlug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    const slug = rawSlug.trim();
    const titleRaw = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const title = titleRaw ? titleRaw : null;
    const segment = typeof req.body?.segment === 'string' ? req.body.segment : '';
    const notesRaw = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const notes = notesRaw ? notesRaw : null;

    if (!slug) {
      return res.status(400).json({ ok: false, error: 'slug_required' });
    }

    if (!/^[a-z0-9._-]+$/i.test(slug)) {
      return res.status(400).json({ ok: false, error: 'invalid_slug' });
    }

    if (!segment.trim()) {
      return res.status(400).json({ ok: false, error: 'segment_required' });
    }

    try {
      const prompt = await prisma.$transaction(async (tx) => {
        const existing = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM public.prompt_modules
          WHERE slug = ${slug}
          LIMIT 1
          FOR UPDATE
        `;

        if (existing.length) {
          throw Object.assign(new Error('conflict'), { code: 'conflict' });
        }

        const inserted = await tx.$queryRaw<{ id: string; slug: string; title: string | null; segment: string; version: number; checksum: string | null; created_at: Date; updated_at: Date; updated_by: string | null; updated_by_email: string | null }[]>`
          INSERT INTO public.prompt_modules (slug, title, segment, checksum, version, updated_by)
          VALUES (
            ${slug},
            ${title},
            ${segment},
            encode(digest(${segment}, 'sha256'), 'hex'),
            1,
            ${auth.userId}::uuid
          )
          RETURNING id, slug, title, segment, version, checksum, created_at, updated_at, updated_by,
                    (SELECT email FROM auth.users WHERE id = updated_by) AS updated_by_email
        `;

        if (!inserted.length) {
          throw new Error('insert_failed');
        }

        if (notes) {
          await tx.$executeRaw`
            INSERT INTO prompt_module_revisions (prompt_module_id, slug, title, segment, checksum, version, notes, updated_by)
            VALUES (${inserted[0].id}::uuid, ${slug}, ${title}, ${segment}, encode(digest(${segment}, 'sha256'), 'hex'), 1, ${notes}, ${auth.userId}::uuid)
          `;
        }

        return inserted[0];
      });

      res.status(201).json({ ok: true, prompt: serializePromptRow(prompt) });
    } catch (error: any) {
      if (error?.code === 'conflict') {
        return res.status(409).json({ ok: false, error: 'slug_exists' });
      }
      log.error({ error: error?.message || error, slug }, 'prompt-module-create-failed');
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  router.put('/:slug', async (req, res) => {
    const auth = await requireSuperAdmin(req, res);
    if (!auth) return;

    const slug = String(req.params.slug || '').trim();
    if (!slug) {
      return res.status(400).json({ ok: false, error: 'missing_slug' });
    }

    const titleRaw = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const title = titleRaw ? titleRaw : null;
    const segment = typeof req.body?.segment === 'string' ? req.body.segment : '';
    const baseVersion = req.body?.version;
    const notesRaw = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const notes = notesRaw ? notesRaw : null;

    if (!segment.trim()) {
      return res.status(400).json({ ok: false, error: 'segment_required' });
    }

    const expectedVersion = typeof baseVersion === 'number'
      ? baseVersion
      : typeof baseVersion === 'string' && baseVersion.trim()
        ? Number(baseVersion)
        : null;

    if (expectedVersion !== null && (!Number.isFinite(expectedVersion) || expectedVersion < 0)) {
      return res.status(400).json({ ok: false, error: 'invalid_version' });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const currentRows = await tx.$queryRaw<{ id: string; slug: string; title: string | null; segment: string; version: number; checksum: string | null }[]>`
          SELECT id, slug, title, segment, version, checksum
          FROM public.prompt_modules
          WHERE slug = ${slug}
          LIMIT 1
          FOR UPDATE
        `;

        if (!currentRows.length) {
          throw Object.assign(new Error('not_found'), { code: 'not_found' });
        }

        const current = currentRows[0];

        if (expectedVersion !== null && Number(current.version) !== Number(expectedVersion)) {
          throw Object.assign(new Error('version_conflict'), { code: 'version_conflict', currentVersion: Number(current.version) });
        }

        const normalizedTitle = title ?? current.title ?? null;
        const contentChanged = (normalizedTitle ?? null) !== (current.title ?? null) || segment !== current.segment;

        if (!contentChanged) {
          return { unchanged: true, prompt: current } as const;
        }

        await tx.$executeRaw`
          INSERT INTO prompt_module_revisions (prompt_module_id, slug, title, segment, checksum, version, notes, updated_by)
          VALUES (
            ${current.id}::uuid,
            ${current.slug},
            ${current.title},
            ${current.segment},
            ${current.checksum},
            ${current.version},
            ${notes},
            ${auth.userId}::uuid
          )
        `;

        const nextVersion = Number(current.version) + 1;

        const updatedRows = await tx.$queryRaw<{ id: string; slug: string; title: string | null; segment: string; version: number; checksum: string | null; created_at: Date; updated_at: Date; updated_by: string | null; updated_by_email: string | null }[]>`
          UPDATE public.prompt_modules
          SET title = ${normalizedTitle},
              segment = ${segment},
              checksum = encode(digest(${segment}, 'sha256'), 'hex'),
              version = ${nextVersion},
              updated_at = timezone('utc'::text, now()),
              updated_by = ${auth.userId}::uuid
          WHERE id = ${current.id}::uuid
          RETURNING id, slug, title, segment, version, checksum, created_at, updated_at, updated_by,
                    (SELECT email FROM auth.users WHERE id = updated_by) AS updated_by_email
        `;

        if (!updatedRows.length) {
          throw new Error('update_failed');
        }

        return { unchanged: false, prompt: updatedRows[0] } as const;
      });

      if (updated.unchanged) {
        const lookup = await prisma.$queryRaw<{ id: string; slug: string; title: string | null; segment: string; version: number; checksum: string | null; created_at: Date; updated_at: Date; updated_by: string | null; updated_by_email: string | null }[]>`
          SELECT pm.id,
                 pm.slug,
                 pm.title,
                 pm.segment,
                 pm.version,
                 pm.checksum,
                 pm.created_at,
                 pm.updated_at,
                 pm.updated_by,
                 u.email AS updated_by_email
          FROM public.prompt_modules pm
          LEFT JOIN auth.users u ON u.id = pm.updated_by
          WHERE pm.slug = ${slug}
          LIMIT 1
        `;

        return res.json({ ok: true, unchanged: true, prompt: lookup.length ? serializePromptRow(lookup[0]) : null });
      }

      res.json({ ok: true, prompt: serializePromptRow(updated.prompt) });
    } catch (error: any) {
      if (error?.code === 'not_found') {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      if (error?.code === 'version_conflict') {
        return res.status(409).json({ ok: false, error: 'version_conflict', currentVersion: error.currentVersion });
      }
      log.error({ error: error?.message || error, slug }, 'prompt-module-update-failed');
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.use('/prompt-modules', router);
}

export default registerPromptModuleRoutes;
