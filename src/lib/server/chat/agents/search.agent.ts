import { z } from 'zod';
import { retrieve, getFileContext } from '../retriever';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, ThinkingStep } from '../state';

const QueryAnalysisSchema = z.object({
	searchQuery: z.string().describe('English search query optimized for vector similarity search'),
	userIntent: z.string().describe('Korean instructions for response style based on user intent. Empty if no specific style detected.')
});

export async function searchNode(state: AgentGraphStateType) {
	console.log(`[Search] 노드 시작 - originalQuery: "${state.originalQuery}", attempt: ${state.searchAttempts + 1}`);
	console.time('[Search] 소요시간');

	const thinkingSteps: ThinkingStep[] = [];
	const feedback = state.evaluationFeedback;
	const isRetry = feedback !== null;

	const fileContext = state.fileContext ?? (await getFileContext(state.sessionId));
	console.log(`[Search] 파일 컨텍스트:`, fileContext ? `topic="${fileContext.topic}"` : 'null');

	const llm = createAgentLLM('research');
	const analyzer = llm.withStructuredOutput(QueryAnalysisSchema);

	let contextHint = '';
	if (fileContext?.topic || fileContext?.context) {
		contextHint = `
Document context:
- Topic: ${fileContext.topic || 'N/A'}
- Context: ${fileContext.context || 'N/A'}`;
	}

	let feedbackHint = '';
	if (feedback) {
		feedbackHint = `
Previous search failed:
- Query: ${feedback.previousQuery}
- Results: ${feedback.chunkCount}
- Problem: ${feedback.reason}
- Suggestion: ${feedback.suggestion}

Improve the query based on this feedback.`;
	}

	const { searchQuery, userIntent } = await analyzer.invoke(
		`Analyze the user question and generate an optimized search query.

${contextHint}
${feedbackHint}

1. Search query:
   - ALWAYS output in ENGLISH
   - If question relates to document topic: use context to optimize query
   - If question is unrelated to document: translate directly without modification
   - Preserve proper nouns and technical terms
   - Keep SHORT and FOCUSED

2. User intent (response style):
   - Detect format requests: table, list, summary, comparison
   - Detect tone: formal/casual, technical/simple
   - Detect depth: brief/detailed
   - Output in Korean, e.g.: "표 형태로 정리해주세요", "핵심만 간단히 요약해주세요"
   - Empty string if no specific style

User question: ${state.originalQuery}`
	);

	console.log(`[Search] 분석 결과 - searchQuery: "${searchQuery}", userIntent: "${userIntent}"`);

	thinkingSteps.push({
		type: 'reasoning' as const,
		content: isRetry
			? `검색 결과가 부족하여 쿼리를 "${searchQuery}"로 개선했습니다.`
			: `"${state.originalQuery}"를 분석하여 "${searchQuery}"로 검색합니다.${userIntent ? ` 응답 스타일: ${userIntent}` : ''}`
	});

	console.log(`[Search] retrieve 호출 중...`);
	const results = await retrieve(searchQuery, state.sessionId, { k: 5, multiQuery: true });
	console.log(`[Search] retrieve 완료 - ${results.length}개 결과`);

	const chunks = results.map((result, i) => ({
		refId: `[ref:${i + 1}]`,
		content: result.content,
		pageNumber: result.pageNumbers[0] ?? 1
	}));

	thinkingSteps.push({
		type: 'tool_result' as const,
		content: `문서에서 ${chunks.length}개의 관련 내용을 찾았습니다.`
	});

	console.timeEnd('[Search] 소요시간');

	return {
		searchQuery,
		userIntent: userIntent || state.userIntent,
		fileContext,
		chunks,
		searchAttempts: state.searchAttempts + 1,
		thinkingSteps
	};
}
