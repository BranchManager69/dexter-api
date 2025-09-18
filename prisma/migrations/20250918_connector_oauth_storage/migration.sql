-- MCP connector OAuth state persistence
CREATE TABLE IF NOT EXISTS "connector_oauth_requests" (
  "id" VARCHAR(64) PRIMARY KEY,
  "client_id" VARCHAR(255) NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "state" TEXT,
  "code_challenge" VARCHAR(512),
  "code_challenge_method" VARCHAR(32),
  "scope" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "connector_oauth_requests_created_at_idx"
  ON "connector_oauth_requests" ("created_at");

CREATE TABLE IF NOT EXISTS "connector_oauth_codes" (
  "code" VARCHAR(128) PRIMARY KEY,
  "client_id" VARCHAR(255) NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "state" TEXT,
  "code_challenge" VARCHAR(512),
  "code_challenge_method" VARCHAR(32),
  "scope" TEXT,
  "refresh_token" TEXT NOT NULL,
  "access_token" TEXT NOT NULL,
  "supabase_user_id" VARCHAR(255),
  "expires_in" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "connector_oauth_codes_created_at_idx"
  ON "connector_oauth_codes" ("created_at");
