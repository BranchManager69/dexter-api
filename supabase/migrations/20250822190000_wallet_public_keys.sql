-- Promote managed wallets public keys to primary identifier
-- Guarded to skip if legacy oauth_user_wallets table no longer exists.

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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'oauth_user_wallets'
  ) THEN
    EXECUTE 'ALTER TABLE public.oauth_user_wallets ADD COLUMN IF NOT EXISTS wallet_public_key varchar(44)';
    EXECUTE 'UPDATE public.oauth_user_wallets ouw
             SET wallet_public_key = mw.public_key
             FROM public.managed_wallets mw
             WHERE ouw.wallet_public_key IS NULL AND mw.id::text = ouw.wallet_id';
    EXECUTE 'ALTER TABLE public.oauth_user_wallets ALTER COLUMN wallet_public_key SET NOT NULL';
    EXECUTE 'ALTER TABLE public.oauth_user_wallets DROP CONSTRAINT IF EXISTS oauth_user_wallets_wallet_id_fkey';
    EXECUTE 'ALTER TABLE public.oauth_user_wallets DROP CONSTRAINT IF EXISTS oauth_user_wallets_provider_subject_wallet_id_key';
    EXECUTE 'ALTER TABLE public.oauth_user_wallets DROP COLUMN IF EXISTS wallet_id';
    EXECUTE 'ALTER TABLE public.oauth_user_wallets
             ADD CONSTRAINT oauth_user_wallets_provider_subject_wallet_public_key_key
             UNIQUE (provider, subject, wallet_public_key)';
    EXECUTE 'ALTER TABLE public.oauth_user_wallets
             ADD CONSTRAINT oauth_user_wallets_wallet_public_key_fkey
             FOREIGN KEY (wallet_public_key)
             REFERENCES public.managed_wallets(public_key)
             ON UPDATE CASCADE ON DELETE CASCADE';
  ELSE
    RAISE NOTICE 'Skipping oauth_user_wallets migration; table not present.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'managed_wallets'
  ) THEN
    EXECUTE 'ALTER TABLE public.managed_wallets DROP CONSTRAINT IF EXISTS managed_wallets_pkey';
    EXECUTE 'ALTER TABLE public.managed_wallets DROP CONSTRAINT IF EXISTS managed_wallets_public_key_key';
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'managed_wallets'
        AND column_name = 'id'
    ) THEN
      EXECUTE 'ALTER TABLE public.managed_wallets DROP COLUMN IF EXISTS id';
    END IF;
    EXECUTE 'ALTER TABLE public.managed_wallets ADD CONSTRAINT managed_wallets_pkey PRIMARY KEY (public_key)';
  ELSE
    RAISE NOTICE 'Skipping managed_wallets primary key migration; table not present.';
  END IF;
END $$;
