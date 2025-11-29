CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash VARCHAR(64) UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  topic TEXT,
  context TEXT,
  suggested_questions JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  page_numbers INT[] NOT NULL,
  embedding extensions.vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_files (
  chat_id UUID NOT NULL,
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chat_id, file_id)
);

CREATE INDEX idx_chunks_file_id ON chunks(file_id);
CREATE INDEX idx_chat_files_chat_id ON chat_files(chat_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on files" ON files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on chunks" ON chunks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on chat_files" ON chat_files FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding extensions.vector(1536),
  match_count int,
  p_chat_id uuid,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE(
  id text,
  content text,
  page_numbers int[],
  similarity float
)
LANGUAGE sql
AS $$
  SELECT
    c.id,
    c.content,
    c.page_numbers,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  FROM chunks c
  JOIN chat_files cf ON c.file_id = cf.file_id
  WHERE cf.chat_id = p_chat_id
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) > similarity_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;
