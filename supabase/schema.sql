-- Run once in Supabase Dashboard → SQL Editor.
-- Add the four real team emails to team_members before inviting them.

create table if not exists public.team_members (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  display_name text not null check (display_name in ('이유진', '임다혜', '강주원', '윤서영')),
  enabled boolean not null default true
);

alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;

create or replace function public.is_graduation_team_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members as member
    where member.enabled
      and member.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_graduation_team_member() from public, anon;
grant execute on function public.is_graduation_team_member() to authenticated;

create table if not exists public.workspace_state (
  id smallint primary key check (id = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;
revoke all on public.workspace_state from anon;
grant select, insert, update on public.workspace_state to authenticated;

drop policy if exists "team reads workspace" on public.workspace_state;
create policy "team reads workspace"
  on public.workspace_state for select to authenticated
  using (public.is_graduation_team_member());

drop policy if exists "team initializes workspace" on public.workspace_state;
create policy "team initializes workspace"
  on public.workspace_state for insert to authenticated
  with check (id = 1 and public.is_graduation_team_member());

drop policy if exists "team updates workspace" on public.workspace_state;
create policy "team updates workspace"
  on public.workspace_state for update to authenticated
  using (public.is_graduation_team_member())
  with check (id = 1 and public.is_graduation_team_member());

create or replace function public.save_workspace_state(
  expected_revision bigint,
  next_payload jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(next_payload) <> 'object' then
    raise exception 'Workspace payload must be a JSON object';
  end if;

  update public.workspace_state
     set payload = next_payload,
         revision = revision + 1,
         updated_at = now()
   where id = 1
     and revision = expected_revision;

  return found;
end;
$$;

revoke all on function public.save_workspace_state(bigint, jsonb) from public, anon;
grant execute on function public.save_workspace_state(bigint, jsonb) to authenticated;

-- Enable live refreshes for the shared row (safe to run more than once).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_state'
  ) then
    execute 'alter publication supabase_realtime add table public.workspace_state';
  end if;
end;
$$;

-- After replacing these sample values with the four actual addresses, run:
-- insert into public.team_members (email, display_name) values
--   ('member1@your-domain.com', '이유진'),
--   ('member2@your-domain.com', '임다혜'),
--   ('member3@your-domain.com', '강주원'),
--   ('member4@your-domain.com', '윤서영');
