import OpenAI from 'openai';
import type { Env } from './env.js';

let client: OpenAI | null = null;

export function getOpenAI(env: Env): OpenAI {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}

