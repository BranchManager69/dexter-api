SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;

CREATE OR REPLACE FUNCTION public.assign_wallet_to_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_wallet public.managed_wallets%ROWTYPE;
  next_wallet public.managed_wallets%ROWTYPE;
BEGIN
  -- Skip if this user already has an assigned wallet (defensive guard for retries).
  SELECT *
  INTO existing_wallet
  FROM public.managed_wallets
  WHERE assigned_supabase_user_id = NEW.id::text
    AND status = 'assigned'
  LIMIT 1;

  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Claim the oldest available wallet using FOR UPDATE SKIP LOCKED to avoid contention.
  SELECT *
  INTO next_wallet
  FROM public.managed_wallets
  WHERE status = 'available'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RAISE WARNING 'assign_wallet_to_new_user: no available managed_wallets for user %', NEW.id;
    RETURN NEW;
  END IF;

  UPDATE public.managed_wallets
  SET status = 'assigned',
      assigned_supabase_user_id = NEW.id::text,
      assigned_email = NEW.email,
      assigned_provider = 'supabase',
      assigned_subject = NEW.id::text,
      assigned_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  WHERE public_key = next_wallet.public_key;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_wallet_on_auth_users_insert ON auth.users;

CREATE TRIGGER assign_wallet_on_auth_users_insert
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.assign_wallet_to_new_user();
