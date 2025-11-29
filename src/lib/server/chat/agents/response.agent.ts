import { HumanMessage } from '@langchain/core/messages';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType } from '../state';

const RESPONSE_TEMPLATE = `You are a document-based Q&A assistant. Answer in Korean using markdown format.

## Output Structure
For each topic, use this format:
### [Title]
[Description with citations]

## Rules
- Use ### heading for each topic title
- Write description under each title
- Cite sources inline as [ref:N]
- Bold important terms
{styleGuide}

## Context
{context}

## Question
{query}`;

export async function responseNode(state: AgentGraphStateType) {
	console.log(`[Response] 노드 시작 - chunks: ${state.chunks.length}`);
	console.time('[Response] 소요시간');

	const { chunks, originalQuery, userIntent } = state;

	if (chunks.length === 0) {
		console.log(`[Response] 청크 없음, 기본 응답 반환`);
		console.timeEnd('[Response] 소요시간');
		return {
			finalResponse: '문서에서 관련 정보를 찾을 수 없습니다.',
			suggestions: ['주요 내용을 요약해주세요', '핵심 개념을 설명해주세요'],
			thinkingSteps: [
				{
					type: 'tool_result' as const,
					content: '관련 문서를 찾지 못해 기본 응답을 제공합니다.'
				}
			]
		};
	}

	const llm = createAgentLLM('response');

	const context = chunks.map((c) => `${c.refId} (p.${c.pageNumber}): ${c.content}`).join('\n\n');

	const styleGuide = userIntent ? `\n## Style Guide\n${userIntent}` : '';

	const prompt = RESPONSE_TEMPLATE.replace('{context}', context)
		.replace('{query}', originalQuery)
		.replace('{styleGuide}', styleGuide);

	console.log(`[Response] LLM 호출 중...`);
	const result = await llm.invoke([new HumanMessage(prompt)]);
	const response = typeof result.content === 'string' ? result.content : '';

	console.log(`[Response] 응답 생성 완료 - ${response.length}자`);
	console.timeEnd('[Response] 소요시간');

	return {
		finalResponse: response,
		thinkingSteps: [
			{
				type: 'tool_result' as const,
				content: `${chunks.length}개의 참조 문서를 바탕으로 응답을 작성했습니다.`
			}
		]
	};
}
