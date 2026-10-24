-- Backfill Auth users created before the profile trigger was installed, then
-- expose a narrowly scoped self-repair function for OAuth/password accounts.
-- Existing profile roles are preserved; new profiles always start as patients.

insert into public.profiles (id, email, full_name, role)
select
  users.id,
  coalesce(users.email, ''),
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', ''),
  'patient'
from auth.users as users
on conflict (id) do nothing;

create or replace function public.ensure_my_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  current_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to create a profile.';
  end if;

  select
    coalesce(users.email, ''),
    coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name', '')
  into current_email, current_name
  from auth.users as users
  where users.id = current_user_id;

  if not found then
    raise exception 'No matching authentication account was found.';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (current_user_id, current_email, current_name, 'patient')
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.ensure_my_profile() from public;
revoke all on function public.ensure_my_profile() from anon;
grant execute on function public.ensure_my_profile() to authenticated;
