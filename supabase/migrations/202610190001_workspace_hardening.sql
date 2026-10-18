-- Preserves existing tables and data. Apply to the intended Supabase project only.
begin;

create table if not exists public.team_members (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  display_name text not null check (display_name in ('이유진','임다혜','윤서영','강주원')),
  enabled boolean not null default true
);
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;

create or replace function public.is_graduation_team_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members m
    where m.enabled and m.email = lower(coalesce(auth.jwt()->>'email',''))
  );
$$;
revoke all on function public.is_graduation_team_member() from public, anon;
grant execute on function public.is_graduation_team_member() to authenticated;

create or replace function public.get_workspace_identity()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('display_name',m.display_name,'user_id',auth.uid())
  from public.team_members m
  where auth.uid() is not null and m.enabled and m.email = lower(coalesce(auth.jwt()->>'email',''));
$$;
revoke all on function public.get_workspace_identity() from public, anon;
grant execute on function public.get_workspace_identity() to authenticated;

create table if not exists public.workspace_state (
  id smallint primary key check (id = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);
alter table public.workspace_state enable row level security;
revoke all on public.workspace_state from anon, authenticated;
grant select on public.workspace_state to authenticated;
drop policy if exists "team reads workspace" on public.workspace_state;
create policy "team reads workspace" on public.workspace_state for select to authenticated using (public.is_graduation_team_member());
drop policy if exists "team initializes workspace" on public.workspace_state;
drop policy if exists "team updates workspace" on public.workspace_state;

create table if not exists public.workspace_backups (
  revision bigint primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  actor_id uuid
);
alter table public.workspace_backups enable row level security;
revoke all on public.workspace_backups from anon, authenticated;
grant select on public.workspace_backups to authenticated;
drop policy if exists "team reads backups" on public.workspace_backups;
create policy "team reads backups" on public.workspace_backups for select to authenticated using (public.is_graduation_team_member());

create or replace function public.workspace_date_valid(value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  return coalesce(value ~ '^\d{4}-\d{2}-\d{2}$' and to_char(value::date,'YYYY-MM-DD') = value,false);
exception when others then return false;
end;
$$;

create or replace function public.workspace_payload_valid(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; entry record; start_day text; end_day text; link text;
begin
  if jsonb_typeof(payload) is distinct from 'object'
    or jsonb_typeof(payload->'tasks') is distinct from 'array'
    or jsonb_typeof(payload->'events') is distinct from 'array'
    or jsonb_typeof(payload->'links') is distinct from 'object'
    or octet_length(payload::text)>1000000 then return false; end if;
  if jsonb_array_length(payload->'tasks')>5000 or jsonb_array_length(payload->'events')>1000 then return false; end if;
  if (select count(*) from jsonb_object_keys(payload->'links'))>100 then return false; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(payload->'tasks') x)<>jsonb_array_length(payload->'tasks')
    or (select count(distinct x->>'id') from jsonb_array_elements(payload->'events') x)<>jsonb_array_length(payload->'events') then return false; end if;
  for item in select value from jsonb_array_elements((payload->'tasks')||(payload->'events')) loop
    if jsonb_typeof(item->'id') is distinct from 'string' or not (item->>'id' ~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$')
      or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title'))=0 then return false; end if;
    if item->>'deletedAt' is not null then perform (item->>'deletedAt')::timestamptz; end if;
    if item ? 'demo' and jsonb_typeof(item->'demo') is distinct from 'boolean' then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'events') loop
    if length(item->>'title')>100 or not public.workspace_date_valid(item->>'date')
      or coalesce(item->>'kind','') not in ('review','final','milestone')
      or coalesce(item->>'project','!') not in ('','리비두비','룸') then return false; end if;
    if item ? 'startDate' or item ? 'endDate' then
      start_day:=item->>'startDate';end_day:=item->>'endDate';
      if start_day is null or end_day is null or not public.workspace_date_valid(start_day) or not public.workspace_date_valid(end_day)
        or start_day>end_day or item->>'date'<>(case when item->>'kind'='review' then start_day else end_day end) then return false; end if;
    end if;
  end loop;
  for item in select value from jsonb_array_elements(payload->'tasks') loop
    if item->>'completedOn' is not null and not public.workspace_date_valid(item->>'completedOn') then return false; end if;
    if length(item->>'title')>300 or coalesce(item->>'project','') not in ('리비두비','룸')
      or jsonb_typeof(item->'done') is distinct from 'boolean' or jsonb_typeof(item->'assignees') is distinct from 'array' then return false; end if;
    if jsonb_array_length(item->'assignees')>20 or exists(select 1 from jsonb_array_elements(item->'assignees') a where jsonb_typeof(a) is distinct from 'string' or length(btrim(a#>>'{}'))=0 or length(a#>>'{}')>100) then return false; end if;
    if item->>'dueMode'='custom' then
      if item->>'due' is null or not public.workspace_date_valid(item->>'due') then return false; end if;
    elsif not exists(select 1 from jsonb_array_elements(payload->'events') e where e->>'id'=item->>'dueMode') then return false;
    end if;
    if item ? 'link' and jsonb_typeof(item->'link') is distinct from 'string' then return false; end if;
    link:=coalesce(item->>'link','');
    if length(link)>4000 or (link<>'' and (link !~ '^https?://[^/[:space:]]+' or link ~ '^https?://[^/]*@' or link ~ '[[:cntrl:]]')) then return false; end if;
  end loop;
  for entry in select * from jsonb_each(payload->'links') loop
    if jsonb_typeof(entry.value) is distinct from 'string' then return false; end if;
    link:=entry.value#>>'{}';
    if length(link)>4000 or (link<>'' and (link !~ '^https?://[^/[:space:]]+' or link ~ '^https?://[^/]*@' or link ~ '[[:cntrl:]]')) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.workspace_date_valid(text), public.workspace_payload_valid(jsonb) from public, anon;
grant execute on function public.workspace_date_valid(text), public.workspace_payload_valid(jsonb) to authenticated;

create or replace function public.backup_workspace_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_backups(revision,payload,actor_id) values(old.revision,old.payload,auth.uid()) on conflict do nothing;
  delete from public.workspace_backups where revision not in (select revision from public.workspace_backups order by revision desc limit 100);
  return new;
end;
$$;
revoke all on function public.backup_workspace_before_update() from public, anon, authenticated;
drop trigger if exists workspace_backup on public.workspace_state;
create trigger workspace_backup before update on public.workspace_state for each row execute function public.backup_workspace_before_update();

create or replace function public.initialize_workspace_state()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_graduation_team_member() then raise exception 'Team access required' using errcode='42501'; end if;
  insert into public.workspace_state(id,payload,revision) values(1,'{"tasks":[],"events":[],"links":{}}'::jsonb,0) on conflict do nothing;
  return true;
end;
$$;
revoke all on function public.initialize_workspace_state() from public, anon;
grant execute on function public.initialize_workspace_state() to authenticated;

create or replace function public.save_workspace_state(expected_revision bigint,next_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_graduation_team_member() then raise exception 'Team access required' using errcode='42501'; end if;
  if expected_revision is null or expected_revision<0 or not public.workspace_payload_valid(next_payload) then
    raise exception 'Invalid workspace payload' using errcode='22023';
  end if;
  update public.workspace_state set payload=next_payload,revision=revision+1,updated_at=now() where id=1 and revision=expected_revision;
  return found;
end;
$$;
revoke all on function public.save_workspace_state(bigint,jsonb) from public, anon;
grant execute on function public.save_workspace_state(bigint,jsonb) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists (
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_state'
  ) then alter publication supabase_realtime add table public.workspace_state; end if;
end $$;
commit;
