-- Initial Luma schema. Apply in the Supabase SQL editor or with the Supabase CLI.
-- All browser access is governed by RLS. Never place a service-role key in the frontend.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'patient' check (role in ('patient', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    'patient'
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.health_models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  slug text not null unique,
  name text not null,
  outcome text not null,
  model_type text not null default 'tabular_classification',
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'paused')),
  required_attributes jsonb not null default '[]'::jsonb check (jsonb_typeof(required_attributes) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists health_models_touch_updated_at on public.health_models;
create trigger health_models_touch_updated_at before update on public.health_models
  for each row execute procedure public.touch_updated_at();

create table if not exists public.model_versions (
  id uuid primary key default gen_random_uuid(),
  model_id uuid not null references public.health_models(id) on delete cascade,
  version text not null,
  storage_path text,
  status text not null default 'draft' check (status in ('draft', 'validated', 'approved', 'retired')),
  validation_metrics jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  unique (model_id, version)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  byte_size bigint not null check (byte_size >= 0),
  processing_status text not null default 'stored' check (processing_status in ('stored', 'queued', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  model_id uuid references public.health_models(id) on delete set null,
  model_name text not null,
  model_version text,
  status text not null default 'submitted' check (status in ('submitted', 'processing', 'completed', 'failed')),
  risk_band text,
  outcome_probability numeric check (outcome_probability between 0 and 1),
  submitted_attributes jsonb not null default '{}'::jsonb,
  explanation jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.training_runs (
  id uuid primary key default gen_random_uuid(),
  model_id uuid references public.health_models(id) on delete set null,
  model_name text not null,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  dataset_path text,
  configuration jsonb not null default '{}'::jsonb,
  metrics jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  error_summary text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  model_name text,
  status text not null default 'recorded',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists documents_owner_created_idx on public.documents (owner_id, created_at desc);
create index if not exists assessments_owner_created_idx on public.assessments (owner_id, created_at desc);
create index if not exists model_versions_model_created_idx on public.model_versions (model_id, created_at desc);
create index if not exists training_runs_created_idx on public.training_runs (created_at desc);
create index if not exists audit_events_created_idx on public.audit_events (created_at desc);

alter table public.profiles enable row level security;
alter table public.health_models enable row level security;
alter table public.model_versions enable row level security;
alter table public.documents enable row level security;
alter table public.assessments enable row level security;
alter table public.training_runs enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "Users read own profile; admins read all" on public.profiles;
create policy "Users read own profile; admins read all" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Users update own profile name; admins manage profiles" on public.profiles;
create policy "Users update own profile name; admins manage profiles" on public.profiles
  for update to authenticated using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "Admins manage models; patients read published models" on public.health_models;
create policy "Admins manage models; patients read published models" on public.health_models
  for all to authenticated
  using ((select public.is_admin()) or status = 'published')
  with check ((select public.is_admin()));

drop policy if exists "Admins manage model versions; patients read published versions" on public.model_versions;
create policy "Admins manage model versions; patients read published versions" on public.model_versions
  for all to authenticated
  using (
    (select public.is_admin()) or exists (
      select 1 from public.health_models m where m.id = model_id and m.status = 'published'
    )
  )
  with check ((select public.is_admin()));

drop policy if exists "Users read own documents; admins read all" on public.documents;
drop policy if exists "Users read own documents" on public.documents;
create policy "Users read own documents" on public.documents
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Users add own documents" on public.documents;
create policy "Users add own documents" on public.documents
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Users update own documents" on public.documents;
create policy "Users update own documents" on public.documents
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "Users delete own documents" on public.documents;
create policy "Users delete own documents" on public.documents
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "Patients read own assessments; admins read all" on public.assessments;
create policy "Patients read own assessments; admins read all" on public.assessments
  for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists "Patients submit own assessments" on public.assessments;
create policy "Patients submit own assessments" on public.assessments
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "Admins manage training runs" on public.training_runs;
create policy "Admins manage training runs" on public.training_runs
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins read audit events" on public.audit_events;
create policy "Admins read audit events" on public.audit_events
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admins record audit events" on public.audit_events;
create policy "Admins record audit events" on public.audit_events
  for insert to authenticated with check ((select public.is_admin()) and actor_id = (select auth.uid()));

grant select, insert, update, delete on public.health_models, public.model_versions, public.documents, public.training_runs to authenticated;
grant select, insert on public.assessments to authenticated;
grant select, insert on public.audit_events to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('patient-documents', 'patient-documents', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/csv', 'text/plain']),
  ('model-artifacts', 'model-artifacts', false, 262144000, null),
  ('training-datasets', 'training-datasets', false, 1073741824, array['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do update set public = false;

drop policy if exists "Patients access their document objects" on storage.objects;
create policy "Patients access their document objects" on storage.objects
  for all to authenticated
  using (bucket_id = 'patient-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'patient-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Admins manage model artifacts" on storage.objects;
create policy "Admins manage model artifacts" on storage.objects
  for all to authenticated
  using (bucket_id = 'model-artifacts' and (select public.is_admin()))
  with check (bucket_id = 'model-artifacts' and (select public.is_admin()));

drop policy if exists "Admins manage training datasets" on storage.objects;
create policy "Admins manage training datasets" on storage.objects
  for all to authenticated
  using (bucket_id = 'training-datasets' and (select public.is_admin()))
  with check (bucket_id = 'training-datasets' and (select public.is_admin()));
