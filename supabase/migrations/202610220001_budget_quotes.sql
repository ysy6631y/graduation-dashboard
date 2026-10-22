begin;
-- Additive extension: no data updates, table resets, membership or RLS changes.
create or replace function public.workspace_budget_valid(budget jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; quote jsonb; setting jsonb; key text;
begin
  if budget is null then return true; end if;
  if jsonb_typeof(budget) is distinct from 'object' or budget->'version' is distinct from '1'::jsonb
    or jsonb_typeof(budget->'settings') is distinct from 'array'
    or jsonb_typeof(budget->'items') is distinct from 'array'
    or jsonb_typeof(budget->'quotes') is distinct from 'array' then return false; end if;
  if jsonb_array_length(budget->'settings')>2 or jsonb_array_length(budget->'items')>1000 or jsonb_array_length(budget->'quotes')>2000 then return false; end if;
  foreach key in array array['settings','items','quotes'] loop
    if (select count(distinct x->>'id') from jsonb_array_elements(budget->key) x) <> jsonb_array_length(budget->key) then return false; end if;
  end loop;
  for setting in select value from jsonb_array_elements(budget->'settings') loop
    if coalesce(setting->>'id','') not in ('LUUM','리비두비')
      or jsonb_typeof(setting->'perPerson') is distinct from 'number' or (setting->>'perPerson')::numeric<0 or (setting->>'perPerson')::numeric>1000000000 or (setting->>'perPerson')::numeric<>trunc((setting->>'perPerson')::numeric)
      or jsonb_typeof(setting->'members') is distinct from 'number' or (setting->>'members')::numeric<1 or (setting->>'members')::numeric>1000 or (setting->>'members')::numeric<>trunc((setting->>'members')::numeric) then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(budget->'items') loop
    if coalesce(item->>'project','') not in ('LUUM','리비두비')
      or jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title') not between 1 and 100
      or item->>'title'<>btrim(regexp_replace(item->>'title', E'[ \\t\\r\\n]+',' ','g'))
      or jsonb_typeof(item->'id') is distinct from 'string' or item->>'id'<>(item->>'project')||':'||lower(item->>'title')
      or jsonb_typeof(item->'decision') is distinct from 'object'
      or coalesce(item->'decision'->>'status','') not in ('inquiry','comparing','confirmed') then return false; end if;
    if item->'decision'->>'status'='confirmed' then
      if jsonb_typeof(item->'decision'->'quoteId') is distinct from 'string' or not exists(
        select 1 from jsonb_array_elements(budget->'quotes') q where q->>'id'=item->'decision'->>'quoteId' and q->>'itemId'=item->>'id' and q->'deletedAt'='null'::jsonb
      ) then return false; end if;
    elsif item->'decision'->'quoteId' is distinct from 'null'::jsonb then return false;
    end if;
  end loop;
  for quote in select value from jsonb_array_elements(budget->'quotes') loop
    if jsonb_typeof(quote->'id') is distinct from 'string' or quote->>'id' !~ '^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$'
      or jsonb_typeof(quote->'itemId') is distinct from 'string' or not exists(select 1 from jsonb_array_elements(budget->'items') i where i->>'id'=quote->>'itemId')
      or jsonb_typeof(quote->'amount') is distinct from 'number' or (quote->>'amount')::numeric<0 or (quote->>'amount')::numeric>1000000000 or (quote->>'amount')::numeric<>trunc((quote->>'amount')::numeric)
      or jsonb_typeof(quote->'vendor') is distinct from 'string' or length(quote->>'vendor')>100
      or jsonb_typeof(quote->'memo') is distinct from 'string' or length(quote->>'memo')>300
      or jsonb_typeof(quote->'url') is distinct from 'string' or length(quote->>'url')>4000 then return false; end if;
    if quote->>'url'<>'' and (quote->>'url' !~ '^https?://[^/[:space:]]+' or quote->>'url' ~ '^https?://[^/]*@' or quote->>'url' ~ '[[:cntrl:]]') then return false; end if;
    if quote->'deletedAt' is distinct from 'null'::jsonb then
      if jsonb_typeof(quote->'deletedAt') is distinct from 'string' then return false; end if;
      perform (quote->>'deletedAt')::timestamptz;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.workspace_budget_valid(jsonb) from public,anon;
grant execute on function public.workspace_budget_valid(jsonb) to authenticated;

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
  return public.workspace_budget_valid(payload->'budget');
exception when others then return false;
end;
$$;

revoke all on function public.workspace_payload_valid(jsonb) from public, anon;
grant execute on function public.workspace_payload_valid(jsonb) to authenticated;

commit;
