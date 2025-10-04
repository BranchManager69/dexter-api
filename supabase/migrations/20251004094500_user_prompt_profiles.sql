SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.user_prompt_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  instruction_slug text NOT NULL,
  handoff_slug text NOT NULL,
  guest_slug text NOT NULL,
  tool_slugs jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_user_prompt_profiles_user ON public.user_prompt_profiles (supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_user_prompt_profiles_updated_at ON public.user_prompt_profiles (updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS user_prompt_profiles_default_per_user
ON public.user_prompt_profiles (supabase_user_id)
WHERE is_default;

CREATE OR REPLACE FUNCTION public.set_user_prompt_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_prompt_profiles_set_updated_at ON public.user_prompt_profiles;
CREATE TRIGGER user_prompt_profiles_set_updated_at
BEFORE UPDATE ON public.user_prompt_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_user_prompt_profiles_updated_at();
