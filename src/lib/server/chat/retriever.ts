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
		.describe('벡터 검색을 위한 동일 질문의 3-5개 다른 표현')
});

export interface ChunkResult {
	id: string;
	content: string;
	pageNumbers: number[];
	similarity: number;
}

async function generateMultiQueries(originalQuery: string): Promise<string[]> {
	const prompt = `벡터 유사도 검색을 위해 이 검색 쿼리의 4가지 다른 표현을 생성하라.
각 표현은 의도를 유지하면서 다른 키워드를 사용해야 한다.
영어 문서에 나타날 수 있는 구체적인 용어를 사용하라.

원본 쿼리: ${originalQuery}

규칙:
- 중요: 입력 언어와 관계없이 모든 쿼리를 영어로 생성하라
- 다양한 어휘와 표현을 사용하라
- 키워드 스타일 쿼리를 포함하라 (예: "AI agent market trends 2024")
- 자연스러운 질문 스타일을 포함하라 (예: "What are the benefits of AI agents?")`;

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
