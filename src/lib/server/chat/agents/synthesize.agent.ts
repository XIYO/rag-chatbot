import { HumanMessage } from '@langchain/core/messages';
import { createAgentLLM } from '../llm';
import type { AgentGraphStateType, DocumentChunk } from '../state';

const RESPONSE_TEMPLATE = `당신은 문서 기반 Q&A 어시스턴트다. 마크다운 형식으로 한국어로 답변하라.

## 출력 구조
각 주제에 대해 다음 형식을 사용하라:
### [제목]
[인용이 포함된 설명]

## 규칙
- 각 주제 제목에 ### 헤딩을 사용하라
- 각 제목 아래에 설명을 작성하라
- 컨텍스트에 제공된 대로 정확히 [ref:N] 형식으로 인라인 인용하라
- 중요한 용어는 굵게 표시하라
{styleGuide}

## 하위 질문과 컨텍스트
{subQueryContexts}

## 원본 질문
{query}`;

export async function synthesizeNode(state: AgentGraphStateType) {
	console.log(`[Synthesize] 노드 시작 - subQueries: ${state.subQueries.length}`);
	console.time('[Synthesize] 소요시간');

	const { subQueries, originalQuery, userIntent } = state;

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
			subQueryContexts.push(`### ${sq.query}\n(검색 결과 없음)`);
		}
	}

	if (allChunks.length === 0) {
		console.log(`[Synthesize] 모든 서브쿼리에서 결과 없음`);
		console.timeEnd('[Synthesize] 소요시간');
		return {
			chunks: [],
			finalResponse: '문서에서 관련 정보를 찾을 수 없습니다.',
			thinkingSteps: [
				{
					type: 'tool_result' as const,
					content: '모든 검색에서 관련 문서를 찾지 못했습니다.'
				}
			]
		};
	}

	const llm = createAgentLLM('response');
	const styleGuide = userIntent ? `\n## 스타일 가이드\n${userIntent}` : '';

	const prompt = RESPONSE_TEMPLATE
		.replace('{subQueryContexts}', subQueryContexts.join('\n\n'))
		.replace('{query}', originalQuery)
		.replace('{styleGuide}', styleGuide);

	console.log(`[Synthesize] LLM 호출 중...`);
	const result = await llm.invoke([new HumanMessage(prompt)]);
	const response = typeof result.content === 'string' ? result.content : '';

	console.log(`[Synthesize] 응답 생성 완료 - ${response.length}자`);
	console.timeEnd('[Synthesize] 소요시간');

	const successCount = subQueries.filter((q) => q.status === 'done' && q.chunks.length > 0).length;

	return {
		chunks: allChunks,
		finalResponse: response,
		thinkingSteps: [
			{
				type: 'tool_result' as const,
				content: `${subQueries.length}개 질문 중 ${successCount}개에서 ${allChunks.length}개의 참조를 찾아 응답을 생성했습니다.`
			}
		]
	};
}
