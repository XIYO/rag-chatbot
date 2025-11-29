import type { ChatStateType } from '../state';
import { validationLLM } from '../llm';
import { supabase } from '$lib/supabase';
import { z } from 'zod';

const IntentSchema = z.object({
	needsContext: z.boolean().describe('이전 대화 컨텍스트가 필요한지 여부'),
	intent: z.enum(['follow_up', 'new_question', 'invalid']).describe('질문 유형'),
	reason: z.string().describe('판단 이유')
});

const QueryRewriteSchema = z.object({
	isValid: z.boolean(),
	reason: z.enum(['valid', 'meaningless', 'off_topic', 'unclear']),
	rewrittenQuery: z.string()
});

async function getDocumentContext(sessionId: string) {
	const { data } = await supabase
		.from('chat_files')
		.select('files(topic, context)')
		.eq('chat_id', sessionId);

	if (!data || data.length === 0) return null;

	const contexts = data
		.map((row) => {
			const file = row.files as { topic: string; context: string } | null;
			if (!file?.topic) return null;
			return `주제: ${file.topic}\n범위: ${file.context}`;
		})
		.filter(Boolean);

	return contexts.length > 0 ? contexts.join('\n\n') : null;
}

async function analyzeIntent(message: string): Promise<{ needsContext: boolean; intent: string }> {
	const prompt = `사용자 입력의 의도를 분석하세요.

입력: "${message}"

## 판단 기준
- follow_up: 이전 대화 참조 필요 (다시, 그거, 이거, 아까, 더 자세히, 요약, 뭐야 등)
- new_question: 독립적인 새 질문 (이전 대화 없이 이해 가능)
- invalid: 의미 없는 입력 (ㅋㅋ, 안녕, asdf 등)

JSON 응답:
- needsContext: follow_up이면 true, 아니면 false
- intent: follow_up | new_question | invalid
- reason: 판단 이유 (한글, 짧게)`;

	try {
		const structuredLLM = validationLLM.withStructuredOutput(IntentSchema);
		const result = await structuredLLM.invoke(prompt);
		console.log(`[Intent] ${result.intent}: ${result.reason}`);
		return { needsContext: result.needsContext, intent: result.intent };
	} catch {
		return { needsContext: false, intent: 'new_question' };
	}
}

export async function rewriteQuery(state: ChatStateType): Promise<Partial<ChatStateType>> {
	const { needsContext, intent } = await analyzeIntent(state.message);

	if (intent === 'invalid') {
		console.log('[rewriteQuery] Invalid input detected');
		return {
			rewrittenQuery: '',
			response: '질문을 이해하지 못했습니다. 문서에 대해 구체적인 질문을 해주세요.',
			currentStage: 'invalid'
		};
	}

	const documentContext = await getDocumentContext(state.sessionId);

	const conversationContext = needsContext
		? state.messages
			.slice(-6)
			.map((m) => `${m.role}: ${m.content}`)
			.join('\n')
		: '';

	console.log(`[rewriteQuery] needsContext: ${needsContext}, historyLength: ${conversationContext ? state.messages.slice(-6).length : 0}`);

	const documentSection = documentContext
		? `## 문서 정보\n${documentContext}\n\n`
		: '';

	const conversationSection = conversationContext
		? `## 대화 이력 (이전 대화 참조 질문)\n${conversationContext}\n\n`
		: '';

	const prompt = `${documentSection}${conversationSection}## 현재 입력
${state.message}

## 작업
검색용 영어 질문으로 재작성하세요.

${needsContext ? `## 중요: 이전 대화 참조 (반드시 따르세요)
대화 이력에서 **실제 주제**를 찾아서 재작성하세요.
- "다시", "한번더", "이전 답변" → 이전 user 질문의 **주제**로 재작성 (예: 이전이 "에이전트 정의"였다면 → "AI agent definition")
- "더 자세히" → 이전 주제 + "detailed explanation"
- "그거 뭐야" → 이전 답변에서 언급된 **구체적인 용어**에 대한 질문

절대로 "previous answer", "earlier response" 같은 메타 표현을 쿼리로 쓰지 마세요.
실제 검색할 **문서 내용의 주제**로 변환하세요.` : ''}

## 검색 쿼리 규칙
- rewrittenQuery는 반드시 영어로 작성
- 예: "AI 에이전트 정의" → "What is AI Agent definition"

## 유효성 판단
- meaningless: 의미 없는 입력
- off_topic: 문서 주제와 무관
- unclear: 이전 대화 없이 대명사만 사용
- valid: 유효한 질문`;

	const structuredLLM = validationLLM.withStructuredOutput(QueryRewriteSchema);
	const result = await structuredLLM.invoke(prompt);

	console.log('[rewriteQuery] result:', result);

	if (!result.isValid) {
		return {
			rewrittenQuery: '',
			response: getInvalidQueryMessage(result.reason),
			currentStage: 'invalid'
		};
	}

	return {
		rewrittenQuery: result.rewrittenQuery,
		currentStage: 'rewrite',
		needsConversationContext: needsContext
	};
}

function getInvalidQueryMessage(reason: string) {
	switch (reason) {
		case 'meaningless':
			return '질문을 이해하지 못했습니다. 문서에 대해 구체적인 질문을 해주세요.';
		case 'off_topic':
			return '업로드된 문서와 관련 없는 질문입니다. 문서 내용에 대해 질문해주세요.';
		case 'unclear':
			return '질문이 불명확합니다. 좀 더 구체적으로 질문해주세요.';
		default:
			return '질문을 처리할 수 없습니다. 다시 시도해주세요.';
	}
}

export function routeAfterRewrite(state: ChatStateType): 'agentPlan' | 'noResultResponse' {
	if (state.currentStage === 'invalid') {
		return 'noResultResponse';
	}
	return 'agentPlan';
}
