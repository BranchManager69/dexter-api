-- Prompt module revision history and audit support

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE TABLE IF NOT EXISTS "public"."prompt_module_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "prompt_module_id" uuid NOT NULL REFERENCES "public"."prompt_modules"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "title" text,
  "segment" text NOT NULL,
  "checksum" text,
  "version" integer NOT NULL,
  "notes" text,
  "updated_by" uuid REFERENCES "auth"."users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS "prompt_module_revisions_module_idx" ON "public"."prompt_module_revisions" ("prompt_module_id");
CREATE INDEX IF NOT EXISTS "prompt_module_revisions_slug_idx" ON "public"."prompt_module_revisions" ("slug");
CREATE INDEX IF NOT EXISTS "prompt_module_revisions_created_at_idx" ON "public"."prompt_module_revisions" ("created_at");

COMMENT ON TABLE "public"."prompt_module_revisions" IS 'Historical snapshots of prompt module edits for audit and UI diffs.';
