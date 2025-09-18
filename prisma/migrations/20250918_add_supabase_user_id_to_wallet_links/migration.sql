-- Add optional Supabase user reference to oauth_user_wallets to match Prisma schema
ALTER TABLE "oauth_user_wallets"
  ADD COLUMN IF NOT EXISTS "supabase_user_id" VARCHAR(255);

CREATE INDEX IF NOT EXISTS "oauth_user_wallets_supabase_user_id_idx"
  ON "oauth_user_wallets" ("supabase_user_id");
