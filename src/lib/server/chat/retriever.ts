import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { MultiQueryRetriever } from '@langchain/classic/retrievers/multi_query';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { Document } from '@langchain/core/documents';
import { supabase } from '$lib/supabase';
import { validationLLM } from './llm';
import { LLM_API_KEY, EMBEDDING_MODEL } from '$env/static/private';
import type { FileContext } from './state';

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
	llm: validationLLM,
	retriever: baseRetriever,
	queryCount: 4,
	verbose: true
});

export interface ChunkResult {
	id: string;
	content: string;
	pageNumbers: number[];
	similarity: number;
}

export async function getFileContext(): Promise<FileContext | null> {
	const { data } = await supabase
		.from('files')
		.select('topic, context')
		.order('created_at', { ascending: false })
		.limit(1)
		.single();

	if (!data) return null;

	return {
		topic: data.topic,
		context: data.context
	};
}

export async function retrieve(
	query: string,
	options?: { k?: number; multiQuery?: boolean }
): Promise<ChunkResult[]> {
	const k = options?.k ?? 5;
	const useMultiQuery = options?.multiQuery ?? true;

	console.log(`[Retriever] 검색 시작 - query: "${query}", multiQuery: ${useMultiQuery}`);

	const retriever = useMultiQuery ? multiQueryRetriever : baseRetriever;
	const docs = await retriever.invoke(query);

	console.log(`[Retriever] ${docs.length}개 문서 검색 완료`);

	const results: ChunkResult[] = docs.slice(0, k).map((doc: Document, i: number) => ({
		id: (doc.metadata?.id as string) ?? `doc-${i}`,
		content: doc.pageContent,
		pageNumbers: (doc.metadata?.page_numbers as number[]) ?? [1],
		similarity: (doc.metadata?.similarity as number) ?? 0
	}));

	return results;
}
