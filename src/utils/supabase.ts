import type { Request } from 'express';

function normalizeUrl(value: string | undefined): string {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function getSupabaseUserIdFromRequest(req: Request): Promise<string | null> {
  try {
    const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL);
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    const authHeader = String(req.headers['authorization'] || '');

    if (!supabaseUrl || !anonKey || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.slice(7).trim();
    if (!token) return null;

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        apikey: anonKey,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json().catch(() => null);
    const id = data?.id || data?.user?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}
