DROP FUNCTION IF EXISTS search_chunks;

DROP INDEX IF EXISTS idx_chat_files_chat_id;
DROP POLICY IF EXISTS "Allow all on chat_files" ON chat_files;
DROP TABLE IF EXISTS chat_files;

CREATE OR REPLACE FUNCTION match_documents(
  query_embedding extensions.vector(1536),
  match_count int DEFAULT 5,
  filter jsonb DEFAULT '{}'
)
RETURNS TABLE(
  id text,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql
AS $$
  SELECT
    c.id,
    c.content,
    jsonb_build_object(
      'page_numbers', c.page_numbers,
      'file_id', c.file_id
    ) as metadata,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  FROM chunks c
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;
