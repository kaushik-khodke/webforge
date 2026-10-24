-- Patient-owned extracted text and conversation history.
-- A document is readable only by its owner; extracted chunks inherit that scope.

alter table public.health_models
  add column if not exists input_modality text not null default 'tabular'
    check (input_modality in ('tabular', 'image', 'text', 'mixed'));
alter table public.health_models
  add column if not exists tool_description text not null default '';

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index if not exists document_chunks_owner_idx on public.document_chunks (owner_id, document_id);
alter table public.document_chunks enable row level security;

drop policy if exists "Patients read own document text" on public.document_chunks;
create policy "Patients read own document text" on public.document_chunks
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Patients add text for own documents" on public.document_chunks;
create policy "Patients add text for own documents" on public.document_chunks
  for insert to authenticated with check (
    owner_id = (select auth.uid()) and exists (
      select 1 from public.documents d
      where d.id = document_id and d.owner_id = (select auth.uid())
    )
  );
drop policy if exists "Patients replace own document text" on public.document_chunks;
create policy "Patients replace own document text" on public.document_chunks
  for delete to authenticated using (owner_id = (select auth.uid()));

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 20000),
  image_document_id uuid references public.documents(id) on delete set null,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  model_runs jsonb not null default '[]'::jsonb check (jsonb_typeof(model_runs) = 'array'),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_owner_created_idx on public.chat_messages (owner_id, created_at desc);
alter table public.chat_messages enable row level security;

drop policy if exists "Patients read own chat" on public.chat_messages;
create policy "Patients read own chat" on public.chat_messages
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists "Patients add own chat" on public.chat_messages;
create policy "Patients add own chat" on public.chat_messages
  for insert to authenticated with check (
    owner_id = (select auth.uid()) and (
      image_document_id is null or exists (
        select 1 from public.documents d
        where d.id = image_document_id and d.owner_id = (select auth.uid())
      )
    )
  );

grant select, insert, delete on public.document_chunks to authenticated;
grant select, insert on public.chat_messages to authenticated;
notify pgrst, 'reload schema';
