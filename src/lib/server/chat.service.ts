import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { ChatState, type ChatStateType, type ThinkingStep, type WebSource, type DocumentReference, type GlossaryTerm } from './chat/state';
import { noResultResponse } from './chat/nodes/validation';
import { rewriteQuery, routeAfterRewrite } from './chat/nodes/query';
import { agentPlan, routeAfterPlan } from './chat/nodes/plan';
import { vectorSearch } from './chat/nodes/search';
import { generateFinalResponse } from './chat/nodes/final';
import {
	searchWebWithReliability,
	routeAfterWebSearch,
	retrySearch
} from './chat/nodes/agent';
import { enrichResponse } from './chat/nodes/enrich';
import { getSessionFiles } from './file.service';

function addUserMessage(state: ChatStateType): Partial<ChatStateType> {
	return {
		messages: [{ role: 'user', content: state.message }]
	};
}

function addAssistantMessage(state: ChatStateType): Partial<ChatStateType> {
	return {
		messages: [{ role: 'assistant', content: state.response }]
	};
}

const checkpointer = new MemorySaver();

function createChatPipeline() {
	return new StateGraph(ChatState)
		.addNode('addUserMessage', addUserMessage)
		.addNode('rewriteQuery', rewriteQuery)
		.addNode('agentPlan', agentPlan)
		.addNode('vectorSearch', vectorSearch)
		.addNode('searchWebWithReliability', searchWebWithReliability)
		.addNode('retrySearch', retrySearch)
		.addNode('generateFinalResponse', generateFinalResponse)
		.addNode('enrichResponse', enrichResponse)
		.addNode('noResultResponse', noResultResponse)
		.addNode('addAssistantMessage', addAssistantMessage)
		.addEdge(START, 'addUserMessage')
		.addEdge('addUserMessage', 'rewriteQuery')
		.addConditionalEdges('rewriteQuery', routeAfterRewrite)
		.addConditionalEdges('agentPlan', routeAfterPlan)
		.addEdge('vectorSearch', 'agentPlan')
		.addConditionalEdges('searchWebWithReliability', routeAfterWebSearch)
		.addEdge('retrySearch', 'searchWebWithReliability')
		.addEdge('generateFinalResponse', 'enrichResponse')
		.addEdge('enrichResponse', 'addAssistantMessage')
		.addEdge('noResultResponse', 'addAssistantMessage')
		.addEdge('addAssistantMessage', END)
		.compile({ checkpointer });
}

export async function chat(sessionId: string, message: string) {
	const files = await getSessionFiles(sessionId);
	const documentMeta = files.map((f) => f.filename).join(', ');

	const result = await createChatPipeline().invoke(
		{
			sessionId,
			message,
			currentStage: 'start',
			rewrittenQuery: '',
			queryEmbedding: [],
			retrievedChunks: [],
			response: '',
			suggestions: [],
			thinkingSteps: [],
			webSearchAnswer: '',
			webSources: [],
			searchAttempts: 0,
			documentMeta,
			complexity: 'LOW',
			subQuestions: [],
			subAnswers: [],
			documentReferences: [],
			glossary: [],
			nextAction: 'vector_search',
			pendingSearchQuery: null,
			searchHistory: [],
			iterationCount: 0,
			needsConversationContext: false
		},
		{ configurable: { thread_id: sessionId } }
	);

	return {
		id: crypto.randomUUID(),
		role: 'assistant' as const,
		content: result.response,
		suggestions: result.suggestions,
		thinkingSteps: result.thinkingSteps as ThinkingStep[],
		webSources: result.webSources as WebSource[],
		documentReferences: result.documentReferences as DocumentReference[],
		glossary: result.glossary as GlossaryTerm[]
	};
}
