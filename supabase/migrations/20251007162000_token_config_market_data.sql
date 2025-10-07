SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;

ALTER TABLE public.token_config
  ADD COLUMN IF NOT EXISTS price_usd numeric(38, 18),
  ADD COLUMN IF NOT EXISTS liquidity_usd numeric(38, 18),
  ADD COLUMN IF NOT EXISTS volume_24h_usd numeric(38, 18),
  ADD COLUMN IF NOT EXISTS price_change_24h numeric(20, 4),
  ADD COLUMN IF NOT EXISTS txns_24h_buys integer,
  ADD COLUMN IF NOT EXISTS txns_24h_sells integer,
  ADD COLUMN IF NOT EXISTS fdv numeric(38, 2),
  ADD COLUMN IF NOT EXISTS market_cap numeric(38, 2),
  ADD COLUMN IF NOT EXISTS market_data_json jsonb,
  ADD COLUMN IF NOT EXISTS market_data_last_refreshed_at timestamptz;
