import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main(email) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  });

  if (error) {
    console.error('Failed to list users:', error.message);
    process.exit(1);
  }

  const user = data.users?.find((u) => u.email === email);
  if (!user) {
    console.error('User not found:', email);
    process.exit(1);
  }

  const rolesArray = Array.isArray(user.app_metadata?.roles)
    ? user.app_metadata.roles.map((role) => String(role))
    : [];

  if (!rolesArray.includes('pro')) {
    rolesArray.push('pro');
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata || {}),
      roles: rolesArray,
    },
  });

  if (updateError) {
    console.error('Failed to update user roles:', updateError.message);
    process.exit(1);
  }

  console.log(`Updated ${email} roles =>`, rolesArray.join(','));
}

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/mark-user-pro.mjs <email>');
  process.exit(1);
}

main(email).catch((err) => {
  console.error(err);
  process.exit(1);
});
