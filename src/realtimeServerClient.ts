import WebSocket from 'ws';
import type { Env } from './env.js';
import { logger, style } from './logger.js';

export class RealtimeBroadcastError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RealtimeBroadcastError';
    this.status = status;
  }
}

const realtimeLog = logger.child('realtime.broadcast');

export interface BroadcastSessionInput {
  sessionId: string;
  clientSecret: string;
}

interface SendOptions {
  modalities?: Array<'audio' | 'text'>;
  timeoutMs?: number;
}

export async function sendRealtimeBroadcast(
  env: Env,
  session: BroadcastSessionInput,
  prompt: string,
  opts: SendOptions = {}
): Promise<void> {
  const base = env.OPENAI_API_BASE || 'https://api.openai.com';
  const url = new URL(`/v1/realtime/sessions/${encodeURIComponent(session.sessionId)}`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;

  const timeoutMs = Math.max(1000, opts.timeoutMs ?? 5000);
  const modalities = opts.modalities ?? ['audio', 'text'];

  realtimeLog.debug(
    `${style.status('send', 'info')} ${style.kv('session', session.sessionId)} ${style.kv('prompt', prompt)}`
  );

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const ws = new WebSocket(url.toString(), {
      headers: {
        Authorization: `Bearer ${session.clientSecret}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const cleanup = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000);
        }
      } catch {}
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    timer = setTimeout(() => {
      cleanup(new RealtimeBroadcastError('Realtime broadcast timed out'));
    }, timeoutMs);

    ws.on('open', () => {
      const payload = {
        type: 'response.create',
        response: {
          instructions: prompt,
          modalities,
          conversation: null,
        },
      };

      ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          cleanup(err);
          return;
        }
        // allow a brief window for server acknowledgement before closing
        setTimeout(() => {
          cleanup();
        }, 100);
      });
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed?.type === 'error') {
          const status = typeof parsed?.code === 'number' ? Number(parsed.code) : undefined;
          cleanup(new RealtimeBroadcastError(parsed?.message || 'Realtime session error', status));
        }
      } catch {}
    });

    ws.on('error', (err: any) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      const match = /Unexpected server response: (\d{3})/i.exec(error.message);
      if (match) {
        const status = Number(match[1]);
        cleanup(new RealtimeBroadcastError(error.message, status));
      } else {
        cleanup(error);
      }
    });

    ws.on('close', (code, reason) => {
      if (settled) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (code && code !== 1000) {
        const text = reason.toString() || `closed with code ${code}`;
        cleanup(new RealtimeBroadcastError(text, code));
      } else {
        cleanup();
      }
    });
  });
}
