# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev          # Start development server
bun run build        # Build for production
bun run preview      # Preview production build
bun run check        # Type check with svelte-check
bun run lint         # Run prettier and eslint
bun run format       # Format code with prettier
bun run test:unit    # Run unit tests with vitest
bun run test:e2e     # Run e2e tests with playwright
bun run test         # Run all tests
```

## Architecture

This is a RAG chatbot application built with SvelteKit 5 and LangGraph.

### Core Flow

1. **Document Upload**: PDF files are processed via `embedding.service.ts`
   - Extracts text using unpdf
   - Splits into chunks with RecursiveCharacterTextSplitter
   - Generates embeddings with OpenAI
   - Stores in Supabase with vector embeddings

2. **Chat Pipeline**: LangGraph state machine in `chat.service.ts` orchestrates:
   - `validateQuestion` - Validates user input
   - `decomposeQuestion` - Breaks complex questions into sub-questions
   - `rewriteQuery` - Optimizes query for retrieval
   - `retrieveChunks` - Vector similarity search in Supabase
   - `processParallel` - Handles sub-questions concurrently
   - `generateResponse` - Creates answer using retrieved context
   - `searchWebWithReliability` - Falls back to DuckDuckGo web search
   - `enrichResponse` - Adds document references and glossary
   - `synthesizeResponse` - Combines sub-answers for complex queries

### Key Files

- `src/lib/server/chat.service.ts` - LangGraph pipeline definition
- `src/lib/server/chat/state.ts` - State schema with Annotation API
- `src/lib/server/chat/nodes/` - Individual pipeline nodes
- `src/lib/server/chat/llm.ts` - LLM configuration with adaptive model selection
- `src/lib/server/embedding.service.ts` - Document processing and embedding
- `src/routes/+page.svelte` - Main chat UI component

### Remote Functions

Uses SvelteKit experimental remote functions:
- `src/routes/chat.remote.ts` - Chat message handler via `command()`
- `src/routes/embedding.remote.ts` - File upload handler via `form()`
- `src/routes/file.remote.ts` - Session file queries

### Data Storage

Supabase with typed client from `src/lib/database.types.ts`:
- `files` table - Document metadata with topic analysis
- `chunks` table - Text chunks with vector embeddings
- `chat_files` - Links sessions to files

## Testing

Vitest configured with two projects:
- `client` - Browser tests for Svelte components using Playwright
- `server` - Node environment for server-side tests

Tests require assertions via `expect.requireAssertions: true`.

## Environment Variables

Required in `.env`:
- `LLM_API_KEY` - OpenAI API key
- `LLM_CHAT_MODEL` - Chat model name
- `EMBEDDING_MODEL` - Embedding model name
- `MODEL_LOW`, `MODEL_MEDIUM`, `MODEL_HIGH` - Complexity-based model selection
- `PUBLIC_SUPABASE_URL` - Supabase project URL
- `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` - Supabase anon key
