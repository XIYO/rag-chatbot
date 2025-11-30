import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { MultiQueryRetriever } from '@langchain/classic/retrievers/multi_query';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Document } from '@langchain/core/documents';
import { supabase } from '$lib/supabase';
import { createAgentLLM } from './llm';
import { LLM_API_KEY, EMBEDDING_MODEL } from '$env/static/private';

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: LLM_API_KEY,
	modelName: EMBEDDING_MODEL
});

const vectorStore = new SupabaseVectorStore(embeddings, {
	client: supabase,
	tableName: 'chunks',
	queryName: 'match_documents'
});

const baseRetriever = vectorStore.asRetriever({ k: 5 });

const multiQueryRetriever = MultiQueryRetriever.fromLLM({
	llm: createAgentLLM('validation'),
	retriever: baseRetriever,
	queryCount: 4
});

export interface ChunkResult {
	id: string;
	content: string;
	pageNumbers: number[];
	similarity: number;
}

/**
 * 벡터 유사도 검색으로 관련 청크를 조회한다.
 * @param query 검색 쿼리
 * @param options 검색 옵션
 * @returns 검색된 청크 배열
 */
export async function retrieve(
	query: string,
	options?: { k?: number; multiQuery?: boolean }
): Promise<ChunkResult[]> {
	const k = options?.k ?? 5;
	const useMultiQuery = options?.multiQuery ?? true;

	const retriever = useMultiQuery ? multiQueryRetriever : baseRetriever;
	const docs = await retriever.invoke(query);

	return docs.slice(0, k).map((doc: Document, i: number) => ({
		id: (doc.metadata?.id as string) ?? `doc-${i}`,
		content: doc.pageContent,
		pageNumbers: (doc.metadata?.page_numbers as number[]) ?? [1],
		similarity: (doc.metadata?.similarity as number) ?? 0
	}));
}
