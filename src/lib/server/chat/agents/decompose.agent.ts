import { Command, Send } from '@langchain/langgraph';
import { z } from 'zod';
import { createAgentLLM } from '../llm';
import { getFileContext } from '$lib/server/file.service';
import type { AgentGraphStateType, SubQuery } from '../state';

const DecomposeSchema = z.object({
	isComplex: z.boolean().describe('true if question contains multiple distinct topics'),
	subQueries: z.array(z.string()).describe('list of sub-questions, single question if not complex')
});

/**
 * 질문을 분석하여 하위 질문으로 분해한다.
 * 복합 질문인 경우 각 하위 질문을 병렬로 처리하도록 Send 명령을 생성한다.
 * @param state 그래프 상태
 * @returns Command 객체
 */
export async function decomposeNode(state: AgentGraphStateType) {
	const fileContext = state.fileContext ?? (await getFileContext());

	const llm = createAgentLLM('research');
	const analyzer = llm.withStructuredOutput(DecomposeSchema);

	const docContext = fileContext?.topic ? `Document topic: ${fileContext.topic}` : '';

	const result = await analyzer.invoke(
		`Determine whether to decompose the question.

${docContext}

Question: ${state.originalQuery}

isComplex=true when:
- Multiple distinct topics connected by "and", "or", conjunctions
- Comma-separated items asking about different things

isComplex=false when:
- Single topic question
- Simple information request
- Explanation of one concept

Strictly forbidden:
- Do NOT expand or interpret the question beyond its literal meaning
- Do NOT add context not present in the original question
- Put the original question as-is into subQueries`
	);

	const subQueries: SubQuery[] = result.subQueries.map((query, i) => ({
		id: `sq-${i}`,
		query,
		searchQuery: '',
		chunks: [],
		status: 'pending' as const,
		attempts: 0
	}));

	const thinkingContent = result.isComplex
		? `Decomposing into ${subQueries.length} sub-questions: ${subQueries.map((q) => `"${q.query}"`).join(', ')}`
		: `Processing as single question: "${state.originalQuery}"`;

	return new Command({
		update: {
			fileContext,
			subQueries,
			thinkingSteps: [{ type: 'reasoning' as const, content: thinkingContent }]
		},
		goto: subQueries.map((sq) =>
			new Send('searchEvaluate', {
				originalQuery: state.originalQuery,
				fileContext,
				currentSubQueryId: sq.id,
				subQueries: [sq],
				thinkingSteps: []
			})
		)
	});
}
