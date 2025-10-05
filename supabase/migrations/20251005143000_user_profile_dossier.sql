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

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS dossier jsonb;

COMMENT ON COLUMN public.user_profiles.dossier IS 'Per-user dossier JSON summarizing long-lived context. Expected keys: identity {preferredName, email, walletAddress, otherIds}, holdings [{symbol, mintAddress, usdValue, marketCapUsd, portfolioWeightPct}], preferences { … }, stats {firstConversationAt, lastConversationAt, memoryCount}}';
