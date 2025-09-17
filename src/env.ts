import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load only necessary vars from parent repo .env files (without blindly copying)
function preloadParentEnv() {
  try {
    const cwd = process.cwd();
    const candidates = [
      path.resolve(cwd, '../../.env'),            // repo root
      path.resolve(cwd, '../.env'),               // alpha/.env (if ever used)
      path.resolve(cwd, '../../token-ai/.env'),   // token-ai/.env as fallback
    ];
    const needed = new Set(['OPENAI_API_KEY', 'OPENAI_REALTIME_MODEL', 'TEXT_MODEL', 'MCP_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']);
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const parsed = dotenv.parse(fs.readFileSync(p));
        for (const key of needed) {
          const cur = process.env[key];
          const val = parsed[key];
          if ((!cur || cur === '') && val && val !== '') {
            process.env[key] = val;
          }
        }
        // Stop after first file that provides OPENAI_API_KEY
        if (process.env.OPENAI_API_KEY) break;
      }
    }
  } catch {}
}

preloadParentEnv();

const envSchema = z.object({
  // Optional at boot; /realtime/session will error if missing
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_API_BASE: z.string().optional().default('https://api.openai.com'),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime'),
  TEXT_MODEL: z.string().default('gpt-5-mini'),
  MCP_URL: z.string().url().default('https://mcp.dexter.cash/mcp'),
  // Bearer token for MCP when OAuth is enabled on the MCP server
  TOKEN_AI_MCP_TOKEN: z.string().optional().default(''),
  // Optional comma-separated allowlists to constrain tools per surface
  MCP_ALLOWED_TOOLS_CHAT: z.string().optional().default(''),
  MCP_ALLOWED_TOOLS_VOICE: z.string().optional().default(''),
  PORT: z.coerce.number().default(3030),
  ALLOWED_ORIGINS: z.string().default('*'),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_API_BASE: process.env.OPENAI_API_BASE,
    OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL,
    TEXT_MODEL: process.env.TEXT_MODEL,
    MCP_URL: process.env.MCP_URL,
    TOKEN_AI_MCP_TOKEN: process.env.TOKEN_AI_MCP_TOKEN,
    MCP_ALLOWED_TOOLS_CHAT: process.env.MCP_ALLOWED_TOOLS_CHAT,
    MCP_ALLOWED_TOOLS_VOICE: process.env.MCP_ALLOWED_TOOLS_VOICE,
    PORT: process.env.PORT,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  });
}
