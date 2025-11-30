import { z } from 'zod';
import { retrieve } from '../retriever';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, SubQuery, ThinkingStep, DocumentChunk } from '../state';

const MAX_ATTEMPTS = 2;
const MIN_CHUNKS = 2;

const QuerySchema = z.object({
	searchQuery: z.string().describe('벡터 유사도 검색에 최적화된 검색 쿼리'),
	userIntent: z.string().describe('응답 스타일 지시사항, 없으면 빈 문자열')
});

const EvaluateSchema = z.object({
	sufficient: z.boolean().describe('결과가 질문에 답하기에 충분하면 true'),
	suggestion: z.string().describe('불충분할 경우 쿼리 개선 제안')
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
문서 컨텍스트:
- 주제: ${state.fileContext.topic || '없음'}
- 맥락: ${state.fileContext.context || '없음'}`;
	}

	const retryHint = isRetry ? '\n이전 검색 결과가 부족했다. 키워드를 줄여서 시도하라.' : '';

	const { searchQuery } = await analyzer.invoke(
		`최소한의 검색 쿼리를 생성하라.

${contextHint}
${retryHint}

질문: ${subQuery.query}

규칙:
- 질문과 동일한 언어를 유지하라
- 질문에서 핵심 키워드만 추출하라
- 추가 컨텍스트를 덧붙이거나 정보를 추론하지 마라`
	);

	const results = await retrieve(searchQuery, { k: 5, multiQuery: true });

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
		`응답 스타일에 대한 사용자 의도를 파악하라.

질문: ${query}

파악 항목:
- 형식: 표, 목록, 요약, 비교
- 어조: 공식적/비공식적, 기술적/간단
- 깊이: 간략/상세
특정 스타일이 없으면 빈 문자열을 반환하라.`
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

	const docContext = state.fileContext?.topic ? `문서 주제: ${state.fileContext.topic}` : '';

	return evaluator.invoke(
		`검색 결과가 질문에 답할 수 있는지 평가하라.

${docContext}

질문: ${originalQuery}
검색 쿼리: ${searchQuery}

결과 미리보기:
${preview || '결과 없음'}

sufficient=true 조건:
- 어떤 결과든 질문에 직접 답하는 구체적 정보를 포함
- 질문이 문서 주제와 무관함

sufficient=false 조건:
- 결과는 있지만 실제로 질문에 답하지 않음
- 답을 찾으려면 다른 키워드가 필요함

불충분할 경우 키워드를 줄인 더 단순한 쿼리를 제안하라.`
	);
}
