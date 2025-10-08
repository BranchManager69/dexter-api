SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;

ALTER TABLE public.realtime_sessions
  ALTER COLUMN supabase_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_session_id uuid,
  ADD COLUMN IF NOT EXISTS guest_metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.realtime_sessions
  ADD CONSTRAINT realtime_sessions_user_or_guest_ck
    CHECK ((supabase_user_id IS NOT NULL) <> (guest_session_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS realtime_sessions_guest_session_id_idx
  ON public.realtime_sessions (guest_session_id)
  WHERE guest_session_id IS NOT NULL;

-- Maintain existing indexes; column alteration keeps idx_realtime_sessions_user intact.
