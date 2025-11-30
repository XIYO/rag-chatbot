import { z } from 'zod';
import { retrieve } from '../retriever';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, SubQuery, ThinkingStep, DocumentChunk } from '../state';

const MAX_ATTEMPTS = 2;
const MIN_CHUNKS = 2;

const QuerySchema = z.object({
	searchQuery: z.string().describe('search query optimized for vector similarity search'),
	userIntent: z.string().describe('response style instructions, empty string if none')
});

const EvaluateSchema = z.object({
	sufficient: z.boolean().describe('true if results are sufficient to answer the question'),
	suggestion: z.string().describe('suggested query improvement if insufficient')
});

/**
 * 하위 질문에 대해 검색을 수행하고 결과를 평가한다.
 * 결과가 불충분하면 쿼리를 개선하여 재시도한다.
 * @param state 그래프 상태
 * @returns 검색 결과와 사고 단계
 */
export async function searchEvaluateNode(state: AgentGraphStateType) {
	const subQueryId = state.currentSubQueryId;
	const subQuery = state.subQueries.find((q) => q.id === subQueryId);

	if (!subQuery) {
		return {};
	}

	const thinkingSteps: ThinkingStep[] = [];
	let currentQuery = subQuery;
	const userIntent = await analyzeIntent(currentQuery.query);

	while (currentQuery.attempts < MAX_ATTEMPTS) {
		const attempt = currentQuery.attempts + 1;

		const { searchQuery, chunks } = await executeSearch(
			currentQuery,
			state,
			attempt > 1
		);

		thinkingSteps.push({
			type: 'reasoning' as const,
			content: `[${subQuery.id}] "${currentQuery.query}" -> searched "${searchQuery}", ${chunks.length} results`
		});

		if (chunks.length >= MIN_CHUNKS) {
			currentQuery = {
				...currentQuery,
				searchQuery,
				chunks,
				status: 'done',
				attempts: attempt
			};
			break;
		}

		if (attempt >= MAX_ATTEMPTS) {
			currentQuery = {
				...currentQuery,
				searchQuery,
				chunks,
				status: chunks.length > 0 ? 'done' : 'failed',
				attempts: attempt
			};
			break;
		}

		const evaluation = await evaluateResults(currentQuery.query, searchQuery, chunks, state);

		if (evaluation.sufficient) {
			currentQuery = {
				...currentQuery,
				searchQuery,
				chunks,
				status: 'done',
				attempts: attempt
			};
			break;
		}

		thinkingSteps.push({
			type: 'tool_result' as const,
			content: `[${subQuery.id}] insufficient results, refining query: ${evaluation.suggestion}`
		});

		currentQuery = {
			...currentQuery,
			query: evaluation.suggestion,
			attempts: attempt
		};
	}

	return {
		subQueries: [currentQuery],
		userIntent: userIntent || state.userIntent,
		thinkingSteps
	};
}

async function executeSearch(
	subQuery: SubQuery,
	state: AgentGraphStateType,
	isRetry: boolean
): Promise<{ searchQuery: string; chunks: DocumentChunk[] }> {
	const llm = createAgentLLM('research');
	const analyzer = llm.withStructuredOutput(QuerySchema);

	let contextHint = '';
	if (state.fileContext?.topic || state.fileContext?.context) {
		contextHint = `
Document context:
- Topic: ${state.fileContext.topic || 'none'}
- Context: ${state.fileContext.context || 'none'}`;
	}

	const retryHint = isRetry ? '\nPrevious search returned insufficient results. Try fewer keywords.' : '';

	const { searchQuery } = await analyzer.invoke(
		`Generate a minimal search query.

${contextHint}
${retryHint}

Question: ${subQuery.query}

Rules:
- Convert the query to English
- Extract only core keywords from the question
- Do NOT add context or infer additional information`
	);

	const results = await retrieve(searchQuery);

	const chunks: DocumentChunk[] = results.map((result, i) => ({
		refId: `[${subQuery.id}:${i + 1}]`,
		content: result.content,
		pageNumber: result.pageNumbers[0] ?? 1
	}));

	return { searchQuery, chunks };
}

async function analyzeIntent(query: string): Promise<string> {
	const llm = createAgentLLM('research');
	const analyzer = llm.withStructuredOutput(QuerySchema);

	const { userIntent } = await analyzer.invoke(
		`Identify user intent for response style.

Question: ${query}

Identify:
- Format: table, list, summary, comparison
- Tone: formal/informal, technical/simple
- Depth: brief/detailed
Return empty string if no specific style is requested.`
	);

	return userIntent;
}

async function evaluateResults(
	originalQuery: string,
	searchQuery: string,
	chunks: DocumentChunk[],
	state: AgentGraphStateType
): Promise<{ sufficient: boolean; suggestion: string }> {
	const llm = createAgentLLM('evaluator');
	const evaluator = llm.withStructuredOutput(EvaluateSchema);

	const preview = chunks
		.slice(0, 5)
		.map((c) => c.content.slice(0, 200))
		.join('\n---\n');

	const docContext = state.fileContext?.topic ? `Document topic: ${state.fileContext.topic}` : '';

	return evaluator.invoke(
		`Evaluate if search results can answer the question.

${docContext}

Question: ${originalQuery}
Search query: ${searchQuery}

Results preview:
${preview || 'No results'}

sufficient=true when:
- Any result contains specific information that directly answers the question
- Question is unrelated to document topic

sufficient=false when:
- Results exist but do not actually answer the question
- Different keywords are needed to find the answer

If insufficient, suggest a simpler query with fewer keywords.`
	);
}
