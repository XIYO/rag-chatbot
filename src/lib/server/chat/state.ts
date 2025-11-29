import { Annotation } from '@langchain/langgraph';

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ThinkingStep {
	type: 'thought' | 'action' | 'observation';
	content: string;
	timestamp: number;
}

export interface WebSource {
	url: string;
	title: string;
	snippet?: string;
}

export interface DocumentReference {
	id: string;
	fileName: string;
	pageNumber: number;
	content: string;
	relevance: number;
}

export interface SubQuestion {
	question: string;
	questionKo: string;
	intent: string;
}

export interface SubAnswer {
	question: string;
	answer: string;
	sources: WebSource[];
	chunks: Array<{ id: number; content: string; pageNumber: number }>;
}

export interface GlossaryTerm {
	term: string;
	definition: string;
	reason: string;
}

export type Complexity = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentAction = 'vector_search' | 'web_search' | 'generate' | 'done';

export interface SearchQuery {
	query: string;
	reason: string;
}

export const ChatState = Annotation.Root({
	sessionId: Annotation<string>,
	message: Annotation<string>,
	messages: Annotation<ChatMessage[]>({
		reducer: (prev, next) => [...prev, ...next],
		default: () => []
	}),
	currentStage: Annotation<string>,
	rewrittenQuery: Annotation<string>,
	queryEmbedding: Annotation<number[]>,
	retrievedChunks: Annotation<Array<{ id: number; content: string; pageNumber: number; similarity: number }>>,
	response: Annotation<string>,
	suggestions: Annotation<string[]>({
		reducer: (_, next) => next,
		default: () => []
	}),
	thinkingSteps: Annotation<ThinkingStep[]>({
		reducer: (_, next) => next,
		default: () => []
	}),
	webSearchAnswer: Annotation<string>({
		reducer: (_, next) => next,
		default: () => ''
	}),
	webSources: Annotation<WebSource[]>({
		reducer: (_, next) => next,
		default: () => []
	}),
	searchAttempts: Annotation<number>({
		reducer: (_, next) => next,
		default: () => 0
	}),
	documentMeta: Annotation<string>({
		reducer: (_, next) => next,
		default: () => ''
	}),
	complexity: Annotation<Complexity>({
		reducer: (_, next) => next,
		default: () => 'LOW'
	}),
	subQuestions: Annotation<SubQuestion[]>({
		reducer: (_, next) => next,
		default: () => []
	}),
	subAnswers: Annotation<SubAnswer[]>({
		reducer: (prev, next) => [...prev, ...next],
		default: () => []
	}),
	documentReferences: Annotation<DocumentReference[]>({
		reducer: (_, next) => next,
		default: () => []
	}),
	glossary: Annotation<GlossaryTerm[]>({
		reducer: (_, next) => next,
		default: () => []
	}),
	nextAction: Annotation<AgentAction>({
		reducer: (_, next) => next,
		default: () => 'vector_search'
	}),
	pendingSearchQuery: Annotation<SearchQuery | null>({
		reducer: (_, next) => next,
		default: () => null
	}),
	searchHistory: Annotation<SearchQuery[]>({
		reducer: (prev, next) => [...prev, ...next],
		default: () => []
	}),
	iterationCount: Annotation<number>({
		reducer: (_, next) => next,
		default: () => 0
	}),
	needsConversationContext: Annotation<boolean>({
		reducer: (_, next) => next,
		default: () => false
	})
});

export type ChatStateType = typeof ChatState.State;
