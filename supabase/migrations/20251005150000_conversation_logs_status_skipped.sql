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

ALTER TABLE public.conversation_logs
  DROP CONSTRAINT IF EXISTS conversation_logs_status_check;

ALTER TABLE public.conversation_logs
  ADD CONSTRAINT conversation_logs_status_check
  CHECK (status IN ('pending_summary', 'summarized', 'failed', 'skipped'));
