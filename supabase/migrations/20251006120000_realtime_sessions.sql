-- Add realtime session tracking for voice broadcasts
create table if not exists public.realtime_sessions (
  session_id text primary key,
  supabase_user_id uuid not null references auth.users(id) on delete cascade,
  client_secret text not null,
  model text not null,
  voice text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  expires_at timestamptz not null,
  usage_summary jsonb not null default '{}'::jsonb
);

create index if not exists idx_realtime_sessions_user on public.realtime_sessions (supabase_user_id);
create index if not exists idx_realtime_sessions_expires_at on public.realtime_sessions (expires_at);
