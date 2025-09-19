-- Create table to persist subscription status for Supabase users
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
  "id" UUID PRIMARY KEY,
  "supabase_user_id" VARCHAR(255) NOT NULL UNIQUE,
  "tier" VARCHAR(32) NOT NULL DEFAULT 'free',
  "status" VARCHAR(32) NOT NULL DEFAULT 'inactive',
  "current_period_end" TIMESTAMPTZ,
  "last_payment_at" TIMESTAMPTZ,
  "last_payment_reference" TEXT,
  "payment_payload" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "user_subscriptions_supabase_user_id_idx"
  ON "user_subscriptions" ("supabase_user_id");

-- Ensure existing rows update the timestamp automatically via trigger-friendly default
ALTER TABLE "user_subscriptions"
  ALTER COLUMN "payment_payload" SET DEFAULT '{}'::jsonb;
