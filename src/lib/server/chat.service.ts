import { runAgentGraph } from './chat/graph';
import type { ThinkingStep } from './chat/state';

/**
 * 사용자 메시지를 처리하고 RAG 기반 응답을 생성한다.
 * @param sessionId 세션 식별자
 * @param message 사용자 질문
 * @returns 어시스턴트 응답 객체
 */
export async function chat(sessionId: string, message: string) {
	const result = await runAgentGraph(sessionId, message);

	const references = result.chunks.map((c, i) => ({
		id: `ref:${i + 1}`,
		pageNumber: c.pageNumber,
		content: c.content,
		cited: result.finalResponse.includes(c.refId)
	}));

	return {
		id: crypto.randomUUID(),
		role: 'assistant' as const,
		content: result.finalResponse,
		thinkingSteps: result.thinkingSteps as ThinkingStep[],
		documentReferences: references
	};
}
