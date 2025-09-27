import type { Request } from 'express';
import jwt from 'jsonwebtoken';

function normalizeUrl(value: string | undefined): string {
  if (!value) return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function getSupabaseUserIdFromRequest(req: Request): Promise<string | null> {
  try {
    const authHeader = String(req.headers['authorization'] || '');
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!bearerToken) return null;

    const decodedMcp = tryDecodeMcpJwt(bearerToken);
    if (decodedMcp) return decodedMcp;

    const supabaseUrl = normalizeUrl(process.env.SUPABASE_URL);
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    if (!supabaseUrl || !anonKey) return null;

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        apikey: anonKey,
      },
    });

    if (!response.ok) {
      return tryDecodeMcpJwt(bearerToken);
    }

    const data: any = await response.json().catch(() => null);
    const id = data?.id || data?.user?.id;
    return id ? String(id) : tryDecodeMcpJwt(bearerToken);
  } catch {
    const authHeader = String(req.headers['authorization'] || '');
    if (authHeader.startsWith('Bearer ')) {
      return tryDecodeMcpJwt(authHeader.slice(7).trim());
    }
    return null;
  }
}

function tryDecodeMcpJwt(token: string): string | null {
  if (!token) return null;
  const secret = process.env.MCP_JWT_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as Record<string, any>;
    const supabaseId = decoded?.supabase_user_id || (decoded?.sub && decoded.sub !== 'guest' ? decoded.sub : null);
    return supabaseId ? String(supabaseId) : null;
  } catch {
    return null;
  }
}
