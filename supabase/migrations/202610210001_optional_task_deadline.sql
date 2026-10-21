-- Tasks may intentionally have no deadline. Keep malformed non-empty dates invalid.
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
      if jsonb_typeof(item->'due') is distinct from 'string'
        or (item->>'due'<>'' and not public.workspace_date_valid(item->>'due')) then return false; end if;
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

revoke all on function public.workspace_payload_valid(jsonb) from public, anon;
grant execute on function public.workspace_payload_valid(jsonb) to authenticated;

