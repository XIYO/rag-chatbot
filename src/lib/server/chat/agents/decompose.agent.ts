import { Command, Send } from '@langchain/langgraph';
import { z } from 'zod';
import { createAgentLLM } from '../llm';
import { getFileContext } from '../retriever';
import type { AgentGraphStateType, SubQuery } from '../state';

const DecomposeSchema = z.object({
	isComplex: z.boolean().describe('true if the question contains multiple distinct topics'),
	subQueries: z.array(z.string()).describe('List of sub-questions, or single question if not complex')
});

export async function decomposeNode(state: AgentGraphStateType) {
	console.log(`[Decompose] 노드 시작 - query: "${state.originalQuery}"`);
	console.time('[Decompose] 소요시간');

	const fileContext = state.fileContext ?? (await getFileContext(state.sessionId));

	const llm = createAgentLLM('research');
	const analyzer = llm.withStructuredOutput(DecomposeSchema);

	const docContext = fileContext?.topic ? `Document topic: ${fileContext.topic}` : '';

	const result = await analyzer.invoke(
		`Analyze if this question needs to be decomposed into sub-questions.

${docContext}

Question: ${state.originalQuery}

Rules:
- Set isComplex=true only if the question asks about MULTIPLE DISTINCT topics
- If topics are related or can be answered together, keep as single question
- Each sub-question should be answerable independently
- Preserve the original language and intent
- Maximum 5 sub-questions`
	);

	console.log(`[Decompose] 분석 결과 - isComplex: ${result.isComplex}, count: ${result.subQueries.length}`);

	const subQueries: SubQuery[] = result.subQueries.map((query, i) => ({
		id: `sq-${i}`,
		query,
		searchQuery: '',
		chunks: [],
		status: 'pending' as const,
		attempts: 0
	}));

	console.timeEnd('[Decompose] 소요시간');

	const thinkingContent = result.isComplex
		? `질문을 ${subQueries.length}개의 하위 질문으로 분해합니다: ${subQueries.map((q) => `"${q.query}"`).join(', ')}`
		: `단일 질문으로 처리합니다: "${state.originalQuery}"`;

	return new Command({
		update: {
			fileContext,
			subQueries,
			thinkingSteps: [{ type: 'reasoning' as const, content: thinkingContent }]
		},
		goto: subQueries.map((sq) =>
			new Send('searchEvaluate', {
				sessionId: state.sessionId,
				originalQuery: state.originalQuery,
				fileContext,
				currentSubQueryId: sq.id,
				subQueries: [sq],
				thinkingSteps: []
			})
		)
	});
}
