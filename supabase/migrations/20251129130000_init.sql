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
  id SERIAL PRIMARY KEY,
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding extensions.vector(1536),
  metadata JSONB DEFAULT '{}',
  page_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_files (
  chat_id UUID NOT NULL,
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chat_id, file_id)
);

CREATE TABLE chat_metadata (
  chat_id UUID PRIMARY KEY,
  purpose VARCHAR(50),
  language_level VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_file_id ON chunks(file_id);
CREATE INDEX idx_chat_files_chat_id ON chat_files(chat_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on files" ON files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on chunks" ON chunks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on chat_files" ON chat_files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on chat_metadata" ON chat_metadata FOR ALL USING (true) WITH CHECK (true);

COMMENT ON COLUMN files.topic IS '문서의 핵심 주제';
COMMENT ON COLUMN files.context IS '질문 보정용 문서 설명문';
COMMENT ON COLUMN files.suggested_questions IS '추천 질문 목록';

CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding extensions.vector(1536),
  match_count int,
  p_chat_id uuid,
  similarity_threshold float DEFAULT 0.7
)
RETURNS TABLE(content text, page_number int, similarity float)
LANGUAGE sql
AS $$
  SELECT
    c.content,
    c.page_number,
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  FROM chunks c
  JOIN chat_files cf ON c.file_id = cf.file_id
  WHERE cf.chat_id = p_chat_id
    AND 1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) > similarity_threshold
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding extensions.vector(1536),
  match_count int,
  filter jsonb DEFAULT '{}'
)
RETURNS TABLE(
  id int,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
DECLARE
  chat_id_filter uuid;
BEGIN
  chat_id_filter := (filter->>'chat_id')::uuid;

  RETURN QUERY
  SELECT
    c.id,
    c.content,
    c.metadata || jsonb_build_object('id', c.id),
    1 - (c.embedding OPERATOR(extensions.<=>) query_embedding) as similarity
  FROM chunks c
  JOIN chat_files cf ON c.file_id = cf.file_id
  WHERE (chat_id_filter IS NULL OR cf.chat_id = chat_id_filter)
  ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;
