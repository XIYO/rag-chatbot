import { runAgentGraph } from './chat/graph';
import type { ThinkingStep } from './chat/state';

export async function chat(sessionId: string, message: string) {
	console.log(`[Chat] 시작 - sessionId: ${sessionId}, message: "${message}"`);
	console.time('[Chat] 전체 소요시간');

	const result = await runAgentGraph(sessionId, message);

	console.timeEnd('[Chat] 전체 소요시간');
	console.log(`[Chat] 완료 - chunks: ${result.chunks.length}, response: ${result.finalResponse.slice(0, 100)}...`);

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
