import { Env } from '../env.js';
import { logger, style } from '../logger.js';
import prisma from '../prisma.js';
import { getOpenAI } from '../openaiClient.js';
import { fetchPromptSegment } from '../promptService.js';
import { MEMORY_LIMITS } from '../config/memory.js';
import { encoding_for_model, get_encoding, type Tiktoken } from 'tiktoken';

const summarizerLog = logger.child('memory.summarizer');
const MAX_BATCH = 3;
const DEFAULT_INTERVAL_MS = 30_000;
const MEMORY_PROMPT_SLUG = 'memory.summarizer.instructions';
const DOSSIER_PROMPT_SLUG = 'memory.dossier.instructions';
const DOSSIER_PROMPT_APPENDIX = 'Respond with JSON including a next_conversation_prompt key: a single question (<= 60 characters) suggesting a follow-up action for the user. If nothing is relevant, return an empty string for that key.';

const SUMMARY_SCHEMA = {
  name: 'MemorySummary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'facts', 'follow_ups', 'keep'],
    properties: {
      summary: { type: 'string' },
      facts: {
        type: 'array',
        items: { type: 'string' },
      },
      follow_ups: {
        type: 'array',
        items: { type: 'string' },
      },
      keep: { type: 'boolean' },
    },
  },
} as const;

const DOSSIER_SCHEMA = {
  name: 'UserDossier',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['identity', 'holdings', 'stats', 'next_conversation_prompt'],
    properties: {
      identity: {
        type: 'object',
        additionalProperties: false,
        required: ['preferredName'],
        properties: {
          preferredName: { type: 'string' },
          email: { type: 'string' },
          walletAddress: { type: 'string' },
          otherIds: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
      holdings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['symbol'],
          properties: {
            symbol: { type: 'string' },
            mintAddress: { type: 'string' },
            usdValue: { type: 'string' },
            marketCapUsd: { type: 'string' },
            portfolioWeightPct: { type: 'string' },
          },
        },
      },
      preferences: {
        type: 'object',
        additionalProperties: true,
      },
      stats: {
        type: 'object',
        additionalProperties: false,
        required: ['firstConversationAt', 'lastConversationAt', 'memoryCount'],
        properties: {
          firstConversationAt: { type: 'string' },
          lastConversationAt: { type: 'string' },
          memoryCount: { type: 'number' },
        },
      },
      next_conversation_prompt: {
        type: 'string',
      },
    },
  },
} as const;

type UserDossier = {
  identity: {
    preferredName: string;
    email: string;
    walletAddress: string;
    otherIds: string[];
  };
  holdings: Array<{
    symbol: string;
    mintAddress: string;
    usdValue: string;
    marketCapUsd: string;
    portfolioWeightPct: string;
  }>;
  preferences: Record<string, any>;
  stats: {
    firstConversationAt: string;
    lastConversationAt: string;
    memoryCount: number;
  };
  nextConversationPrompt: string;
};

type DossierFallback = {
  preferredName: string | null;
  email: string | null;
  walletAddress: string | null;
  otherIds: string[];
  firstConversationAt: string | null;
  lastConversationAt: string | null;
  memoryCount: number;
  nextConversationPrompt: string | null;
  existingDossier?: any;
};

type MemoryPayload = {
  summary: string;
  facts: string[];
  followUps: string[];
};

const encoderCache = new Map<string, Tiktoken>();
let baseEncoder: Tiktoken | null = null;

function getEncoder(model: string): Tiktoken {
  const key = model || 'default';
  if (encoderCache.has(key)) {
    return encoderCache.get(key)!;
  }

  try {
    const encoder = encoding_for_model(model as any);
    encoderCache.set(key, encoder);
    return encoder;
  } catch (error) {
    if (!baseEncoder) {
      baseEncoder = get_encoding('cl100k_base');
    }
    encoderCache.set(key, baseEncoder);
    return baseEncoder;
  }
}

function countTokens(payload: string, model: string): number {
  try {
    const encoder = getEncoder(model);
    return encoder.encode(payload).length;
  } catch (error) {
    summarizerLog.warn({ error: error instanceof Error ? error.message : String(error) }, 'tokenizer-encode-failed');
    return payload.length / 4;
  }
}

function sanitizeDossier(raw: any, fallback: DossierFallback): UserDossier {
  const existing = fallback.existingDossier && typeof fallback.existingDossier === 'object'
    ? fallback.existingDossier
    : null;

  const identitySource = raw && typeof raw === 'object' && raw.identity && typeof raw.identity === 'object'
    ? raw.identity as Record<string, any>
    : existing && typeof existing.identity === 'object'
      ? existing.identity as Record<string, any>
      : {};

  const preferredName = (() => {
    if (typeof identitySource.preferredName === 'string' && identitySource.preferredName.trim().length) {
      return identitySource.preferredName.trim();
    }
    if (typeof fallback.preferredName === 'string' && fallback.preferredName.trim().length) {
      return fallback.preferredName.trim();
    }
    if (existing && typeof existing.identity?.preferredName === 'string') {
      const value = String(existing.identity.preferredName).trim();
      if (value) return value;
    }
    return 'friend';
  })();

  const emailCandidate = typeof identitySource.email === 'string' && identitySource.email.trim().length
    ? identitySource.email.trim()
    : typeof fallback.email === 'string' && fallback.email.trim().length
      ? fallback.email.trim()
      : existing && typeof existing.identity?.email === 'string' && existing.identity.email.trim().length
        ? existing.identity.email.trim()
        : '';

  const walletCandidate = typeof identitySource.walletAddress === 'string' && identitySource.walletAddress.trim().length
    ? identitySource.walletAddress.trim()
    : typeof fallback.walletAddress === 'string' && fallback.walletAddress.trim().length
      ? fallback.walletAddress.trim()
      : existing && typeof existing.identity?.walletAddress === 'string' && existing.identity.walletAddress.trim().length
        ? existing.identity.walletAddress.trim()
        : '';

  const otherIdsMerged = new Set<string>();
  const addIds = (value: any) => {
    if (!value) return;
    const arr = Array.isArray(value) ? value : [value];
    for (const entry of arr) {
      if (typeof entry === 'string' && entry.trim().length) {
        otherIdsMerged.add(entry.trim());
      }
    }
  };
  addIds(identitySource.otherIds);
  addIds(fallback.otherIds);
  if (existing && Array.isArray(existing.identity?.otherIds)) {
    addIds(existing.identity.otherIds);
  }

  const identity: UserDossier['identity'] = {
    preferredName,
    email: emailCandidate,
    walletAddress: walletCandidate,
    otherIds: Array.from(otherIdsMerged),
  };

  const holdingsSource = Array.isArray(raw?.holdings)
    ? raw.holdings as any[]
    : Array.isArray(existing?.holdings)
      ? existing.holdings as any[]
      : [];

  const holdings = holdingsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const symbol = typeof (entry as any).symbol === 'string' ? (entry as any).symbol.trim() : '';
      if (!symbol) return null;
      const normalized: UserDossier['holdings'][number] = {
        symbol,
        mintAddress: '',
        usdValue: '',
        marketCapUsd: '',
        portfolioWeightPct: '',
      };

      const mintAddress = (entry as any).mintAddress;
      if (typeof mintAddress === 'string' && mintAddress.trim().length) {
        normalized.mintAddress = mintAddress.trim();
      }

      const setMetric = (
        key: 'usdValue' | 'marketCapUsd' | 'portfolioWeightPct',
        value: any,
      ) => {
        if (typeof value === 'number') {
          normalized[key] = value.toString();
        } else if (typeof value === 'string' && value.trim().length) {
          normalized[key] = value.trim();
        }
      };

      setMetric('usdValue', (entry as any).usdValue);
      setMetric('marketCapUsd', (entry as any).marketCapUsd);
      setMetric('portfolioWeightPct', (entry as any).portfolioWeightPct);

      return normalized;
    })
    .filter(Boolean) as UserDossier['holdings'];

  const statsSource = raw && raw.stats && typeof raw.stats === 'object'
    ? raw.stats as Record<string, any>
    : existing && existing.stats && typeof existing.stats === 'object'
      ? existing.stats as Record<string, any>
      : {};

  const preferences = (() => {
    const existingPreferences = existing && existing.preferences && typeof existing.preferences === 'object'
      ? existing.preferences
      : {};
    const rawPreferences = raw && raw.preferences && typeof raw.preferences === 'object'
      ? raw.preferences
      : {};
    return { ...existingPreferences, ...rawPreferences };
  })();

  const stats: UserDossier['stats'] = {
    firstConversationAt: typeof statsSource.firstConversationAt === 'string'
      ? statsSource.firstConversationAt
      : fallback.firstConversationAt || '',
    lastConversationAt: typeof statsSource.lastConversationAt === 'string'
      ? statsSource.lastConversationAt
      : fallback.lastConversationAt || '',
    memoryCount: typeof statsSource.memoryCount === 'number'
      ? statsSource.memoryCount
      : fallback.memoryCount,
  };

  const promptCandidate = (() => {
    if (raw && typeof raw === 'object' && typeof (raw as any).next_conversation_prompt === 'string') {
      return (raw as any).next_conversation_prompt;
    }
    if (existing && typeof existing.nextConversationPrompt === 'string') {
      return existing.nextConversationPrompt;
    }
    if (existing && typeof existing.next_conversation_prompt === 'string') {
      return existing.next_conversation_prompt;
    }
    return fallback.nextConversationPrompt ?? '';
  })();

  const dossier: UserDossier = {
    identity,
    holdings,
    preferences,
    stats,
    nextConversationPrompt: sanitizeNextConversationPrompt(promptCandidate),
  };

  return dossier;
}

function sanitizeNextConversationPrompt(value: unknown): string {
  if (typeof value !== 'string') return '';

  let prompt = value.replace(/\s+/g, ' ').trim();
  if (!prompt) return '';

  if (!prompt.endsWith('?')) {
    prompt = prompt.replace(/[?!\.]+$/u, '').trim();
    if (!prompt) return '';
    prompt = `${prompt}?`;
  }

  if (prompt.length > 60) {
    prompt = prompt.slice(0, 60).trimEnd();
    if (!prompt.endsWith('?')) {
      const base = prompt.replace(/[?!\.]+$/u, '').slice(0, 59).trimEnd();
      prompt = base ? `${base}?` : '';
    }
  }

  if (prompt.length > 60) {
    prompt = prompt.slice(0, 59).trimEnd();
    prompt = prompt ? `${prompt}?` : '';
  }

  return prompt.length <= 60 ? prompt : prompt.slice(0, 59).trimEnd() + '?';
}

function transcriptToText(transcript: unknown): string {
  if (!Array.isArray(transcript)) return '';
  const chunks = transcript
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const role = typeof (entry as any).role === 'string' ? (entry as any).role : 'unknown';
      const content = (entry as any).content;
      if (Array.isArray(content)) {
        const text = content
          .map((piece: any) => (typeof piece?.text === 'string' ? piece.text : ''))
          .filter(Boolean)
          .join(' ');
        return text ? `${role}: ${text}` : '';
      }
      if (typeof content === 'string') {
        return `${role}: ${content}`;
      }
      return '';
    })
    .filter(Boolean);
  return chunks.join('\n');
}

function toolCallsToText(toolCalls: unknown): string {
  if (!Array.isArray(toolCalls)) return '';

  return toolCalls
    .map((call) => {
      if (!call || typeof call !== 'object') return '';

      const name = typeof (call as any).name === 'string' ? (call as any).name : 'tool';
      const args = (call as any).arguments;

      const rawResult = (call as any).result;
      const wrappedOutput = (call as any).output;
      const dataOutput = (call as any).data?.output;
      const structuredOutput = rawResult ?? wrappedOutput ?? dataOutput ?? null;

      const argsText = typeof args === 'string'
        ? args
        : JSON.stringify(args ?? {}, null, 2);

      const resultText = typeof structuredOutput === 'string'
        ? structuredOutput
        : JSON.stringify(structuredOutput ?? {}, null, 2);

      return `Tool ${name}\nArgs: ${argsText}\nResult: ${resultText}`;
    })
    .filter(Boolean)
    .join('\n');
}

function truncate(str: string, max = 8000): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n...[truncated]`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string' && entry.trim().length)
    .map((entry) => entry.trim());
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

async function loadMemoryPrompt(): Promise<string> {
  return fetchPromptSegment(MEMORY_PROMPT_SLUG);
}

async function loadDossierPrompt(): Promise<string> {
  return fetchPromptSegment(DOSSIER_PROMPT_SLUG);
}

async function summarizeLog(env: Env, log: any) {
  const transcriptText = truncate(transcriptToText(log.transcript ?? []), 8000);
  const toolText = truncate(toolCallsToText(log.tool_calls ?? []), 4000);
  const basePrompt = await loadMemoryPrompt();
  const input = `${basePrompt}\n\nConversation transcript:\n${transcriptText || 'No transcript provided.'}\n\nTool activity:\n${toolText || 'No tool calls recorded.'}`;

  const model = env.TEXT_MODEL || 'gpt-5-mini';
  const inputTokens = countTokens(input, model);
  summarizerLog.debug({ session: log.session_id, inputTokens }, 'memory-summarizer-token-count');

  const client = getOpenAI(env);
  const response = await client.responses.parse({
    model,
    input,
    text: {
      format: {
        type: 'json_schema',
        name: SUMMARY_SCHEMA.name,
        schema: SUMMARY_SCHEMA.schema,
      },
    },
  } as any);

  const parsed = response.output_parsed as
    | { summary?: string; facts?: unknown; follow_ups?: unknown; keep?: unknown }
    | null;

  if (!parsed || typeof parsed.summary !== 'string') {
    throw new Error('summarizer_missing_summary');
  }

  const facts = Array.isArray(parsed.facts)
    ? parsed.facts
        .filter((item: any) => typeof item === 'string' && item.trim())
        .map((item: string) => item.trim())
    : [];

  const followUps = Array.isArray(parsed.follow_ups)
    ? parsed.follow_ups
        .filter((item: any) => typeof item === 'string' && item.trim())
        .map((item: string) => item.trim())
    : [];

  const keep = typeof parsed.keep === 'boolean' ? parsed.keep : true;

  try {
    if (response && typeof response === 'object' && 'usage' in response && response.usage) {
      summarizerLog.debug({ session: log.session_id, usage: response.usage }, 'memory-summarizer-usage');
    }
  } catch {}

  return {
    summary: parsed.summary.trim(),
    facts,
    followUps,
    keep,
  };
}

async function buildDossierSnapshot(env: Env, log: any, memory: MemoryPayload): Promise<UserDossier> {
  if (!log?.supabase_user_id) {
    throw new Error('missing_supabase_user_id');
  }

  const supabaseUserId = String(log.supabase_user_id);

  const [profile, existingMemories, firstConversation, lastConversation] = await Promise.all([
    prisma.user_profiles.findFirst({ where: { supabase_user_id: supabaseUserId } }),
    prisma.user_memories.findMany({
      where: { supabase_user_id: supabaseUserId },
      orderBy: { created_at: 'asc' },
    }),
    prisma.conversation_logs.findFirst({
      where: { supabase_user_id: supabaseUserId },
      orderBy: { started_at: 'asc' },
      select: { started_at: true },
    }),
    prisma.conversation_logs.findFirst({
      where: { supabase_user_id: supabaseUserId },
      orderBy: { started_at: 'desc' },
      select: { started_at: true },
    }),
  ]);

  const rawDossier = profile?.dossier as unknown;
  const existingDossier = (rawDossier && typeof rawDossier === 'object' && !Array.isArray(rawDossier))
    ? rawDossier as Record<string, any>
    : null;
  const profilePreferredName = typeof profile?.preferred_name === 'string' ? profile?.preferred_name : null;
  const profileDisplayName = typeof profile?.display_name === 'string' ? profile?.display_name : null;
  const profileMetadata = (profile?.metadata && typeof profile.metadata === 'object') ? profile.metadata : {};

  const firstConversationAt = toIsoString(firstConversation?.started_at) || toIsoString(log.started_at) || null;
  const lastConversationAtCandidate = toIsoString(log.ended_at)
    || toIsoString(lastConversation?.started_at)
    || toIsoString(log.started_at)
    || null;

  const existingMemoryPayloads = existingMemories.map((entry) => ({
    summary: entry.summary,
    facts: normalizeStringArray(entry.facts),
    followUps: normalizeStringArray(entry.follow_ups),
    createdAt: toIsoString(entry.created_at),
    sourceLogId: entry.source_log_id ?? null,
  }));

  const newMemoryPayload = {
    summary: memory.summary,
    facts: memory.facts,
    followUps: memory.followUps,
    createdAt: toIsoString(log.ended_at) || new Date().toISOString(),
    sourceLogId: log.id ?? null,
  };

  const appendedMemories = [...existingMemoryPayloads, newMemoryPayload];
  const totalMemoryCount = appendedMemories.length;
  const dossierRecentLimit = MEMORY_LIMITS.dossier.recentCount;
  const trimmedMemories = typeof dossierRecentLimit === 'number' && dossierRecentLimit > 0
    ? appendedMemories.slice(-dossierRecentLimit)
    : appendedMemories;
  const memoryCount = totalMemoryCount;

  const basePrompt = await loadDossierPrompt();
  const prompt = basePrompt && basePrompt.includes('next_conversation_prompt')
    ? basePrompt
    : `${basePrompt}\n\n${DOSSIER_PROMPT_APPENDIX}`;
  const model = env.TEXT_MODEL || 'gpt-5-mini';

  const dossierContext = {
    existingDossier,
    profile: {
      supabaseUserId,
      preferredName: profilePreferredName,
      displayName: profileDisplayName,
      metadata: profileMetadata,
    },
    newMemory: {
      summary: memory.summary,
      facts: memory.facts,
      followUps: memory.followUps,
      sessionId: log.session_id ?? null,
      startedAt: toIsoString(log.started_at),
      endedAt: toIsoString(log.ended_at),
    },
    memories: trimmedMemories,
    stats: {
      firstConversationAt,
      lastConversationAt: lastConversationAtCandidate,
      memoryCount,
    },
    nextConversationPrompt: typeof existingDossier?.nextConversationPrompt === 'string'
      ? existingDossier.nextConversationPrompt
      : typeof existingDossier?.next_conversation_prompt === 'string'
        ? existingDossier.next_conversation_prompt
        : null,
  };

  const inputPayload = JSON.stringify(dossierContext, null, 2);
  const input = `${prompt}\n\nContext:\n${inputPayload}`;

  const inputTokens = countTokens(input, model);
  summarizerLog.debug({ session: log.session_id, inputTokens }, 'memory-dossier-token-count');

  const client = getOpenAI(env);
  const response = await client.responses.parse({
    model,
    input,
    text: {
      format: {
        type: 'json_schema',
        name: DOSSIER_SCHEMA.name,
        schema: DOSSIER_SCHEMA.schema,
      },
    },
  } as any);

  try {
    if (response && typeof response === 'object' && 'usage' in response && response.usage) {
      summarizerLog.debug({ session: log.session_id, usage: response.usage }, 'memory-dossier-usage');
    }
  } catch {}

  const parsed = (response as any)?.output_parsed ?? null;
  const fallback: DossierFallback = {
    preferredName: profilePreferredName ?? profileDisplayName ?? null,
    email: existingDossier?.identity?.email ?? null,
    walletAddress: existingDossier?.identity?.walletAddress ?? null,
    otherIds: normalizeStringArray(existingDossier?.identity?.otherIds),
    firstConversationAt,
    lastConversationAt: lastConversationAtCandidate,
    memoryCount,
    nextConversationPrompt: typeof existingDossier?.nextConversationPrompt === 'string'
      ? existingDossier.nextConversationPrompt
      : typeof existingDossier?.next_conversation_prompt === 'string'
        ? existingDossier.next_conversation_prompt
        : null,
    existingDossier,
  };

  return sanitizeDossier(parsed, fallback);
}

async function persistMemory(log: any, memory: MemoryPayload, dossier: UserDossier) {
  await prisma.$transaction(async (tx) => {
    await tx.user_memories.create({
      data: {
        supabase_user_id: log.supabase_user_id,
        source_log_id: log.id,
        summary: memory.summary,
        facts: memory.facts,
        follow_ups: memory.followUps,
        metadata: {
          session_id: log.session_id,
          started_at: log.started_at,
          ended_at: log.ended_at,
        },
      },
    });

    const retentionLimit = MEMORY_LIMITS.storage.maxStoredPerUser;
    if (typeof retentionLimit === 'number' && retentionLimit > 0) {
      const staleMemories = await tx.user_memories.findMany({
        where: { supabase_user_id: log.supabase_user_id },
        orderBy: { created_at: 'desc' },
        skip: retentionLimit,
        select: { id: true },
      });
      if (staleMemories.length) {
        await tx.user_memories.deleteMany({ where: { id: { in: staleMemories.map((m) => m.id) } } });
      }
    }

    await tx.user_profiles.upsert({
      where: { supabase_user_id: log.supabase_user_id },
      update: { dossier },
      create: {
        supabase_user_id: log.supabase_user_id,
        dossier,
      },
    });

    await tx.conversation_logs.update({
      where: { id: log.id },
      data: {
        status: 'summarized',
        error_message: null,
      },
    });
  });
}

async function markFailed(logId: string, message: string) {
  await prisma.conversation_logs.update({
    where: { id: logId },
    data: {
      status: 'failed',
      error_message: message.slice(0, 512),
    },
  });
}

async function markSkipped(logId: string) {
  await prisma.conversation_logs.update({
    where: { id: logId },
    data: {
      status: 'skipped',
      error_message: null,
    },
  });
}

export function startMemorySummarizer(env: Env): () => void {
  if (!env.OPENAI_API_KEY) {
    summarizerLog.warn('openai_api_key_missing');
    return () => {};
  }

  let stopped = false;
  let running = false;
  const intervalCandidate = Number(env.MEMORY_SUMMARIZER_INTERVAL_MS || '');
  const interval = Number.isFinite(intervalCandidate) && intervalCandidate > 0
    ? intervalCandidate
    : DEFAULT_INTERVAL_MS;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const pending = await prisma.conversation_logs.findMany({
        where: { status: 'pending_summary' },
        orderBy: { started_at: 'asc' },
        take: MAX_BATCH,
      });

      if (!pending.length) return;

      for (const log of pending) {
        try {
          summarizerLog.info(
            `${style.status('summarize', 'start')} ${style.kv('session', log.session_id)} ${style.kv('user', log.supabase_user_id)}`,
          );
          const memory = await summarizeLog(env, log);
          if (!memory.keep) {
            summarizerLog.info(
              `${style.status('summarize', 'skip')} ${style.kv('session', log.session_id)} ${style.kv('reason', 'no_retained_content')}`,
            );
            await markSkipped(log.id);
            continue;
          }

          const { keep: _keep, ...memoryPayload } = memory;
          const dossier = await buildDossierSnapshot(env, log, memoryPayload);
          await persistMemory(log, memoryPayload, dossier);
          summarizerLog.success(
            `${style.status('summarize', 'success')} ${style.kv('session', log.session_id)} ${style.kv('summary_length', memoryPayload.summary.length)}`,
          );
        } catch (error: any) {
          const msg = error?.message || String(error);
          summarizerLog.error(
            `${style.status('summarize', 'error')} ${style.kv('session', log.session_id)} ${style.kv('error', msg)}`,
            error
          );
          await markFailed(log.id, msg);
        }
      }
    } catch (error: any) {
      summarizerLog.error(
        `${style.status('worker', 'error')} ${style.kv('error', error?.message || error)}`,
        error
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, Math.max(5_000, interval));

  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
