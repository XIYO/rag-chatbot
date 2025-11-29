import { Annotation } from '@langchain/langgraph';

export interface ThinkingStep {
	type: 'tool_call' | 'tool_result' | 'reasoning';
	content: string;
}

export interface DocumentChunk {
	refId: string;
	content: string;
	pageNumber: number;
}

export interface DocumentReference {
	id: string;
	pageNumber: number;
	content: string;
	cited: boolean;
}

export interface EvaluationFeedback {
	previousQuery: string;
	chunkCount: number;
	reason: string;
	suggestion: string;
}

export interface FileContext {
	topic: string | null;
	context: string | null;
}

export const AgentGraphState = Annotation.Root({
	sessionId: Annotation<string>({
		reducer: (prev, next) => next ?? prev,
		default: () => ''
	}),

	originalQuery: Annotation<string>({
		reducer: (_, next) => next,
		default: () => ''
	}),

	searchQuery: Annotation<string>({
		reducer: (_, next) => next,
		default: () => ''
	}),

	userIntent: Annotation<string>({
		reducer: (_, next) => next,
		default: () => ''
	}),

	fileContext: Annotation<FileContext | null>({
		reducer: (_, next) => next,
		default: () => null
	}),

	chunks: Annotation<DocumentChunk[]>({
		reducer: (_, next) => next,
		default: () => []
	}),

	evaluationFeedback: Annotation<EvaluationFeedback | null>({
		reducer: (_, next) => next,
		default: () => null
	}),

	searchAttempts: Annotation<number>({
		reducer: (_, next) => next,
		default: () => 0
	}),

	thinkingSteps: Annotation<ThinkingStep[]>({
		reducer: (prev, next) => {
			if (next.length === 0) return [];
			return [...prev, ...next];
		},
		default: () => []
	}),

	finalResponse: Annotation<string>({
		reducer: (_, next) => next,
		default: () => ''
	})
});

export type AgentGraphStateType = typeof AgentGraphState.State;
