import { Annotation } from '@langchain/langgraph';

/** 사고 과정 단계 */
export interface ThinkingStep {
	type: 'tool_call' | 'tool_result' | 'reasoning';
	content: string;
}

/** 검색된 문서 청크 */
export interface DocumentChunk {
	refId: string;
	content: string;
	pageNumber: number;
}

/** 문서 참조 정보 */
export interface DocumentReference {
	id: string;
	pageNumber: number;
	content: string;
	cited: boolean;
}

/** 검색 결과 평가 피드백 */
export interface EvaluationFeedback {
	previousQuery: string;
	chunkCount: number;
	reason: string;
	suggestion: string;
}

/** 하위 질문 */
export interface SubQuery {
	id: string;
	query: string;
	searchQuery: string;
	chunks: DocumentChunk[];
	status: 'pending' | 'searching' | 'done' | 'failed';
	attempts: number;
}

/** 파일 컨텍스트 정보 */
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

	subQueries: Annotation<SubQuery[]>({
		reducer: (prev, next) => {
			if (next.length === 0) return prev;
			const map = new Map(prev.map((q) => [q.id, q]));
			for (const q of next) {
				map.set(q.id, q);
			}
			return Array.from(map.values());
		},
		default: () => []
	}),

	currentSubQueryId: Annotation<string | null>({
		reducer: (_, next) => next,
		default: () => null
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
