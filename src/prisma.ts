import { PrismaClient } from '@prisma/client';

try {
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl && /pooler\.supabase\.com/.test(dbUrl) && !/pgbouncer=true/i.test(dbUrl)) {
    const connector = dbUrl.includes('?') ? '&' : '?';
    const extras = 'pgbouncer=true&connection_limit=1';
    process.env.DATABASE_URL = `${dbUrl}${connector}${extras}`;
  }
} catch {}

// Ensure we reuse the Prisma client across hot reloads in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
