import prisma from '../prisma.js';

const MAX_MEMORIES = 5;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  if (value && typeof value === 'object' && Array.isArray((value as any).items)) {
    return (value as any).items
      .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }
  return [];
}

export async function buildUserMemoryInstructions(supabaseUserId: string): Promise<string | null> {
  if (!supabaseUserId) return null;

  const [profile, memories] = await Promise.all([
    prisma.user_profiles.findUnique({ where: { supabase_user_id: supabaseUserId } }),
    prisma.user_memories.findMany({
      where: { supabase_user_id: supabaseUserId },
      orderBy: { created_at: 'desc' },
      take: MAX_MEMORIES,
    }),
  ]);

  const lines: string[] = [];

  if (profile?.preferred_name) {
    lines.push(`Preferred name: ${profile.preferred_name}`);
  }
  if (profile?.display_name) {
    lines.push(`Display name: ${profile.display_name}`);
  }
  if (profile?.twitter_handle) {
    lines.push(`Twitter handle: @${profile.twitter_handle.replace(/^@/, '')}`);
  }
  if (profile?.bio) {
    lines.push(`Bio: ${profile.bio}`);
  }

  if (memories.length) {
    lines.push('Recent session notes:');
    memories.forEach((memory) => {
      const ts = toDate(memory.created_at)?.toISOString() ?? 'recently';
      const summary = memory.summary?.trim?.() || 'Summary unavailable';
      lines.push(`• ${ts}: ${summary}`);

      const facts = toStringArray(memory.facts);
      facts.slice(0, 2).forEach((factLine) => {
        lines.push(`  - ${factLine}`);
      });

      const followUps = toStringArray(memory.follow_ups);
      followUps.slice(0, 1).forEach((fLine) => {
        lines.push(`  - Follow-up: ${fLine}`);
      });
    });
  }

  if (!lines.length) {
    return null;
  }

  return `User context:\n${lines.map((line) => (line.startsWith('•') || line.startsWith('  -') ? line : `- ${line}`)).join('\n')}`;
}
