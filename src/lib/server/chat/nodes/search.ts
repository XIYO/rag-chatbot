import type { ChatStateType, ThinkingStep, SearchQuery } from '../state';
import { createRetriever } from '../retriever';

function createThinkingStep(type: ThinkingStep['type'], content: string): ThinkingStep {
	return { type, content, timestamp: Date.now() };
}

export async function vectorSearch(state: ChatStateType): Promise<Partial<ChatStateType>> {
	const searchQuery = state.pendingSearchQuery;

	if (!searchQuery) {
		console.log('[VectorSearch] No pending search query, using original message');
		const fallbackQuery: SearchQuery = {
			query: state.rewrittenQuery || state.message,
			reason: '기본 검색'
		};
		return executeSearch(state, fallbackQuery);
	}

	return executeSearch(state, searchQuery);
}

async function executeSearch(
	state: ChatStateType,
	searchQuery: SearchQuery
): Promise<Partial<ChatStateType>> {
	console.log(`[VectorSearch] Searching: "${searchQuery.query}"`);

	const retriever = createRetriever(state.sessionId, { k: 5 });
	const docs = await retriever.invoke(searchQuery.query);

	const newChunks = docs.map((doc) => ({
		id: doc.metadata.id as number,
		content: doc.pageContent,
		pageNumber: doc.metadata.pageNumber as number,
		similarity: doc.metadata.similarity as number
	}));

	const existingIds = new Set(state.retrievedChunks.map((c) => c.id));
	const uniqueNewChunks = newChunks.filter((c) => !existingIds.has(c.id));
	const allChunks = [...state.retrievedChunks, ...uniqueNewChunks];

	console.log(`[VectorSearch] Found ${newChunks.length} chunks, ${uniqueNewChunks.length} new`);

	const chunkSummary = uniqueNewChunks
		.slice(0, 3)
		.map((c) => `p.${c.pageNumber}: ${c.content.slice(0, 50)}...`)
		.join('\n');

	const thinkingStep = createThinkingStep(
		'action',
		`문서 검색: "${searchQuery.query}"\n${uniqueNewChunks.length}개 새 청크 발견\n${chunkSummary}`
	);

	return {
		retrievedChunks: allChunks,
		pendingSearchQuery: null,
		searchHistory: [searchQuery],
		thinkingSteps: [...state.thinkingSteps, thinkingStep],
		currentStage: 'vector_search'
	};
}
