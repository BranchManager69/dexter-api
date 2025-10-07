SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;

CREATE TABLE IF NOT EXISTS public.token_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain text NOT NULL DEFAULT 'solana',
  mint_address text NOT NULL,
  symbol text,
  name text,
  status text NOT NULL DEFAULT 'draft',
  metadata_source text NOT NULL DEFAULT 'onchain',
  decimals integer,
  logo_url text,
  coingecko_id text,
  supply numeric(40, 0),
  metadata_uri text,
  metadata_json jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS token_config_chain_mint_unique
  ON public.token_config (chain, mint_address);

CREATE OR REPLACE FUNCTION public.set_token_config_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS token_config_set_updated_at ON public.token_config;

CREATE TRIGGER token_config_set_updated_at
BEFORE UPDATE ON public.token_config
FOR EACH ROW
EXECUTE FUNCTION public.set_token_config_updated_at();
