import { HumanMessage } from '@langchain/core/messages';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, DocumentChunk } from '../state';

const RESPONSE_TEMPLATE = `You are a document-based Q&A assistant. Answer in Korean using markdown format.

## Output structure
For each topic, use the following format:
### [Title]
[Explanation with citations]

## Rules
- Use ### headings for each topic title
- Write explanations under each title
- Use inline citations exactly as [ref:N] format provided in the context
- Bold important terms
{styleGuide}

## Sub-questions and context
{subQueryContexts}

## Original question
{query}`;

/**
 * 검색 결과를 종합하여 최종 응답을 생성한다.
 * 모든 하위 질문의 결과를 통합하고 인용 번호를 재할당한다.
 * @param state 그래프 상태
 * @returns 최종 응답과 청크 정보
 */
export async function synthesizeNode(state: AgentGraphStateType) {
	const { subQueries, originalQuery, userIntent, finalResponse } = state;

	if (finalResponse) {
		return {};
	}

	const allChunks: DocumentChunk[] = [];
	const subQueryContexts: string[] = [];
	let refCounter = 1;

	for (const sq of subQueries) {
		if (sq.chunks.length > 0) {
			const remappedChunks = sq.chunks.map((c) => ({
				...c,
				refId: `[ref:${refCounter++}]`
			}));
			allChunks.push(...remappedChunks);
			const context = remappedChunks
				.map((c) => `${c.refId} (p.${c.pageNumber}): ${c.content}`)
				.join('\n');
			subQueryContexts.push(`### ${sq.query}\n${context}`);
		} else {
			subQueryContexts.push(`### ${sq.query}\n(No search results)`);
		}
	}

	if (allChunks.length === 0) {
		return {
			chunks: [],
			finalResponse: 'No relevant information found in documents.',
			thinkingSteps: [
				{
					type: 'tool_result' as const,
					content: 'No relevant documents found in any search.'
				}
			]
		};
	}

	const llm = createAgentLLM('response');
	const styleGuide = userIntent ? `\n## Style guide\n${userIntent}` : '';

	const prompt = RESPONSE_TEMPLATE
		.replace('{subQueryContexts}', subQueryContexts.join('\n\n'))
		.replace('{query}', originalQuery)
		.replace('{styleGuide}', styleGuide);

	const result = await llm.invoke([new HumanMessage(prompt)]);
	const response = typeof result.content === 'string' ? result.content : '';

	const successCount = subQueries.filter((q) => q.status === 'done' && q.chunks.length > 0).length;

	return {
		chunks: allChunks,
		finalResponse: response,
		thinkingSteps: [
			{
				type: 'tool_result' as const,
				content: `Generated response with ${allChunks.length} references from ${successCount} of ${subQueries.length} questions.`
			}
		]
	};
}
