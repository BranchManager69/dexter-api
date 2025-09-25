-- Add optional Supabase user reference to oauth_user_wallets to match Prisma schema
ALTER TABLE IF EXISTS "oauth_user_wallets"
  ADD COLUMN IF NOT EXISTS "supabase_user_id" VARCHAR(255);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'public' AND tablename = 'oauth_user_wallets'
  ) THEN
    CREATE INDEX IF NOT EXISTS "oauth_user_wallets_supabase_user_id_idx"
      ON "oauth_user_wallets" ("supabase_user_id");
  END IF;
END
$$;
