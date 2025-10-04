#!/usr/bin/env ts-node

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main(email: string) {
  const { data: user, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 100,
    filter: `email.eq.${email}`,
  });

  if (error) {
    console.error('Failed to lookup user:', error.message);
    process.exit(1);
  }

  const match = user.users?.find((u) => u.email === email);
  if (!match) {
    console.error('User not found:', email);
    process.exit(1);
  }

  const roles = Array.isArray(match.app_metadata?.roles)
    ? [...new Set([...(match.app_metadata.roles as any[]).map(String), 'pro'])]
    : ['pro'];

  const { error: updateError } = await supabase.auth.admin.updateUserById(match.id, {
    app_metadata: { ...(match.app_metadata || {}), roles },
  });

  if (updateError) {
    console.error('Failed to update user roles:', updateError.message);
    process.exit(1);
  }

  console.log(`Updated ${email} roles =>`, roles.join(','));
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: mark-user-pro.ts <email>');
  process.exit(1);
}

main(email).catch((err) => {
  console.error(err);
  process.exit(1);
});
