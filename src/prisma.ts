import { PrismaClient } from '@prisma/client';

try {
  const rawUrl = process.env.DATABASE_URL || '';
  if (rawUrl) {
    const url = new URL(rawUrl);
    const existingOptions = url.searchParams.get('options') || '';
    if (!/search_path\s*=/i.test(existingOptions)) {
      const mergedOptions = existingOptions
        ? `${existingOptions} -c search_path=public`
        : '-c search_path=public';
      url.searchParams.set('options', mergedOptions);
    }
    if (/pooler\.supabase\.com/i.test(url.hostname)) {
      url.searchParams.set('pgbouncer', 'true');
      url.searchParams.set('connection_limit', '1');
    }
    process.env.DATABASE_URL = url.toString();
  }
} catch {}

// Ensure we reuse the Prisma client across hot reloads in dev
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
