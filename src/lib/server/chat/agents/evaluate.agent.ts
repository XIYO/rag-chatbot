import { Command } from '@langchain/langgraph';
import { z } from 'zod';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, EvaluationFeedback } from '../state';

const MIN_CHUNKS = 2;
const MAX_ATTEMPTS = 2;

const FeedbackSchema = z.object({
	worthRetrying: z.boolean().describe('true if retry could yield better results, false if question is unanswerable from document (off-topic, personal, etc.)'),
	reason: z.string().describe('Why the current results are insufficient'),
	suggestion: z.string().describe('Specific suggestion for improving the search query'),
	reasonKorean: z.string().describe('Brief explanation in Korean')
});

export async function evaluateNode(state: AgentGraphStateType) {
	console.log(`[Evaluate] 노드 시작 - chunks: ${state.chunks.length}, attempts: ${state.searchAttempts}`);

	const { chunks, searchQuery, originalQuery, searchAttempts, fileContext } = state;

	if (chunks.length >= MIN_CHUNKS) {
		console.log(`[Evaluate] 충분한 결과 -> response로 이동`);
		return new Command({
			update: {
				evaluationFeedback: null,
				thinkingSteps: [
					{
						type: 'tool_result' as const,
						content: `${chunks.length}개의 충분한 검색 결과를 확보했습니다. 응답을 생성합니다.`
					}
				]
			},
			goto: 'response'
		});
	}

	if (searchAttempts >= MAX_ATTEMPTS) {
		console.log(`[Evaluate] 최대 시도 횟수 도달 -> response로 이동`);
		const resultDesc = chunks.length > 0 ? `${chunks.length}개의 결과만` : '결과를';
		return new Command({
			update: {
				evaluationFeedback: null,
				thinkingSteps: [
					{
						type: 'tool_result' as const,
						content: `최대 재시도 횟수에 도달했습니다. ${resultDesc} 사용하여 응답을 생성합니다.`
					}
				]
			},
			goto: 'response'
		});
	}

	console.log(`[Evaluate] 결과 부족, 피드백 생성 중...`);
	const llm = createAgentLLM('evaluator');
	const analyzer = llm.withStructuredOutput(FeedbackSchema);

	const resultsPreview = chunks
		.slice(0, 3)
		.map((c) => c.content.slice(0, 150))
		.join('\n---\n');

	const docContext = fileContext?.topic ? `Document topic: ${fileContext.topic}` : '';

	const { worthRetrying, reason, suggestion, reasonKorean } = await analyzer.invoke(
		`Evaluate if retrying the search would yield better results.

${docContext}

Original question: ${originalQuery}
Search query: ${searchQuery}
Results found: ${chunks.length}

Results preview:
${resultsPreview || 'No results'}

Set worthRetrying:
- true: if the question relates to the document topic and a better query might help
- false: if the question has no relation to the document topic

reasonKorean: brief Korean explanation of your decision`
	);

	if (!worthRetrying) {
		console.log(`[Evaluate] 재검색 가치 없음 -> response로 이동`);
		return new Command({
			update: {
				evaluationFeedback: null,
				thinkingSteps: [
					{
						type: 'tool_result' as const,
						content: reasonKorean
					}
				]
			},
			goto: 'response'
		});
	}

	const feedback: EvaluationFeedback = {
		previousQuery: searchQuery,
		chunkCount: chunks.length,
		reason,
		suggestion
	};

	console.log(`[Evaluate] 피드백: ${suggestion} -> search로 이동`);

	return new Command({
		update: {
			evaluationFeedback: feedback,
			thinkingSteps: [
				{
					type: 'tool_result' as const,
					content: `검색 결과가 부족합니다. ${reasonKorean} 질의를 개선하여 다시 검색합니다.`
				}
			]
		},
		goto: 'search'
	});
}
