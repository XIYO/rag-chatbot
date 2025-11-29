import type { ChatStateType, ThinkingStep, WebSource } from '../state';
import { webSearchWithGemini } from '../../agent/search';
import { validationLLM } from '../llm';

const MAX_SEARCH_ATTEMPTS = 2;
const TARGET_SOURCES = 5;

function createThinkingStep(type: ThinkingStep['type'], content: string): ThinkingStep {
	return { type, content, timestamp: Date.now() };
}

function getTodayDate() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function generateSearchQuery(query: string, attempt: number): Promise<string> {
	const today = getTodayDate();

	const strategies = [
		'Create a precise search query for finding authoritative sources like official documentation, research papers, or tech company blogs.',
		'Create a search query targeting academic papers, IEEE, ACM, or scholarly articles.'
	];

	const prompt = `You are a search query optimizer. Given a user question, generate the best English search query.

Today: ${today}

User question: ${query}

Strategy: ${strategies[attempt - 1] || strategies[0]}

Rules:
- Output ONLY the search query, nothing else
- Convert to English
- Use English keywords that will find high-quality, authoritative sources
- Be specific and use technical terms
- For recent/latest information, use the current year from today's date

Search query:`;

	const result = await validationLLM.invoke(prompt);
	const searchQuery = typeof result.content === 'string' ? result.content.trim() : query;
	return searchQuery;
}

export async function searchWebWithReliability(state: ChatStateType): Promise<Partial<ChatStateType>> {
	const attempt = state.searchAttempts + 1;
	console.log(`[Agent] Web search attempt ${attempt}/${MAX_SEARCH_ATTEMPTS}`);

	const searchQuery = await generateSearchQuery(state.rewrittenQuery, attempt);

	const thinkingSteps: ThinkingStep[] = [
		createThinkingStep('action', `웹 검색 시도 ${attempt}회: "${searchQuery}"`)
	];

	const searchResult = await webSearchWithGemini(searchQuery);

	if (searchResult.sources.length === 0) {
		return {
			searchAttempts: attempt,
			webSearchAnswer: state.webSearchAnswer || '',
			webSources: state.webSources,
			thinkingSteps: [
				...state.thinkingSteps,
				...thinkingSteps,
				createThinkingStep('observation', `검색 결과 없음 (출처 누적: ${state.webSources.length}개)`)
			],
			currentStage: 'web_search'
		};
	}

	thinkingSteps.push(
		createThinkingStep('observation', `${searchResult.sources.length}개 출처 발견`)
	);

	const newSources: WebSource[] = searchResult.sources.map((s) => ({
		url: s.url,
		title: s.title,
		snippet: s.snippet
	}));

	const seenUrls = new Set(state.webSources.map((s) => s.url));
	const uniqueNewSources = newSources.filter((s) => !seenUrls.has(s.url));
	const allSources = [...state.webSources, ...uniqueNewSources];

	const sourcesSummary = newSources
		.slice(0, 5)
		.map((s) => `- ${new URL(s.url).hostname}`)
		.join('\n');

	thinkingSteps.push(
		createThinkingStep('observation', `${sourcesSummary}\n\n출처 누적: ${allSources.length}개`)
	);

	const combinedAnswer = state.webSearchAnswer
		? `${state.webSearchAnswer}\n\n${searchResult.answer}`
		: searchResult.answer;

	return {
		searchAttempts: attempt,
		webSearchAnswer: combinedAnswer,
		webSources: allSources,
		thinkingSteps: [...state.thinkingSteps, ...thinkingSteps],
		currentStage: 'web_search'
	};
}

export function routeAfterWebSearch(state: ChatStateType): 'retrySearch' | 'generateFinalResponse' {
	const sourceCount = state.webSources.length;
	if (sourceCount < TARGET_SOURCES && state.searchAttempts < MAX_SEARCH_ATTEMPTS) {
		console.log(`[Agent] Sources ${sourceCount} < ${TARGET_SOURCES}, retrying...`);
		return 'retrySearch';
	}
	console.log(`[Agent] Search complete with ${sourceCount} sources`);
	return 'generateFinalResponse';
}

export async function retrySearch(state: ChatStateType): Promise<Partial<ChatStateType>> {
	const sourceCount = state.webSources.length;
	return {
		thinkingSteps: [
			...state.thinkingSteps,
			createThinkingStep('thought', `출처 ${sourceCount}개 수집, 목표 ${TARGET_SOURCES}개까지 재검색 (${state.searchAttempts}/${MAX_SEARCH_ATTEMPTS})`)
		]
	};
}
