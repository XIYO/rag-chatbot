import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { decomposeNode } from './agents/decompose.agent';
import { searchEvaluateNode } from './agents/searchEvaluate.agent';
import { synthesizeNode } from './agents/synthesize.agent';
import { AgentGraphState } from './state';
import type { AgentGraphStateType } from './state';

export type { AgentGraphStateType };

const checkpointer = new MemorySaver();

/**
 * RAG 에이전트 그래프를 생성한다.
 * @returns 컴파일된 StateGraph 인스턴스
 */
export function createAgentGraph() {
	return new StateGraph(AgentGraphState)
		.addNode('decompose', decomposeNode, { ends: ['searchEvaluate', 'synthesize'] })
		.addNode('searchEvaluate', searchEvaluateNode)
		.addNode('synthesize', synthesizeNode)
		.addEdge(START, 'decompose')
		.addEdge('searchEvaluate', 'synthesize')
		.addEdge('synthesize', END)
		.compile({ checkpointer });
}

/**
 * 사용자 쿼리로 에이전트 그래프를 실행한다.
 * @param sessionId 세션 식별자
 * @param query 사용자 질문
 * @returns 그래프 실행 결과
 */
export async function runAgentGraph(sessionId: string, query: string) {
	const graph = createAgentGraph();

	return graph.invoke(
		{
			sessionId,
			originalQuery: query,
			searchQuery: '',
			userIntent: '',
			fileContext: null,
			chunks: [],
			subQueries: [],
			currentSubQueryId: null,
			evaluationFeedback: null,
			searchAttempts: 0,
			thinkingSteps: [],
			finalResponse: ''
		},
		{ configurable: { thread_id: sessionId } }
	);
}

/**
 * 그래프 구조를 Mermaid 다이어그램으로 반환한다.
 * @returns Mermaid 형식 문자열
 */
export function getGraphMermaid() {
	const graph = createAgentGraph();
	const mermaid = graph.getGraph().drawMermaid();
	return mermaid.replace(/^graph\s+TD/m, 'graph LR');
}
