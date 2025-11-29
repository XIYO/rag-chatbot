import { OpenAIEmbeddings } from '@langchain/openai';
import { supabase } from '$lib/supabase';
import { validationLLM } from './llm';
import { z } from 'zod';
import { LLM_API_KEY, EMBEDDING_MODEL } from '$env/static/private';
import type { FileContext } from './state';

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: LLM_API_KEY,
	modelName: EMBEDDING_MODEL
});

const MultiQuerySchema = z.object({
	queries: z
		.array(z.string())
		.describe('3-5 different phrasings of the same question for vector search')
});

export interface ChunkResult {
	id: string;
	content: string;
	pageNumbers: number[];
	similarity: number;
}

async function generateMultiQueries(originalQuery: string): Promise<string[]> {
	const prompt = `Generate 4 different phrasings of this search query for vector similarity search.
Each phrasing should use different keywords while preserving the intent.
Use specific terms that might appear in English documents.

Original query: ${originalQuery}

Rules:
- IMPORTANT: Generate ALL queries in ENGLISH regardless of input language
- Use varied vocabulary and phrasing
- Include keyword-style queries (e.g., "AI agent market trends 2024")
- Include natural question style (e.g., "What are the benefits of AI agents?")`;

	const structuredLLM = validationLLM.withStructuredOutput(MultiQuerySchema);
	const result = await structuredLLM.invoke(prompt);

	console.log(`[MultiQuery] Generated: ${result.queries.join(' | ')}`);
	return [originalQuery, ...result.queries];
}

async function searchWithEmbedding(
	queryEmbedding: number[],
	sessionId: string,
	k: number,
	threshold: number
): Promise<ChunkResult[]> {
	console.log(`[Retriever] RPC search_chunks 호출 - sessionId: ${sessionId}, k: ${k}, threshold: ${threshold}`);
	const { data, error } = await supabase.rpc('search_chunks', {
		query_embedding: JSON.stringify(queryEmbedding),
		match_count: k,
		p_chat_id: sessionId,
		similarity_threshold: threshold
	});

	if (error) {
		console.error('[Retriever] Search failed:', error.message, error);
		return [];
	}

	console.log(`[Retriever] RPC 결과: ${data?.length ?? 0}개`);

	return (data ?? []).map((row: { id: string; content: string; page_numbers: number[]; similarity: number }) => ({
		id: row.id,
		content: row.content,
		pageNumbers: row.page_numbers,
		similarity: row.similarity
	}));
}

export async function getFileContext(sessionId: string): Promise<FileContext | null> {
	const { data } = await supabase
		.from('chat_files')
		.select('files(topic, context)')
		.eq('chat_id', sessionId)
		.limit(1)
		.single();

	if (!data?.files) return null;

	const files = data.files as { topic: string | null; context: string | null };
	return {
		topic: files.topic,
		context: files.context
	};
}

export async function retrieve(
	query: string,
	sessionId: string,
	options?: { k?: number; multiQuery?: boolean; threshold?: number }
): Promise<ChunkResult[]> {
	const k = options?.k ?? 5;
	const multiQuery = options?.multiQuery ?? true;
	const threshold = options?.threshold ?? 0.5;

	let allChunks: ChunkResult[] = [];

	if (multiQuery) {
		const queries = await generateMultiQueries(query);
		const queryEmbeddings = await embeddings.embedDocuments(queries);

		const results = await Promise.all(
			queryEmbeddings.map(async (embedding, i) => {
				const chunks = await searchWithEmbedding(embedding, sessionId, k, threshold);
				console.log(
					`[MultiQuery] "${queries[i].slice(0, 40)}" → ${chunks.length} results (top: ${chunks[0]?.similarity.toFixed(3) || 'N/A'})`
				);
				return chunks;
			})
		);

		const seen = new Set<string>();
		for (const chunks of results) {
			for (const chunk of chunks) {
				if (!seen.has(chunk.id)) {
					seen.add(chunk.id);
					allChunks.push(chunk);
				}
			}
		}

		allChunks.sort((a, b) => b.similarity - a.similarity);
		allChunks = allChunks.slice(0, k);
	} else {
		const [embedding] = await embeddings.embedDocuments([query]);
		allChunks = await searchWithEmbedding(embedding, sessionId, k, threshold);
	}

	if (allChunks.length === 0) {
		console.log(`[Retriever] No chunks found`);
		return [];
	}

	const topSim = allChunks[0]?.similarity.toFixed(3);
	const bottomSim = allChunks[allChunks.length - 1]?.similarity.toFixed(3);
	console.log(`[Retriever] Found ${allChunks.length} chunks (similarity: ${topSim} ~ ${bottomSim})`);

	return allChunks;
}
