import { Command, Send } from '@langchain/langgraph';
import { z } from 'zod';
import { createAgentLLM } from '../llm';
import { getFileContext } from '$lib/server/file.service';
import type { AgentGraphStateType, SubQuery } from '../state';

const DecomposeSchema = z.object({
	isComplex: z.boolean().describe('질문이 여러 개의 별개 주제를 포함하면 true'),
	subQueries: z.array(z.string()).describe('하위 질문 목록, 복합 질문이 아니면 단일 질문')
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

	const docContext = fileContext?.topic ? `문서 주제: ${fileContext.topic}` : '';

	const result = await analyzer.invoke(
		`이 질문을 하위 질문으로 분해해야 하는지 분석하라.

${docContext}

질문: ${state.originalQuery}

규칙:
- 질문이 여러 개의 별개 주제를 다루는 경우에만 isComplex=true로 설정하라
- 주제들이 관련되어 있거나 함께 답할 수 있으면 단일 질문으로 유지하라
- 각 하위 질문은 독립적으로 답변 가능해야 한다
- 원래 언어와 의도를 유지하라
- 최대 5개의 하위 질문`
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
				originalQuery: state.originalQuery,
				fileContext,
				currentSubQueryId: sq.id,
				subQueries: [sq],
				thinkingSteps: []
			})
		)
	});
}
