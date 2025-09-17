type SupabaseSessionResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  provider_token?: string | null;
  user?: { id: string };
};

type SupabaseUserResponse = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function normalizeUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export async function exchangeRefreshToken(refreshToken: string): Promise<SupabaseSessionResponse> {
  const supabaseUrlRaw = process.env.SUPABASE_URL || '';
  const supabaseUrl = supabaseUrlRaw ? normalizeUrl(supabaseUrlRaw) : '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_ADMIN_CONFIG_MISSING');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`supabase_refresh_failed:${response.status}:${text}`);
  }

  const data = (await response.json()) as SupabaseSessionResponse;
  if (!data?.access_token) {
    throw new Error('supabase_refresh_missing_token');
  }

  return data;
}

export function getConnectorTokenTTLSeconds(): number {
  const daysEnv = process.env.CONNECTOR_TOKEN_TTL_DAYS;
  const days = daysEnv ? Number(daysEnv) : 30;
  if (!Number.isFinite(days) || days <= 0) return 30 * 24 * 60 * 60;
  return Math.floor(days * 24 * 60 * 60);
}

export async function getSupabaseUserFromAccessToken(accessToken: string): Promise<SupabaseUserResponse> {
  const supabaseUrlRaw = process.env.SUPABASE_URL || '';
  const supabaseUrl = supabaseUrlRaw ? normalizeUrl(supabaseUrlRaw) : '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_ADMIN_CONFIG_MISSING');
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown');
    throw new Error(`supabase_userinfo_failed:${response.status}:${text}`);
  }

  const data = (await response.json()) as SupabaseUserResponse;
  if (!data?.id) {
    throw new Error('supabase_userinfo_missing_id');
  }

  return data;
}
