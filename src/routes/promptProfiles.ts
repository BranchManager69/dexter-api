import type { Express, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../prisma.js';
import { logger, style } from '../logger.js';
import { getSupabaseUserIdFromRequest } from '../utils/supabase.js';
import {
  getDefaultConciergeProfileDefinition,
  resolveConciergeProfile,
  resolveProfileRecord,
  buildDefinitionFromRecord,
  fetchDefaultProfileRecordForUser,
  DEFAULT_AGENT_NAME,
  missingPromptFallback,
} from '../promptProfiles.js';
import type { ConciergePromptProfileDefinition } from '../promptProfiles.js';

const log = logger.child('routes.prompt-profiles');

const SLUG_PATTERN = /^[a-zA-Z0-9._-]{3,128}$/;

type ToolSlugMap = Record<string, string>;

type SerializedProfile = {
  id: string;
  name: string;
  description: string | null;
  instructionSlug: string;
  handoffSlug: string;
  guestSlug: string;
  toolSlugs: ToolSlugMap;
  voiceKey: string | null;
  metadata: Record<string, any>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

function normalizeToolSlugs(input: unknown, base: ToolSlugMap): ToolSlugMap {
  const normalized: ToolSlugMap = { ...base };
  if (!input || typeof input !== 'object') {
    return normalized;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim().length) {
      normalized[key] = value.trim();
    }
  }
  return normalized;
}

function serializeProfile(record: any): SerializedProfile {
  const metadata = (record.metadata && typeof record.metadata === 'object') ? record.metadata as Record<string, any> : {};
  const toolSlugs = (record.tool_slugs && typeof record.tool_slugs === 'object') ? record.tool_slugs as ToolSlugMap : {};
  return {
    id: record.id,
    name: record.name,
    description: record.description ?? null,
    instructionSlug: record.instruction_slug,
    handoffSlug: record.handoff_slug,
    guestSlug: record.guest_slug,
    toolSlugs,
    voiceKey: record.voice_key ?? null,
    metadata,
    isDefault: Boolean(record.is_default),
    createdAt: record.created_at instanceof Date ? record.created_at.toISOString() : String(record.created_at),
    updatedAt: record.updated_at instanceof Date ? record.updated_at.toISOString() : String(record.updated_at),
  };
}

function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug.trim());
}

async function ensurePromptModulesExist(slugs: string[]) {
  const unique = Array.from(new Set(slugs.filter((slug) => typeof slug === 'string' && slug.length)));
  if (!unique.length) {
    return [];
  }
  const rows = await prisma.$queryRaw<{ slug: string }[]>(Prisma.sql`
    SELECT slug
    FROM public.prompt_modules
    WHERE slug IN (${Prisma.join(unique)})
  `);
  const present = new Set(rows.map((row) => row.slug));
  return unique.filter((slug) => !present.has(slug));
}

function extractMetadata(input: unknown): Record<string, any> {
  if (!input || typeof input !== 'object') {
    return {};
  }
  return input as Record<string, any>;
}

type UpsertPayload = {
  name: string;
  description?: string | null;
  instructionSlug: string;
  handoffSlug: string;
  guestSlug: string;
  toolSlugs: ToolSlugMap;
  voiceKey?: string | null;
  metadata?: Record<string, any>;
  isDefault?: boolean;
};

function parseBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true' || lowered === '1') return true;
    if (lowered === 'false' || lowered === '0') return false;
  }
  return undefined;
}

function sanitizeUpsertPayload(body: any, fallbackTools: ToolSlugMap): UpsertPayload | null {
  if (!body || typeof body !== 'object') return null;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const instructionSlug = typeof body.instructionSlug === 'string' ? body.instructionSlug.trim() : '';
  const handoffSlug = typeof body.handoffSlug === 'string' ? body.handoffSlug.trim() : '';
  const guestSlug = typeof body.guestSlug === 'string' ? body.guestSlug.trim() : '';
  if (!name || !instructionSlug || !handoffSlug || !guestSlug) {
    return null;
  }
  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const voiceKey = typeof body.voiceKey === 'string' && body.voiceKey.trim().length ? body.voiceKey.trim() : null;
  const metadata = extractMetadata(body.metadata);
  const isDefault = parseBooleanFlag(body.isDefault);
  const toolSlugs = normalizeToolSlugs(body.toolSlugs, fallbackTools);
  return {
    name,
    description,
    instructionSlug,
    handoffSlug,
    guestSlug,
    toolSlugs,
    voiceKey,
    metadata,
    isDefault,
  };
}

async function upsertDefaultFlag(tx: Prisma.TransactionClient, supabaseUserId: string, targetProfileId: string | null) {
  if (!supabaseUserId) return;
  await tx.user_prompt_profiles.updateMany({
    where: {
      supabase_user_id: supabaseUserId,
      id: targetProfileId ? { not: targetProfileId } : undefined,
    },
    data: { is_default: false },
  });
  if (targetProfileId) {
    await tx.user_prompt_profiles.update({
      where: { id: targetProfileId },
      data: { is_default: true },
    });
  }
}

export function registerPromptProfileRoutes(app: Express) {
  const baseDefinition = getDefaultConciergeProfileDefinition();
  const defaultToolSlugs: ToolSlugMap = Object.fromEntries(
    Object.entries(baseDefinition.toolDescriptions).map(([key, ref]) => [key, ref.slug]),
  );

  app.get('/prompt-profiles', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }
      const includeResolved = String(req.query.includeResolved || '').toLowerCase() === 'true';
      const records = await prisma.user_prompt_profiles.findMany({
        where: { supabase_user_id: supabaseUserId },
        orderBy: [{ created_at: 'asc' }],
      });
      const profiles = records.map(serializeProfile);
      let resolvedProfiles: Record<string, any> | undefined;
      if (includeResolved) {
        const resolvedPairs = await Promise.all(
          records.map(async (record) => {
            const resolved = await resolveProfileRecord(record);
            return [record.id, resolved] as const;
          }),
        );
        resolvedProfiles = Object.fromEntries(resolvedPairs);
      }
      return res.json({ ok: true, profiles, resolvedProfiles });
    } catch (error: any) {
      log.error(`${style.status('list', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.post('/prompt-profiles/preview', async (req: Request, res: Response) => {
    try {
      const payload = sanitizeUpsertPayload(req.body, defaultToolSlugs);
      if (!payload) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }

      const slugsToCheck = [
        payload.instructionSlug,
        payload.handoffSlug,
        payload.guestSlug,
        ...Object.values(payload.toolSlugs),
      ];

      for (const slug of slugsToCheck) {
        if (!isValidSlug(slug)) {
          return res.status(400).json({ ok: false, error: 'invalid_slug', slug });
        }
      }

      const missing = await ensurePromptModulesExist(slugsToCheck);
      if (missing.length) {
        log.warn({ missing }, 'prompt-profile-preview-modules-missing');
      }

      const definition: ConciergePromptProfileDefinition = {
        id: 'preview',
        agentName:
          (payload.metadata?.agentName && typeof payload.metadata.agentName === 'string'
            ? payload.metadata.agentName.trim()
            : '') ||
          payload.name ||
          baseDefinition.agentName ||
          DEFAULT_AGENT_NAME,
        voiceKey: payload.voiceKey ?? baseDefinition.voiceKey ?? null,
        instructionSegments: [
          {
            slug: payload.instructionSlug,
            fallback: missingPromptFallback(payload.instructionSlug),
          },
        ],
        handoffDescription: {
          slug: payload.handoffSlug,
          fallback: missingPromptFallback(payload.handoffSlug),
        },
        guestInstructions: {
          slug: payload.guestSlug,
          fallback: missingPromptFallback(payload.guestSlug),
        },
        toolDescriptions: Object.fromEntries(
          Object.entries({ ...defaultToolSlugs, ...payload.toolSlugs }).map(([key, slug]) => [
            key,
            {
              slug,
              fallback: missingPromptFallback(slug),
            },
          ]),
        ),
      };

      const resolvedProfile = await resolveConciergeProfile({ profile: definition, skipCache: true });
      return res.json({ ok: true, resolvedProfile });
    } catch (error: any) {
      log.error(`${style.status('preview', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.get('/prompt-profiles/active', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        const resolved = await resolveConciergeProfile({ skipCache: true });
        return res.json({ ok: true, source: 'default', resolvedProfile: resolved });
      }
      const record = await fetchDefaultProfileRecordForUser(supabaseUserId);
      if (!record) {
        const resolved = await resolveConciergeProfile({ skipCache: true });
        return res.json({ ok: true, source: 'default', resolvedProfile: resolved });
      }
      const profile = serializeProfile(record);
      const resolvedProfile = await resolveProfileRecord(record);
      return res.json({ ok: true, source: 'user', profile, resolvedProfile });
    } catch (error: any) {
      log.error(`${style.status('active', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.post('/prompt-profiles', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }
      const payload = sanitizeUpsertPayload(req.body, defaultToolSlugs);
      if (!payload) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }
      const slugsToCheck = [
        payload.instructionSlug,
        payload.handoffSlug,
        payload.guestSlug,
        ...Object.values(payload.toolSlugs),
      ];
      for (const slug of slugsToCheck) {
        if (!isValidSlug(slug)) {
          return res.status(400).json({ ok: false, error: 'invalid_slug', slug });
        }
      }
      const missing = await ensurePromptModulesExist(slugsToCheck);
      if (missing.length) {
        return res.status(400).json({ ok: false, error: 'prompt_modules_missing', slugs: missing });
      }

      const created = await prisma.$transaction(async (tx) => {
        if (payload.isDefault) {
          await upsertDefaultFlag(tx, supabaseUserId, null);
        }
        return tx.user_prompt_profiles.create({
          data: {
            supabase_user_id: supabaseUserId,
            name: payload.name,
            description: payload.description,
            instruction_slug: payload.instructionSlug,
            handoff_slug: payload.handoffSlug,
            guest_slug: payload.guestSlug,
            tool_slugs: payload.toolSlugs,
            voice_key: payload.voiceKey,
            metadata: payload.metadata ?? {},
            is_default: payload.isDefault ?? false,
          },
        });
      });

      const profile = serializeProfile(created);
      const resolvedProfile = await resolveProfileRecord(created);
      const definition = buildDefinitionFromRecord(created);
      return res.status(201).json({ ok: true, profile, resolvedProfile, definition });
    } catch (error: any) {
      log.error(`${style.status('create', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.get('/prompt-profiles/:id', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }
      const profileId = String(req.params.id || '').trim();
      if (!profileId) {
        return res.status(400).json({ ok: false, error: 'missing_id' });
      }
      const record = await prisma.user_prompt_profiles.findFirst({
        where: { id: profileId, supabase_user_id: supabaseUserId },
      });
      if (!record) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      const profile = serializeProfile(record);
      const resolvedProfile = await resolveProfileRecord(record);
      const definition = buildDefinitionFromRecord(record);
      return res.json({ ok: true, profile, resolvedProfile, definition });
    } catch (error: any) {
      log.error(`${style.status('fetch', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.put('/prompt-profiles/:id', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }
      const profileId = String(req.params.id || '').trim();
      if (!profileId) {
        return res.status(400).json({ ok: false, error: 'missing_id' });
      }

      const existing = await prisma.user_prompt_profiles.findFirst({
        where: { id: profileId, supabase_user_id: supabaseUserId },
      });
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const payload = sanitizeUpsertPayload(req.body, {
        ...defaultToolSlugs,
        ...(existing.tool_slugs as ToolSlugMap ?? {}),
      });
      if (!payload) {
        return res.status(400).json({ ok: false, error: 'invalid_payload' });
      }

      const slugsToCheck = [
        payload.instructionSlug,
        payload.handoffSlug,
        payload.guestSlug,
        ...Object.values(payload.toolSlugs),
      ];
      for (const slug of slugsToCheck) {
        if (!isValidSlug(slug)) {
          return res.status(400).json({ ok: false, error: 'invalid_slug', slug });
        }
      }
      const missing = await ensurePromptModulesExist(slugsToCheck);
      if (missing.length) {
        return res.status(400).json({ ok: false, error: 'prompt_modules_missing', slugs: missing });
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (payload.isDefault) {
          await upsertDefaultFlag(tx, supabaseUserId, profileId);
        }
        return tx.user_prompt_profiles.update({
          where: { id: profileId },
          data: {
            name: payload.name,
            description: payload.description,
            instruction_slug: payload.instructionSlug,
            handoff_slug: payload.handoffSlug,
            guest_slug: payload.guestSlug,
            tool_slugs: payload.toolSlugs,
            voice_key: payload.voiceKey,
            metadata: payload.metadata ?? {},
            is_default: payload.isDefault ?? existing.is_default,
          },
        });
      });

      const profile = serializeProfile(updated);
      const resolvedProfile = await resolveProfileRecord(updated);
      const definition = buildDefinitionFromRecord(updated);
      return res.json({ ok: true, profile, resolvedProfile, definition });
    } catch (error: any) {
      log.error(`${style.status('update', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.post('/prompt-profiles/:id/activate', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }
      const profileId = String(req.params.id || '').trim();
      if (!profileId) {
        return res.status(400).json({ ok: false, error: 'missing_id' });
      }
      const exists = await prisma.user_prompt_profiles.findFirst({
        where: { id: profileId, supabase_user_id: supabaseUserId },
      });
      if (!exists) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      await prisma.$transaction(async (tx) => {
        await upsertDefaultFlag(tx, supabaseUserId, profileId);
      });
      return res.json({ ok: true });
    } catch (error: any) {
      log.error(`${style.status('activate', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  app.delete('/prompt-profiles/:id', async (req: Request, res: Response) => {
    try {
      const supabaseUserId = await getSupabaseUserIdFromRequest(req);
      if (!supabaseUserId) {
        return res.status(401).json({ ok: false, error: 'authentication_required' });
      }
      const profileId = String(req.params.id || '').trim();
      if (!profileId) {
        return res.status(400).json({ ok: false, error: 'missing_id' });
      }
      const deleted = await prisma.$transaction(async (tx) => {
        const existing = await tx.user_prompt_profiles.findFirst({
          where: { id: profileId, supabase_user_id: supabaseUserId },
        });
        if (!existing) {
          return null;
        }
        await tx.user_prompt_profiles.delete({ where: { id: profileId } });
        if (existing.is_default) {
          const fallback = await tx.user_prompt_profiles.findFirst({
            where: { supabase_user_id: supabaseUserId },
            orderBy: [{ updated_at: 'desc' }],
          });
          if (fallback) {
            await tx.user_prompt_profiles.update({
              where: { id: fallback.id },
              data: { is_default: true },
            });
          }
        }
        return existing;
      });
      if (!deleted) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }
      return res.json({ ok: true });
    } catch (error: any) {
      log.error(`${style.status('delete', 'error')} ${style.kv('error', error?.message || error)}`, error);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });
}
