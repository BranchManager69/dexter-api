import { Env } from '../env.js';
import { logger, style } from '../logger.js';
import prisma from '../prisma.js';
import { getOpenAI } from '../openaiClient.js';

const summarizerLog = logger.child('memory.summarizer');
const MAX_BATCH = 3;
const DEFAULT_INTERVAL_MS = 30_000;

const SUMMARY_SCHEMA = {
  name: 'MemorySummary',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'facts', 'follow_ups'],
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
    },
  },
} as const;

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
      const result = (call as any).result;
      const argsText = typeof args === 'string' ? args : JSON.stringify(args ?? {}, null, 2);
      const resultText = typeof result === 'string' ? result : JSON.stringify(result ?? {}, null, 2);
      return `Tool ${name}\nArgs: ${argsText}\nResult: ${resultText}`;
    })
    .filter(Boolean)
    .join('\n');
}

function truncate(str: string, max = 8000): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n...[truncated]`;
}

async function summarizeLog(env: Env, log: any) {
  const transcriptText = truncate(transcriptToText(log.transcript ?? []), 8000);
  const toolText = truncate(toolCallsToText(log.tool_calls ?? []), 4000);

  const input = `You are Dexter Voice memory summarizer. Extract an objective, privacy-conscious summary of the user interaction for future personalization. Focus on what matters to the user, important facts, and follow-ups. Return strict JSON matching the schema.\n\nConversation transcript:\n${transcriptText || 'No transcript provided.'}\n\nTool activity:\n${toolText || 'No tool calls recorded.'}`;

  const client = getOpenAI(env);
  const response = await client.responses.create({
    model: env.TEXT_MODEL || 'gpt-4.1-mini',
    input,
    response_format: { type: 'json_schema', json_schema: SUMMARY_SCHEMA },
  } as any);

  const jsonText = typeof response.output_text === 'string' ? response.output_text.trim() : '';
  if (!jsonText) {
    throw new Error('summarizer_empty_response');
  }

  const parsed = JSON.parse(jsonText);
  if (typeof parsed.summary !== 'string') {
    throw new Error('summarizer_missing_summary');
  }

  return {
    summary: parsed.summary.trim(),
    facts: Array.isArray(parsed.facts)
      ? parsed.facts
          .filter((item: any) => typeof item === 'string' && item.trim())
          .map((item: string) => item.trim())
      : [],
    followUps: Array.isArray(parsed.follow_ups)
      ? parsed.follow_ups
          .filter((item: any) => typeof item === 'string' && item.trim())
          .map((item: string) => item.trim())
      : [],
  };
}

async function persistMemory(log: any, memory: { summary: string; facts: string[]; followUps: string[] }) {
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

    await tx.conversation_logs.update({
      where: { id: log.id },
      data: {
        status: 'summarized',
        error_message: null,
      },
    });

    const staleMemories = await tx.user_memories.findMany({
      where: { supabase_user_id: log.supabase_user_id },
      orderBy: { created_at: 'desc' },
      skip: 20,
      select: { id: true },
    });
    if (staleMemories.length) {
      await tx.user_memories.deleteMany({ where: { id: { in: staleMemories.map((m) => m.id) } } });
    }
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
          await persistMemory(log, memory);
          summarizerLog.success(
            `${style.status('summarize', 'success')} ${style.kv('session', log.session_id)} ${style.kv('summary_length', memory.summary.length)}`,
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
