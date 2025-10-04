import { Prisma } from '@prisma/client';
import prisma from './prisma.js';
import { logger } from './logger.js';

const log = logger.child('prompt-profiles');

type PromptReference = {
  slug: string;
  fallback: string;
};

export type ConciergePromptProfileDefinition = {
  id: string;
  agentName?: string;
  voiceKey?: string | null;
  instructionSegments: PromptReference[];
  handoffDescription: PromptReference;
  guestInstructions: PromptReference;
  toolDescriptions: Record<string, PromptReference>;
};

export type ResolvedConciergeProfile = {
  id: string;
  agentName: string;
  voiceKey?: string | null;
  instructions: string;
  instructionSegments: string[];
  handoffDescription: string;
  guestInstructions: string;
  toolDescriptions: Record<string, string>;
};

export const DEFAULT_AGENT_NAME = 'dexterVoice';

export function missingPromptFallback(slug: string): string {
  return `⚠️ Missing prompt module "${slug}". Update it in the Super Admin prompt editor.`;
}

const DEFAULT_CONCIERGE_PROFILE_DEFINITION: ConciergePromptProfileDefinition = {
  id: 'default',
  agentName: DEFAULT_AGENT_NAME,
  voiceKey: null,
  instructionSegments: [
    {
      slug: 'agent.concierge.instructions',
      fallback: missingPromptFallback('agent.concierge.instructions'),
    },
  ],
  handoffDescription: {
    slug: 'agent.concierge.handoff',
    fallback: missingPromptFallback('agent.concierge.handoff'),
  },
  guestInstructions: {
    slug: 'agent.concierge.guest',
    fallback: missingPromptFallback('agent.concierge.guest'),
  },
  toolDescriptions: {
    resolve_wallet: {
      slug: 'agent.concierge.tool.resolve_wallet',
      fallback: missingPromptFallback('agent.concierge.tool.resolve_wallet'),
    },
    list_my_wallets: {
      slug: 'agent.concierge.tool.list_my_wallets',
      fallback: missingPromptFallback('agent.concierge.tool.list_my_wallets'),
    },
    set_session_wallet_override: {
      slug: 'agent.concierge.tool.set_session_wallet_override',
      fallback: missingPromptFallback('agent.concierge.tool.set_session_wallet_override'),
    },
    auth_info: {
      slug: 'agent.concierge.tool.auth_info',
      fallback: missingPromptFallback('agent.concierge.tool.auth_info'),
    },
    pumpstream_live_summary: {
      slug: 'agent.concierge.tool.pumpstream_live_summary',
      fallback: missingPromptFallback('agent.concierge.tool.pumpstream_live_summary'),
    },
    search: {
      slug: 'agent.concierge.tool.search',
      fallback: missingPromptFallback('agent.concierge.tool.search'),
    },
    fetch: {
      slug: 'agent.concierge.tool.fetch',
      fallback: missingPromptFallback('agent.concierge.tool.fetch'),
    },
    codex_start: {
      slug: 'agent.concierge.tool.codex_start',
      fallback: missingPromptFallback('agent.concierge.tool.codex_start'),
    },
    codex_reply: {
      slug: 'agent.concierge.tool.codex_reply',
      fallback: missingPromptFallback('agent.concierge.tool.codex_reply'),
    },
    codex_exec: {
      slug: 'agent.concierge.tool.codex_exec',
      fallback: missingPromptFallback('agent.concierge.tool.codex_exec'),
    },
  },
};

const PROFILE_CACHE = new Map<string, { value: ResolvedConciergeProfile; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

type UserPromptProfileRecord = Awaited<ReturnType<typeof prisma.user_prompt_profiles.findFirst>> extends infer T
  ? T extends null
    ? never
    : T
  : never;

function normalizeToolSlugPayload(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim().length) {
      map[key] = value.trim();
    }
  }
  return map;
}

export function buildDefinitionFromRecord(record: UserPromptProfileRecord): ConciergePromptProfileDefinition {
  const base = DEFAULT_CONCIERGE_PROFILE_DEFINITION;
  const toolOverrides = normalizeToolSlugPayload(record.tool_slugs ?? {});
  const metadata = (record.metadata && typeof record.metadata === 'object') ? record.metadata as Record<string, any> : {};

  const toolDescriptions: Record<string, PromptReference> = {};
  for (const [key, ref] of Object.entries(base.toolDescriptions)) {
    const slug = toolOverrides[key] ?? ref.slug;
    toolDescriptions[key] = {
      slug,
      fallback: missingPromptFallback(slug),
    };
  }

  for (const [key, slug] of Object.entries(toolOverrides)) {
    if (!toolDescriptions[key]) {
      toolDescriptions[key] = {
        slug,
        fallback: missingPromptFallback(slug),
      };
    }
  }

  return {
    id: record.id,
    agentName: (typeof metadata?.agentName === 'string' && metadata.agentName.trim().length)
      ? metadata.agentName.trim()
      : record.name || base.agentName || DEFAULT_AGENT_NAME,
    voiceKey: record.voice_key ?? base.voiceKey ?? null,
    instructionSegments: [
      {
        slug: record.instruction_slug,
        fallback: missingPromptFallback(record.instruction_slug),
      },
    ],
    handoffDescription: {
      slug: record.handoff_slug,
      fallback: missingPromptFallback(record.handoff_slug),
    },
    guestInstructions: {
      slug: record.guest_slug,
      fallback: missingPromptFallback(record.guest_slug),
    },
    toolDescriptions,
  };
}

export async function resolveProfileRecord(record: UserPromptProfileRecord): Promise<ResolvedConciergeProfile> {
  const definition = buildDefinitionFromRecord(record);
  return resolveConciergeProfile({ profile: definition, skipCache: true });
}

async function loadPromptSegment(ref: PromptReference): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<{ segment: string | null }[]>(Prisma.sql`
      SELECT segment
      FROM public.prompt_modules
      WHERE slug = ${ref.slug}
      LIMIT 1
    `);

    if (rows.length && typeof rows[0].segment === 'string' && rows[0].segment) {
      return rows[0].segment;
    }
    log.error({ slug: ref.slug }, 'prompt-module-missing');
  } catch (error: any) {
    log.error({ slug: ref.slug, error: error?.message || error }, 'prompt-module-load-failed');
  }
  return ref.fallback;
}

export async function resolveConciergeProfile(options: {
  profile?: ConciergePromptProfileDefinition;
  skipCache?: boolean;
} = {}): Promise<ResolvedConciergeProfile> {
  const definition = options.profile ?? DEFAULT_CONCIERGE_PROFILE_DEFINITION;

  if (!options.skipCache) {
    const cached = PROFILE_CACHE.get(definition.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  const instructionSegments = await Promise.all(
    definition.instructionSegments.map((segment) => loadPromptSegment(segment)),
  );
  const instructions = instructionSegments.map((value) => value.trim()).filter(Boolean).join('\n\n');

  const handoffDescription = await loadPromptSegment(definition.handoffDescription);
  const guestInstructions = await loadPromptSegment(definition.guestInstructions);

  const toolPairs = await Promise.all(
    Object.entries(definition.toolDescriptions).map(async ([key, ref]) => {
      const value = await loadPromptSegment(ref);
      return [key, value] as const;
    }),
  );

  const resolved: ResolvedConciergeProfile = {
    id: definition.id,
    agentName: definition.agentName ?? DEFAULT_AGENT_NAME,
    voiceKey: definition.voiceKey ?? null,
    instructions,
    instructionSegments,
    handoffDescription,
    guestInstructions,
    toolDescriptions: Object.fromEntries(toolPairs),
  };

  PROFILE_CACHE.set(definition.id, {
    value: resolved,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return resolved;
}

export function getDefaultConciergeProfileDefinition(): ConciergePromptProfileDefinition {
  return DEFAULT_CONCIERGE_PROFILE_DEFINITION;
}

export async function fetchUserPromptProfiles(supabaseUserId: string) {
  return prisma.user_prompt_profiles.findMany({
    where: { supabase_user_id: supabaseUserId },
    orderBy: [{ created_at: 'asc' }],
  });
}

export async function fetchDefaultProfileRecordForUser(supabaseUserId: string) {
  return prisma.user_prompt_profiles.findFirst({
    where: {
      supabase_user_id: supabaseUserId,
      is_default: true,
    },
    orderBy: [{ updated_at: 'desc' }],
  });
}

export async function fetchResolvedProfileForUser(supabaseUserId: string): Promise<ResolvedConciergeProfile | null> {
  const record = await fetchDefaultProfileRecordForUser(supabaseUserId);
  if (!record) return null;
  return resolveProfileRecord(record);
}
