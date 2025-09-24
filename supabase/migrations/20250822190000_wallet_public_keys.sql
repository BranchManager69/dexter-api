-- Promote managed wallets public keys to primary identifier
-- and migrate oauth_user_wallets to reference public_key directly.

begin;

-- Add new public-key column and backfill from managed_wallets
alter table public.oauth_user_wallets add column if not exists wallet_public_key varchar(44);
update public.oauth_user_wallets ouw
set wallet_public_key = mw.public_key
from public.managed_wallets mw
where ouw.wallet_public_key is null and mw.id::text = ouw.wallet_id;

alter table public.oauth_user_wallets alter column wallet_public_key set not null;

-- Drop foreign key / unique constraints referencing wallet_id
alter table public.oauth_user_wallets drop constraint if exists oauth_user_wallets_wallet_id_fkey;
alter table public.oauth_user_wallets drop constraint if exists oauth_user_wallets_provider_subject_wallet_id_key;

-- Remove legacy wallet_id column
alter table public.oauth_user_wallets drop column if exists wallet_id;

-- Recreate unique + foreign key constraints on public_key
alter table public.oauth_user_wallets
  add constraint oauth_user_wallets_provider_subject_wallet_public_key_key
  unique (provider, subject, wallet_public_key);
alter table public.oauth_user_wallets
  add constraint oauth_user_wallets_wallet_public_key_fkey
  foreign key (wallet_public_key) references public.managed_wallets(public_key)
  on update cascade on delete cascade;

-- Promote managed_wallets.public_key to primary key
alter table public.managed_wallets drop constraint if exists managed_wallets_pkey;
alter table public.managed_wallets drop constraint if exists managed_wallets_public_key_key;
alter table public.managed_wallets drop column if exists id;
alter table public.managed_wallets add constraint managed_wallets_pkey primary key (public_key);

commit;
