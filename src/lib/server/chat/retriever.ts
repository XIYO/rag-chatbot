import { SupabaseVectorStore } from '@langchain/community/vectorstores/supabase';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';
import { supabase } from '$lib/supabase';
import { validationLLM } from './llm';
import { z } from 'zod';
import { LLM_API_KEY, EMBEDDING_MODEL } from '$env/static/private';

interface RetrieverConfig {
	sessionId: string;
	k?: number;
	multiQuery?: boolean;
}

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: LLM_API_KEY,
	modelName: EMBEDDING_MODEL
});

const MultiQuerySchema = z.object({
	queries: z.array(z.string()).describe('3-5 different phrasings of the same question for vector search')
});

async function generateMultiQueries(originalQuery: string): Promise<string[]> {
	const prompt = `Generate 4 different phrasings of this search query for vector similarity search.
Each phrasing should use different keywords while preserving the intent.
Use specific terms that might appear in documents.

Original query: ${originalQuery}

Rules:
- Keep all queries in English
- Use varied vocabulary and phrasing
- Include keyword-style queries (e.g., "AI agent investment 2024")
- Include natural question style (e.g., "What is the investment trend")`;

	const structuredLLM = validationLLM.withStructuredOutput(MultiQuerySchema);
	const result = await structuredLLM.invoke(prompt);

	console.log(`[MultiQuery] Generated: ${result.queries.join(' | ')}`);
	return [originalQuery, ...result.queries];
}

function createVectorStore(sessionId: string) {
	return new SupabaseVectorStore(embeddings, {
		client: supabase,
		tableName: 'chunks',
		queryName: 'match_chunks',
		filter: { chat_id: sessionId }
	});
}

interface ChunkResult {
	id: number;
	content: string;
	pageNumber: number;
	similarity: number;
}

async function searchWithQuery(
	query: string,
	vectorStore: SupabaseVectorStore,
	k: number
): Promise<ChunkResult[]> {
	const results = await vectorStore.similaritySearchWithScore(query, k);

	return results.map(([doc, score]) => ({
		id: (doc.metadata.id as number) ?? 0,
		content: doc.pageContent,
		pageNumber: (doc.metadata.page_number as number) ?? 0,
		similarity: score
	}));
}

export async function retrieve(
	query: string,
	sessionId: string,
	options?: { k?: number; multiQuery?: boolean }
): Promise<Document[]> {
	const k = options?.k ?? 5;
	const multiQuery = options?.multiQuery ?? true;
	const vectorStore = createVectorStore(sessionId);

	let allChunks: ChunkResult[] = [];

	if (multiQuery) {
		const queries = await generateMultiQueries(query);
		const results = await Promise.all(
			queries.map(async (q) => {
				const chunks = await searchWithQuery(q, vectorStore, k);
				console.log(`[MultiQuery] "${q.slice(0, 40)}" → ${chunks.length} results (top: ${chunks[0]?.similarity.toFixed(3) || 'N/A'})`);
				return chunks;
			})
		);

		const seen = new Set<number>();
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
		allChunks = await searchWithQuery(query, vectorStore, k);
	}

	if (allChunks.length === 0) {
		console.log(`[Retriever] No chunks found`);
		return [];
	}

	const topSim = allChunks[0]?.similarity.toFixed(3);
	const bottomSim = allChunks[allChunks.length - 1]?.similarity.toFixed(3);
	console.log(`[Retriever] Found ${allChunks.length} chunks (similarity: ${topSim} ~ ${bottomSim})`);

	return allChunks.map((chunk) =>
		new Document({
			pageContent: chunk.content,
			metadata: {
				id: chunk.id,
				pageNumber: chunk.pageNumber,
				similarity: chunk.similarity
			}
		})
	);
}

export function createRetriever(sessionId: string, options?: Partial<RetrieverConfig>) {
	return {
		async invoke(query: string) {
			return retrieve(query, sessionId, options);
		}
	};
}

export async function expandChunks(
	chunkIds: number[],
	range: number = 1
): Promise<Array<{ id: number; content: string; pageNumber: number }>> {
	if (chunkIds.length === 0) return [];

	const { data: targetChunks } = await supabase
		.from('chunks')
		.select('id, file_id, page_number')
		.in('id', chunkIds);

	if (!targetChunks || targetChunks.length === 0) return [];

	const expandedIds = new Set<number>();
	for (const chunk of targetChunks) {
		for (let i = -range; i <= range; i++) {
			expandedIds.add(chunk.id + i);
		}
	}

	const fileIds = [...new Set(targetChunks.map((c) => c.file_id))];

	const { data: expandedChunks } = await supabase
		.from('chunks')
		.select('id, content, page_number')
		.in('id', [...expandedIds])
		.in('file_id', fileIds)
		.order('id');

	if (!expandedChunks) return [];

	console.log(`[Retriever] Expanded ${chunkIds.length} chunks → ${expandedChunks.length} chunks (range: ${range})`);

	return expandedChunks.map((c) => ({
		id: c.id,
		content: c.content,
		pageNumber: c.page_number ?? 0
	}));
}
