import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load only necessary vars from parent repo .env files (without blindly copying)
function preloadParentEnv() {
  try {
    const cwd = process.cwd();
    const candidates = [
      path.resolve(cwd, '../dexter-ops/.env'), // shared ops repo env
      path.resolve(cwd, '../../.env'),        // legacy repo root
      path.resolve(cwd, '../.env'),           // legacy alpha/.env
      path.resolve(cwd, '.env'),              // service-local .env
    ];
    const needed = new Set([
      'OPENAI_API_KEY',
      'OPENAI_REALTIME_MODEL',
      'TEXT_MODEL',
      'MCP_URL',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_JWT_SECRET',
      'DATABASE_URL',
    ]);
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const parsed = dotenv.parse(fs.readFileSync(p));
      for (const key of Array.from(needed)) {
        const current = process.env[key];
        const value = parsed[key];
        if ((!current || current === '') && value && value !== '') {
          process.env[key] = value;
          needed.delete(key);
        }
      }
      if (!needed.size) break;
    }
    if (needed.size) {
      try {
        console.warn('[env] preload missing values for', Array.from(needed).join(', '));
      } catch {}
    }
  } catch {}
}

preloadParentEnv();

try {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl && /pooler\.supabase\.com/.test(dbUrl) && !/pgbouncer=true/i.test(dbUrl)) {
    const connector = dbUrl.includes('?') ? '&' : '?';
    const extras = 'pgbouncer=true&connection_limit=1';
    process.env.DATABASE_URL = `${dbUrl}${connector}${extras}`;
  }
} catch {}

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
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  SUPABASE_JWT_SECRET: z.string().optional().default(''),
  X402_ENABLED: z.coerce.boolean().default(true),
  X402_FACILITATOR_URL: z.string().url().default('http://127.0.0.1:4070'),
  X402_PAY_TO: z.string().min(1).default('DEXVS3su4dZQWTvvPnLDJLRK1CeeKG6K3QqdzthgAkNV'),
  X402_ASSET_MINT: z.string().min(1).default('2KiHzSXdnenDoDNsVsjU6VcvgyyDK27iSoZv6TNDpump'),
  X402_ASSET_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),
  X402_PRICE_AMOUNT: z.string().min(1).default('100000000'),
  X402_PRICE_DESCRIPTION: z.string().default('Test access (100 custom tokens)'),
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
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    X402_ENABLED: process.env.X402_ENABLED,
    X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL,
    X402_PAY_TO: process.env.X402_PAY_TO,
    X402_ASSET_MINT: process.env.X402_ASSET_MINT,
    X402_ASSET_DECIMALS: process.env.X402_ASSET_DECIMALS,
    X402_PRICE_AMOUNT: process.env.X402_PRICE_AMOUNT,
    X402_PRICE_DESCRIPTION: process.env.X402_PRICE_DESCRIPTION,
  });
}
