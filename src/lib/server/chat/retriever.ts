import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '$lib/supabase';
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

const retriever = vectorStore.asRetriever({ k: 5 });

export interface ChunkResult {
	id: string;
	content: string;
	pageNumbers: number[];
	similarity: number;
}

export async function retrieve(query: string): Promise<ChunkResult[]> {
	const docs = await retriever.invoke(query);

	return docs.map((doc, i) => ({
		id: (doc.metadata?.id as string) ?? `doc-${i}`,
		content: doc.pageContent,
		pageNumbers: (doc.metadata?.page_numbers as number[]) ?? [1],
		similarity: (doc.metadata?.similarity as number) ?? 0
	}));
}
