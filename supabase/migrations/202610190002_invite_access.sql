-- Email-free access: an unguessable invite grants this browser a revocable membership.
begin;
create table if not exists public.workspace_access (
  id smallint primary key check (id=1),
  invite_hash text not null check (invite_hash ~ '^[a-f0-9]{64}$'),
  version bigint not null default 1 check (version>0)
);
create table if not exists public.workspace_members (
  user_id uuid primary key,
  display_name text not null check (display_name in ('이유진','임다혜','윤서영','강주원')),
  invite_version bigint not null,
  enabled boolean not null default true,
  joined_at timestamptz not null default now()
);
alter table public.workspace_access enable row level security;
alter table public.workspace_members enable row level security;
revoke all on public.workspace_access, public.workspace_members from public, anon, authenticated;

create or replace function public.is_graduation_team_member()
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.workspace_members m join public.workspace_access a on a.id=1
    where m.user_id=auth.uid() and m.enabled and m.invite_version=a.version
  );
$$;
revoke all on function public.is_graduation_team_member() from public, anon;
grant execute on function public.is_graduation_team_member() to authenticated;

create or replace function public.get_workspace_identity()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('display_name',m.display_name,'user_id',m.user_id)
  from public.workspace_members m join public.workspace_access a on a.id=1
  where m.user_id=auth.uid() and m.enabled and m.invite_version=a.version;
$$;
revoke all on function public.get_workspace_identity() from public, anon;
grant execute on function public.get_workspace_identity() to authenticated;

create or replace function public.join_workspace(invite_token text, member_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare access_version bigint;
begin
  if auth.uid() is null then raise exception 'Session required' using errcode='42501'; end if;
  if member_name is null or member_name not in ('이유진','임다혜','윤서영','강주원') then
    raise exception 'Choose a team profile' using errcode='22023';
  end if;
  if invite_token is null or invite_token !~ '^[A-Za-z0-9_-]{40,128}$' then
    raise exception 'Invalid invite' using errcode='42501';
  end if;
  select a.version into access_version from public.workspace_access a
  where a.id=1 and a.invite_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') for share;
  if access_version is null then raise exception 'Invalid invite' using errcode='42501'; end if;
  insert into public.workspace_members(user_id,display_name,invite_version,enabled)
  values(auth.uid(),member_name,access_version,true)
  on conflict(user_id) do update set display_name=excluded.display_name,invite_version=excluded.invite_version,enabled=true;
  return public.get_workspace_identity();
end;
$$;
revoke all on function public.join_workspace(text,text) from public, anon;
grant execute on function public.join_workspace(text,text) to authenticated;

create or replace function public.leave_workspace()
returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.workspace_members where user_id=auth.uid();
end;
$$;
revoke all on function public.leave_workspace() from public, anon;
grant execute on function public.leave_workspace() to authenticated;
commit;
