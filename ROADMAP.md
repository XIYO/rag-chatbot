# AI Agent RAG 챗봇 프로젝트 로드맵

## 과제 개요

- **목표**: PDF 문서를 참조하는 RAG 기반 에이전트 챗봇 개발
- **마감**: 2024.12.01 (월) 12:00
- **제출**: GitHub 링크

## 기술 스택

| 레이어 | 기술 | 선택 이유 |
|--------|------|-----------|
| 프론트엔드 | SvelteKit | 빠른 개발, SSR 지원, API Routes 통합 |
| 백엔드 | SvelteKit API Routes + Bun | 단일 프로젝트 구조, 빠른 런타임 |
| RAG 프레임워크 | LangChain.js | JS 생태계, 텍스트 분할/체인 도구 |
| 워크플로우 | LangGraph.js | 조건 분기 파이프라인, 과제 요구사항 |
| DB + VectorDB | Supabase (PostgreSQL + pgvector) | 호스팅 포함, 설정 간편, 무료 티어 |
| 임베딩 | OpenAI text-embedding-3-small | 다국어 지원, 단일 API |
| LLM | OpenAI GPT-4o | 고성능, OCR 겸용 (Vision) |

### 언어 선택 이유 (JavaScript/TypeScript)

1. SvelteKit으로 프론트/백엔드 통합 개발 가능
2. LangChain.js, LangGraph.js 공식 지원
3. Bun 런타임으로 빠른 실행 속도
4. 풀스택 단일 언어로 개발 효율성

### LLM 선택 이유 (OpenAI GPT-4o)

1. 고성능 추론 능력
2. Vision 기능으로 OCR 대체 가능
3. 다국어 응답 품질 우수
4. 안정적인 API

## 기능 요구사항

### 필수 기능 (과제)

- [x] LangChain/LangGraph 사용
- [x] Retriever 구현 (벡터 검색으로 관련 청크 찾기)
- [x] VectorDB 사용 (Supabase + pgvector)
- [x] Prompt Engineering

### 구현 기능

1. **세션 기반 관리 (로그인 없음)**
   - 클라이언트에서 UUID 생성하여 세션 ID로 사용
   - 세션별 독립적인 문서 컨텍스트
   - localStorage에 세션 ID 저장

2. **사용자 메타데이터 설정**
   - 사용 목적: 학습용, 업무용, 연구용
   - 언어 수준: 초급, 중급, 전문가
   - 프롬프트에 반영하여 맞춤 답변

3. **다중 파일 지원**
   - 텍스트 PDF
   - 이미지 PDF (OCR via GPT-4o Vision)
   - TXT 파일

4. **파일 중복 검사 (해시 기반)**
   - SHA-256 해시로 파일 식별
   - 동일 파일 재업로드 시 임베딩 스킵
   - 기존 임베딩 재사용하여 세션에 연결만 추가

5. **Query Rewriting (질문 품질 개선)**
   - 모호한 질문을 LLM이 구체화
   - 검색 정확도 향상

6. **유사도 임계값**
   - 낮은 유사도 결과 제외
   - 관련 없는 청크 필터링

## 아키텍처

### 전체 흐름

```text
[클라이언트]
세션 ID 생성 (UUID)
    |
    v
[SvelteKit 프론트엔드]
    |
    v
[SvelteKit API Routes]
    |
    +-- /api/upload --> [문서 처리 파이프라인 (LangGraph)]
    |                         |
    |                         v
    |                   [Supabase]
    |
    +-- /api/chat ----> [채팅 파이프라인 (LangChain)]
                             |
                             +-- Query Rewriting (질문 개선)
                             +-- 질문 임베딩 (OpenAI)
                             +-- 벡터 검색 (Supabase RPC)
                             +-- 유사도 필터링
                             +-- 프롬프트 구성
                             +-- LLM 응답 (GPT-4o, temperature: 0)
```

### 파일 업로드 흐름

```text
[파일 업로드]
     |
     v
[SHA-256 해시 계산]
     |
     v
[해시로 DB 조회] ---> 존재함 ---> [chat_files 연결만 추가]
     |                                    |
     v                                    v
  존재 안 함                           [완료]
     |
     v
[LangGraph 파이프라인]
     |
     +-- 파일 타입 감지
     |
     +-- TXT -----------> [텍스트 읽기]
     |
     +-- PDF (텍스트) --> [텍스트 추출]
     |
     +-- PDF (이미지) --> [GPT-4o OCR]
                               |
                               v
                    [청크 분할 (LangChain)]
                               |
                               v
                    [임베딩 (OpenAI)]
                               |
                               v
                    [Supabase 저장]
                               |
                               v
                    [chat_files 연결]
```

### 채팅 파이프라인 (LangChain)

```text
[질문 입력]
     |
     v
[Query Rewriting] (선택적)
LLM이 질문을 구체화
"AI란?" -> "AI Agent의 정의와 특징은?"
     |
     v
[질문 임베딩 (OpenAI)]
     |
     v
[Supabase RPC 벡터 검색]
     |
     v
[유사도 필터링]
similarity > 0.7 인 것만 사용
     |
     v
[관련 청크 반환 (Top 5)]
     |
     v
[프롬프트 구성]
- 시스템: 역할 + 규칙
- 메타데이터: 사용 목적, 언어 수준
- 컨텍스트: 검색된 청크
- 질문: 사용자 입력
     |
     v
[GPT-4o 응답 생성]
- temperature: 0 (문서 기반 정확한 답변)
     |
     v
[답변 반환]
```

## 데이터베이스 (Supabase)

### 테이블 구조

```sql
-- pgvector 확장
CREATE EXTENSION IF NOT EXISTS vector;

-- 파일 테이블
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hash VARCHAR(64) UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  file_type VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 청크 테이블
CREATE TABLE chunks (
  id SERIAL PRIMARY KEY,
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536),
  page_number INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 세션-파일 연결 테이블
CREATE TABLE chat_files (
  chat_id UUID NOT NULL,
  file_id UUID REFERENCES files(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (chat_id, file_id)
);

-- 세션 메타데이터 테이블
CREATE TABLE chat_metadata (
  chat_id UUID PRIMARY KEY,
  purpose VARCHAR(50),
  language_level VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_chunks_file_id ON chunks(file_id);
CREATE INDEX idx_chat_files_chat_id ON chat_files(chat_id);
CREATE INDEX idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops);
```

### 벡터 검색 RPC 함수

```sql
CREATE OR REPLACE FUNCTION search_chunks(
  query_embedding vector(1536),
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
    1 - (c.embedding <=> query_embedding) as similarity
  FROM chunks c
  JOIN chat_files cf ON c.file_id = cf.file_id
  WHERE cf.chat_id = p_chat_id
    AND 1 - (c.embedding <=> query_embedding) > similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

### 핵심 코드

#### 파일 해시 및 중복 체크

```typescript
import { createHash } from 'crypto'

function getFileHash(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function uploadFile(sessionId: string, file: Buffer, filename: string) {
  const hash = getFileHash(file)

  // 해시로 기존 파일 확인
  const { data: existing } = await supabase
    .from('files')
    .select('id')
    .eq('hash', hash)
    .single()

  if (existing) {
    // 이미 존재 -> 연결만 추가
    await supabase.from('chat_files').insert({
      chat_id: sessionId,
      file_id: existing.id
    })
    return { status: 'linked', fileId: existing.id }
  }

  // 새 파일 -> 임베딩 후 저장
  const fileId = await processAndSave(file, hash, filename)
  await supabase.from('chat_files').insert({
    chat_id: sessionId,
    file_id: fileId
  })
  return { status: 'uploaded', fileId }
}
```

#### 세션 ID 생성 (클라이언트)

```typescript
function getOrCreateSessionId() {
  let sessionId = localStorage.getItem('sessionId')
  if (!sessionId) {
    sessionId = crypto.randomUUID()
    localStorage.setItem('sessionId', sessionId)
  }
  return sessionId
}
```

#### Query Rewriting

```typescript
async function rewriteQuery(query: string) {
  const response = await llm.invoke(`
    다음 질문을 문서 검색에 적합하게 구체화해주세요.
    짧거나 모호한 질문이면 더 명확하게 바꿔주세요.
    이미 구체적이면 그대로 반환하세요.

    원래 질문: ${query}
    개선된 질문:
  `)
  return response.content
}
```

#### 채팅 (LangChain)

```typescript
import { ChatOpenAI } from '@langchain/openai'

const llm = new ChatOpenAI({
  model: 'gpt-4o',
  temperature: 0  // 문서 기반 정확한 답변
})

async function chat(sessionId: string, question: string, metadata: Metadata) {
  // 1. 질문 개선
  const improvedQuery = await rewriteQuery(question)

  // 2. 질문 임베딩
  const queryVector = await embedText(improvedQuery)

  // 3. 벡터 검색
  const { data: chunks } = await supabase.rpc('search_chunks', {
    query_embedding: queryVector,
    match_count: 5,
    p_chat_id: sessionId,
    similarity_threshold: 0.7
  })

  // 4. 결과 없으면 안내
  if (!chunks || chunks.length === 0) {
    return '관련 문서를 찾을 수 없습니다.'
  }

  // 5. 프롬프트 구성
  const prompt = buildPrompt(chunks, question, metadata)

  // 6. LLM 응답
  const response = await llm.invoke(prompt)
  return response.content
}
```

## 프롬프트 엔지니어링

### 시스템 프롬프트

```text
당신은 문서 기반 AI 어시스턴트입니다.

[규칙]
1. 제공된 문서 내용만을 기반으로 답변하세요.
2. 문서에 없는 내용은 "문서에서 해당 정보를 찾을 수 없습니다"라고 답하세요.
3. 답변은 한국어로 작성하세요.
4. 인용 시 문서의 어느 부분인지 명시하세요.
5. 추측하거나 지어내지 마세요.

[사용자 정보]
- 사용 목적: {purpose}
- 언어 수준: {language_level}

[언어 수준별 지침]
- 초급: 쉬운 용어로 설명하고, 전문 용어는 부연 설명을 추가하세요.
- 중급: 적절한 전문 용어를 사용하되, 필요시 설명을 추가하세요.
- 전문가: 전문 용어를 자유롭게 사용하고, 심층적인 분석을 제공하세요.
```

### 사용자 프롬프트

```text
[참고 문서]
{retrieved_chunks}

[질문]
{user_question}
```

## 프로젝트 구조

```text
src/
+-- routes/
|   +-- +page.svelte                 # 메인 (메타데이터 설정 + 파일 업로드)
|   +-- chat/
|   |   +-- +page.svelte             # 채팅 화면
|   +-- api/
|       +-- chat/
|       |   +-- +server.ts           # 채팅 API
|       +-- upload/
|       |   +-- +server.ts           # 파일 업로드 API
|       +-- metadata/
|           +-- +server.ts           # 메타데이터 API
+-- lib/
|   +-- supabase.ts                  # Supabase 클라이언트
|   +-- openai.ts                    # OpenAI 클라이언트
|   +-- pipelines/
|   |   +-- document.ts              # 문서 처리 LangGraph
|   |   +-- chat.ts                  # 채팅 LangChain
|   +-- processors/
|   |   +-- pdf.ts                   # PDF 텍스트 추출
|   |   +-- ocr.ts                   # GPT-4o Vision OCR
|   |   +-- text.ts                  # TXT 처리
|   +-- utils/
|   |   +-- hash.ts                  # 파일 해시
|   |   +-- session.ts               # 세션 관리
|   +-- prompts/
|       +-- templates.ts             # 프롬프트 템플릿
+-- app.d.ts
```

## 구현 단계

### Phase 1: 프로젝트 설정

- [ ] SvelteKit 프로젝트 생성 (Bun)
- [ ] 의존성 설치
- [ ] Supabase 프로젝트 생성
- [ ] 테이블 및 RPC 함수 생성
- [ ] 환경 변수 설정

### Phase 2: 문서 처리 파이프라인

- [ ] 파일 해시 유틸리티
- [ ] 파일 중복 체크 로직
- [ ] 파일 타입 감지
- [ ] PDF 텍스트 추출 (pdf-parse)
- [ ] OCR 처리 (GPT-4o Vision)
- [ ] TXT 처리
- [ ] 청크 분할 (LangChain TextSplitter)
- [ ] 임베딩 (OpenAI)
- [ ] Supabase 저장
- [ ] LangGraph 워크플로우 통합

### Phase 3: 채팅 파이프라인

- [ ] 세션 ID 관리
- [ ] Query Rewriting
- [ ] 질문 임베딩
- [ ] Supabase RPC 벡터 검색
- [ ] 유사도 필터링
- [ ] 프롬프트 구성
- [ ] GPT-4o 응답 생성 (temperature: 0)
- [ ] 스트리밍 응답

### Phase 4: 프론트엔드

- [ ] 메타데이터 설정 화면
- [ ] 파일 업로드 UI (중복 시 안내)
- [ ] 채팅 UI
- [ ] 세션 관리

### Phase 5: 마무리

- [ ] 에러 처리
- [ ] README 작성
- [ ] GitHub 배포

## 의존성

```json
{
  "dependencies": {
    "@langchain/core": "latest",
    "@langchain/langgraph": "latest",
    "@langchain/openai": "latest",
    "@supabase/supabase-js": "latest",
    "pdf-parse": "latest"
  },
  "devDependencies": {
    "@sveltejs/kit": "latest",
    "typescript": "latest"
  }
}
```

## 환경 변수

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
OPENAI_API_KEY=sk-...
```
