#!/usr/bin/env tsx
/**
 * Quick Supabase session inspector.
 *
 * Usage:
 *   tsx scripts/auth/listSessions.ts --email branch@branch.bet
 *   tsx scripts/auth/listSessions.ts --user-id 870d18de-f8ff-4ecb-bf69-82e3a89eb40f
 *
 * Requires psql on PATH and DATABASE_URL in .env (or env var).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type Args = {
  email?: string;
  userId?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--email' && argv[i + 1]) {
      args.email = argv[++i];
    } else if (token === '--user-id' && argv[i + 1]) {
      args.userId = argv[++i];
    }
  }
  return args;
}

function loadDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length) {
    return process.env.DATABASE_URL.trim();
  }
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('DATABASE_URL missing and .env not found');
  }
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const url = parsed.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL missing from environment');
  }
  return url;
}

function runPsql(connection: string, sql: string): string {
  const result = spawnSync(
    'psql',
    [
      connection,
      '-t',
      '-A',
      '-F',
      '\t',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || 'psql failed');
  }
  return result.stdout.trim();
}

function resolveUserId(connection: string, email: string): string {
  const sql = `
    select id
    from auth.users
    where lower(email) = lower('${email.replace(/'/g, "''")}')
    limit 1
  `;
  const out = runPsql(connection, sql);
  if (!out) {
    throw new Error(`No Supabase user found for email ${email}`);
  }
  return out.split(/\s+/)[0].trim();
}

function listSessions(connection: string, userId: string): string {
  const sql = `
    with latest_rt as (
      select distinct on (session_id)
        session_id,
        revoked,
        updated_at as rt_updated_at
      from auth.refresh_tokens
      where session_id is not null
      order by session_id, rt_updated_at desc
    )
    select
      s.id,
      s.created_at,
      s.updated_at,
      coalesce(l.rt_updated_at, s.updated_at) as refresh_updated_at,
      coalesce(l.revoked, false) as refresh_revoked,
      s.user_agent,
      s.ip
    from auth.sessions s
    left join latest_rt l on l.session_id = s.id
    where s.user_id = '${userId.replace(/'/g, "''")}'
    order by s.updated_at desc
  `;
  return runPsql(connection, sql);
}

function printTable(raw: string) {
  if (!raw) {
    console.log('No active sessions found.');
    return;
  }
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('\t'));

  const headers = [
    'session_id',
    'created_at (UTC)',
    'updated_at (UTC)',
    'refresh_updated_at',
    'refresh_revoked',
    'user_agent',
    'ip',
  ];

  const widths = headers.map((h) => h.length);
  rows.forEach((cols) => {
    cols.forEach((col, idx) => {
      widths[idx] = Math.max(widths[idx], col.length);
    });
  });

  const format = (cols: string[]) =>
    cols
      .map((col, idx) => col.padEnd(widths[idx]))
      .join('  ')
      .trimEnd();

  console.log(format(headers));
  console.log(
    widths
      .map((w) => '-'.repeat(w))
      .join('  ')
      .trimEnd(),
  );
  rows.forEach((cols) => console.log(format(cols)));
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const connection = loadDatabaseUrl();
    const userId =
      args.userId ??
      (args.email ? resolveUserId(connection, args.email) : null);
    if (!userId) {
      console.error('Usage: tsx scripts/auth/listSessions.ts (--email <email> | --user-id <uuid>)');
      process.exit(1);
    }
    const raw = listSessions(connection, userId);
    printTable(raw);
  } catch (error: any) {
    console.error(`Error: ${error?.message || error}`);
    process.exit(1);
  }
}

void main();
