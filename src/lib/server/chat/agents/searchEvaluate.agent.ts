import { z } from 'zod';
import { retrieve } from '../retriever';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, SubQuery, ThinkingStep, DocumentChunk } from '../state';

const MAX_ATTEMPTS = 2;
const MIN_CHUNKS = 2;

const QuerySchema = z.object({
	searchQuery: z.string().describe('English search query optimized for vector similarity search'),
	userIntent: z.string().describe('Korean response style instruction, empty if none')
});

const EvaluateSchema = z.object({
	sufficient: z.boolean().describe('true if results are sufficient to answer the question'),
	suggestion: z.string().describe('Query improvement suggestion if not sufficient')
});

export async function searchEvaluateNode(state: AgentGraphStateType) {
	const subQueryId = state.currentSubQueryId;
	const subQuery = state.subQueries.find((q) => q.id === subQueryId);

	if (!subQuery) {
		console.error(`[SearchEvaluate] SubQuery not found: ${subQueryId}`);
		return {};
	}

	console.log(`[SearchEvaluate] 시작 - id: ${subQuery.id}, query: "${subQuery.query}"`);
	console.time(`[SearchEvaluate] ${subQuery.id} 소요시간`);

	const thinkingSteps: ThinkingStep[] = [];
	let currentQuery = subQuery;
	let userIntent = '';

	while (currentQuery.attempts < MAX_ATTEMPTS) {
		const attempt = currentQuery.attempts + 1;
		console.log(`[SearchEvaluate] ${subQuery.id} - 시도 ${attempt}/${MAX_ATTEMPTS}`);

		const { searchQuery, chunks } = await executeSearch(
			currentQuery,
			state,
			attempt > 1
		);

		const intentResult = await analyzeIntent(currentQuery.query, state);
		userIntent = intentResult;

		thinkingSteps.push({
			type: 'reasoning' as const,
			content: `[${subQuery.id}] "${currentQuery.query}" -> "${searchQuery}"로 검색, ${chunks.length}개 결과`
		});

		if (chunks.length >= MIN_CHUNKS) {
			console.log(`[SearchEvaluate] ${subQuery.id} - 충분한 결과`);
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
			console.log(`[SearchEvaluate] ${subQuery.id} - 최대 시도 도달`);
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
			content: `[${subQuery.id}] 결과 부족, 쿼리 개선: ${evaluation.suggestion}`
		});

		currentQuery = {
			...currentQuery,
			query: evaluation.suggestion,
			attempts: attempt
		};
	}

	console.timeEnd(`[SearchEvaluate] ${subQuery.id} 소요시간`);

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
- Topic: ${state.fileContext.topic || 'N/A'}
- Context: ${state.fileContext.context || 'N/A'}`;
	}

	const retryHint = isRetry ? '\nPrevious search had insufficient results. Try fewer keywords.' : '';

	const { searchQuery } = await analyzer.invoke(
		`Generate a minimal search query.

${contextHint}
${retryHint}

Question: ${subQuery.query}

Rules:
- Keep the SAME language as the question
- Extract only the core keywords from the question
- DO NOT add extra context or infer information`
	);

	const results = await retrieve(searchQuery, state.sessionId, { k: 5, multiQuery: true });

	const chunks: DocumentChunk[] = results.map((result, i) => ({
		refId: `[${subQuery.id}:${i + 1}]`,
		content: result.content,
		pageNumber: result.pageNumbers[0] ?? 1
	}));

	return { searchQuery, chunks };
}

async function analyzeIntent(query: string, state: AgentGraphStateType): Promise<string> {
	const llm = createAgentLLM('research');
	const analyzer = llm.withStructuredOutput(QuerySchema);

	const { userIntent } = await analyzer.invoke(
		`Detect user intent for response style.

Question: ${query}

Detect:
- Format: table, list, summary, comparison
- Tone: formal/casual, technical/simple
- Depth: brief/detailed
Output in Korean, empty if no specific style.`
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

Set sufficient=true if:
- ANY result contains specific information that directly answers the question
- Question is unrelated to document topic

Set sufficient=false if:
- Results exist but none actually answer the question
- Need different keywords to find the answer

If not sufficient, suggest a simpler query with fewer keywords.`
	);
}
