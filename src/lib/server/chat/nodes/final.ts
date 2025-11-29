import { HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatStateType, DocumentReference, ThinkingStep } from '../state';
import { getAdaptiveChatLLM } from '../llm';
import { expandChunksTool } from '../tools/expand';

function createThinkingStep(type: ThinkingStep['type'], content: string): ThinkingStep {
	return { type, content, timestamp: Date.now() };
}

const FINAL_PROMPT = `당신은 문서와 웹 자료를 종합 분석하는 AI 에이전트입니다.

## 문서: {documentMeta}

### 문서에서 검색된 내용
{documentContext}

### 웹 검색 결과
{webContext}

### 검색 이력
{searchHistory}

{conversationHistory}

## 사용자 질문
{message}

## 답변 규칙
- 마크다운 형식으로 구조화된 답변 작성
- 청크가 문장 중간에 잘렸거나 문맥이 불완전하면 expand_chunks 도구를 사용해 인접 청크를 가져오세요
- 문서 내용 인용 시 본문에 "[ref:X]" 형식으로 참조 번호 표시
- 웹 출처 인용 시 사이트명 언급
- 답변 끝에 별도의 참고 문서 목록을 추가하지 마세요
- 문서와 웹 모두에서 정보를 찾지 못하면 솔직히 한계를 언급

답변:`;

export async function generateFinalResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
	const chunks = state.retrievedChunks;
	console.log(`[FinalResponse] Received ${chunks.length} chunks, searchHistory: ${state.searchHistory.length}`);
	console.log(`[FinalResponse] Chunk IDs: ${chunks.map(c => c.id).join(', ')}`);

	if (chunks.length === 0 && state.webSources.length === 0) {
		return {
			response: '관련 정보를 찾지 못했습니다. 다른 질문을 해보세요.',
			documentReferences: [],
			thinkingSteps: [
				...state.thinkingSteps,
				createThinkingStep('observation', '문서와 웹에서 관련 정보를 찾지 못함')
			],
			currentStage: 'done'
		};
	}

	const documentReferences: DocumentReference[] = chunks.map((c, i) => ({
		id: `ref:${i + 1}`,
		fileName: state.documentMeta || '업로드된 문서',
		pageNumber: c.pageNumber,
		content: c.content,
		relevance: c.similarity
	}));

	const documentContext = chunks.length > 0
		? chunks
			.map((c, i) => `[ref:${i + 1}] (p.${c.pageNumber}) ${c.content}`)
			.join('\n\n')
		: '문서에서 관련 내용을 찾지 못했습니다.';

	const webContext = state.webSources.length > 0
		? state.webSources
			.slice(0, 10)
			.map((s) => {
				const snippetText = s.snippet ? `\n  내용: ${s.snippet}` : '';
				return `- [${s.title}](${s.url})${snippetText}`;
			})
			.join('\n\n')
		: '웹 검색 결과 없음';

	const searchHistory = state.searchHistory.length > 0
		? state.searchHistory
			.map((h, i) => `${i + 1}. "${h.query}" - ${h.reason}`)
			.join('\n')
		: '없음';

	const conversationHistory = state.needsConversationContext
		? state.messages
			.slice(-4)
			.map((m) => `${m.role}: ${m.content}`)
			.join('\n')
		: '';

	console.log(`[FinalResponse] needsConversationContext: ${state.needsConversationContext}, historyLength: ${state.needsConversationContext ? state.messages.slice(-4).length : 0}`);

	const prompt = FINAL_PROMPT
		.replace('{documentMeta}', state.documentMeta || '업로드된 문서')
		.replace('{documentContext}', documentContext)
		.replace('{webContext}', webContext)
		.replace('{searchHistory}', searchHistory)
		.replace('{conversationHistory}', conversationHistory ? `### 이전 대화\n${conversationHistory}\n\n` : '')
		.replace('{message}', state.message);

	const { llm, complexity } = await getAdaptiveChatLLM(state.message);
	const llmWithTools = llm.bindTools([expandChunksTool]);
	console.log(`[FinalResponse] Using ${complexity} complexity model`);

	const messages: BaseMessage[] = [new HumanMessage(prompt)];
	let response = '';
	let iterations = 0;
	const maxIterations = 3;

	while (iterations < maxIterations) {
		iterations++;
		const result = await llmWithTools.invoke(messages);
		messages.push(result);

		if (!result.tool_calls || result.tool_calls.length === 0) {
			response = typeof result.content === 'string' ? result.content : '';
			break;
		}

		console.log(`[FinalResponse] Tool calls: ${result.tool_calls.map((tc) => tc.name).join(', ')}`);

		for (const toolCall of result.tool_calls) {
			if (toolCall.name === 'expand_chunks') {
				const args = toolCall.args as { chunkIds: number[]; range?: number };
				const toolResult = await expandChunksTool.invoke(args);
				messages.push(new ToolMessage({
					tool_call_id: toolCall.id ?? '',
					content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
				}));
				console.log(`[FinalResponse] Expanded chunks for context`);
			}
		}
	}

	let normalizedResponse = response.replace(/\[ref:(\d+)-(\d+)\]/g, (_, start, end) => {
		const refs = [];
		for (let i = parseInt(start); i <= parseInt(end); i++) {
			refs.push(`[ref:${i}]`);
		}
		return refs.join('');
	});

	const citedRefs = [...normalizedResponse.matchAll(/\[ref:(\d+)\]/g)].map((m) => parseInt(m[1]));
	const uniqueCitedRefs = [...new Set(citedRefs)].sort((a, b) => a - b);

	const validRefs = uniqueCitedRefs.filter((ref) => documentReferences[ref - 1]);
	const invalidRefs = uniqueCitedRefs.filter((ref) => !documentReferences[ref - 1]);

	console.log(`[FinalResponse] Cited refs: ${uniqueCitedRefs.join(', ')}, valid: ${validRefs.join(', ')}, invalid: ${invalidRefs.join(', ')}`);

	const refMapping = new Map<number, number>();
	validRefs.forEach((oldRef, i) => refMapping.set(oldRef, i + 1));

	let renumberedResponse = normalizedResponse;
	for (const [oldRef, newRef] of refMapping) {
		renumberedResponse = renumberedResponse.replace(
			new RegExp(`\\[ref:${oldRef}\\]`, 'g'),
			`[ref:${newRef}]`
		);
	}

	for (const invalidRef of invalidRefs) {
		renumberedResponse = renumberedResponse.replace(
			new RegExp(`\\[ref:${invalidRef}\\]`, 'g'),
			''
		);
	}

	const renumberedReferences = validRefs.map((oldRef, i) => ({
		...documentReferences[oldRef - 1],
		id: `ref:${i + 1}`
	}));

	console.log(`[FinalResponse] Cited refs: ${uniqueCitedRefs.join(', ') || 'none'} → 1-${renumberedReferences.length}`);

	const thinkingStep = createThinkingStep(
		'thought',
		`최종 답변 생성 (문서 ${renumberedReferences.length}개 인용, 웹 ${state.webSources.length}개 출처)`
	);

	return {
		response: renumberedResponse,
		documentReferences: renumberedReferences,
		thinkingSteps: [...state.thinkingSteps, thinkingStep],
		currentStage: 'done'
	};
}
