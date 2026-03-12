-- migrate:up
create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null unique,
  source text,
  campaign text,
  page text,
  signup_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists waitlist_signups_email_normalized_idx
  on public.waitlist_signups (email_normalized);

-- migrate:down
drop table if exists public.waitlist_signups;
