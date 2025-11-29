import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { decomposeNode } from './agents/decompose.agent';
import { searchEvaluateNode } from './agents/searchEvaluate.agent';
import { synthesizeNode } from './agents/synthesize.agent';
import { AgentGraphState } from './state';
import type { AgentGraphStateType } from './state';

export type { AgentGraphStateType };

const checkpointer = new MemorySaver();

export function createAgentGraph() {
	return new StateGraph(AgentGraphState)
		.addNode('decompose', decomposeNode, { ends: ['searchEvaluate'] })
		.addNode('searchEvaluate', searchEvaluateNode)
		.addNode('synthesize', synthesizeNode)
		.addEdge(START, 'decompose')
		.addEdge('searchEvaluate', 'synthesize')
		.addEdge('synthesize', END)
		.compile({ checkpointer });
}

export async function runAgentGraph(sessionId: string, query: string) {
	console.log(`[Graph] 그래프 생성 중...`);
	const graph = createAgentGraph();
	console.log(`[Graph] 그래프 실행 시작`);

	const result = await graph.invoke(
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

	return result;
}

export function getGraphMermaid() {
	const graph = createAgentGraph();
	const mermaid = graph.getGraph().drawMermaid();
	return mermaid.replace(/^graph\s+TD/m, 'graph LR');
}
