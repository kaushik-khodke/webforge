-- Search across every extracted chunk without transferring a patient's
-- entire document library to the API server.
create index if not exists document_chunks_search_idx on public.document_chunks
  using gin (to_tsvector('english', content));

create or replace function public.search_my_document_chunks(search_terms text, result_limit integer default 8)
returns table (document_id uuid, chunk_index integer, content text)
language sql stable security invoker
set search_path = ''
as $$
  select c.document_id, c.chunk_index, c.content
  from public.document_chunks c
  where c.owner_id = (select auth.uid())
    and to_tsvector('english', c.content) @@ websearch_to_tsquery('english', search_terms)
  order by ts_rank(to_tsvector('english', c.content), websearch_to_tsquery('english', search_terms)) desc,
    c.created_at desc
  limit least(greatest(result_limit, 1), 20);
$$;

revoke all on function public.search_my_document_chunks(text, integer) from public, anon;
grant execute on function public.search_my_document_chunks(text, integer) to authenticated;
notify pgrst, 'reload schema';
