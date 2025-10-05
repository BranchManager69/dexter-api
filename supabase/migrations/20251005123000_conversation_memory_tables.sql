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

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_name text,
  display_name text,
  twitter_handle text,
  bio text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT user_profiles_supabase_user_unique UNIQUE (supabase_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user ON public.user_profiles (supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_onboarded_at ON public.user_profiles (onboarded_at);

CREATE OR REPLACE FUNCTION public.set_user_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_set_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_set_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_user_profiles_updated_at();

CREATE TABLE IF NOT EXISTS public.conversation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  ended_at timestamptz,
  duration_ms bigint,
  transcript jsonb,
  tool_calls jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending_summary',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT conversation_logs_status_check CHECK (status IN ('pending_summary', 'summarized', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_conversation_logs_user ON public.conversation_logs (supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_session ON public.conversation_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_status ON public.conversation_logs (status);
CREATE INDEX IF NOT EXISTS idx_conversation_logs_started_at ON public.conversation_logs (started_at DESC);

CREATE OR REPLACE FUNCTION public.set_conversation_logs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_logs_set_updated_at ON public.conversation_logs;
CREATE TRIGGER conversation_logs_set_updated_at
BEFORE UPDATE ON public.conversation_logs
FOR EACH ROW
EXECUTE FUNCTION public.set_conversation_logs_updated_at();

CREATE TABLE IF NOT EXISTS public.user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_log_id uuid REFERENCES public.conversation_logs(id) ON DELETE SET NULL,
  summary text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  follow_ups jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user ON public.user_memories (supabase_user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_created_at ON public.user_memories (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_memories_expires_at ON public.user_memories (expires_at);

COMMENT ON TABLE public.user_profiles IS 'Persistent per-user profile data captured during onboarding and ongoing personalization.';
COMMENT ON TABLE public.conversation_logs IS 'Historical transcripts and tool usage for realtime voice sessions.';
COMMENT ON TABLE public.user_memories IS 'Summaries and extracted facts used to personalize future sessions.';
