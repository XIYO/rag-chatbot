import { z } from 'zod';
import type { ChatStateType, ThinkingStep, AgentAction, SearchQuery } from '../state';
import { validationLLM } from '../llm';

const MAX_ITERATIONS = 5;

const PlanSchema = z.object({
	action: z.enum(['vector_search', 'web_search', 'generate']),
	searchQuery: z.string().describe('검색 쿼리 (vector_search일 때만 사용, 그 외에는 빈 문자열)'),
	reason: z.string()
});

function createThinkingStep(type: ThinkingStep['type'], content: string): ThinkingStep {
	return { type, content, timestamp: Date.now() };
}

function buildContext(state: ChatStateType): string {
	const parts: string[] = [];

	if (state.searchHistory.length > 0) {
		const history = state.searchHistory
			.map((h, i) => `${i + 1}. "${h.query}" - ${h.reason}`)
			.join('\n');
		parts.push(`검색 이력 (${state.searchHistory.length}회 검색):\n${history}`);
	}

	if (state.retrievedChunks.length > 0) {
		const chunks = state.retrievedChunks
			.slice(0, 5)
			.map((c) => `[p.${c.pageNumber}] ${c.content.slice(0, 200)}...`)
			.join('\n\n');
		parts.push(`문서에서 수집된 정보 (${state.retrievedChunks.length}개 청크):\n${chunks}`);
	} else {
		parts.push('문서에서 수집된 정보: 없음 (관련 내용이 문서에 없을 수 있음)');
	}

	if (state.webSources.length > 0) {
		const sources = state.webSources
			.slice(0, 5)
			.map((s) => `- ${s.title}`)
			.join('\n');
		parts.push(`웹 검색 결과 (${state.webSources.length}개 출처):\n${sources}`);
	}

	return parts.join('\n\n---\n\n') || '아직 수집된 정보 없음';
}

const PLAN_PROMPT = `당신은 질문에 답하기 위해 정보를 수집하는 AI 에이전트입니다.
현재 상태를 분석하고 다음에 어떤 행동을 할지 결정하세요.

## 사용자 질문
{question}

## 문서 정보
{documentMeta}

## 현재까지 수집된 정보
{context}

## 반복 횟수
{iteration}/${MAX_ITERATIONS}

## 가능한 행동
1. vector_search: 문서에서 특정 정보를 검색 (검색 쿼리 필요)
2. web_search: 웹에서 추가 정보 검색 (문서에 없거나 최신 정보 필요시)
3. generate: 충분한 정보가 모였으니 답변 생성

## 결정 기준
- 문서에서 찾을 수 있는 정보라면 vector_search
- 문서에 없거나 최신/외부 정보 필요시 web_search
- 질문에 답하기 충분한 정보가 모였으면 generate
- 최대 반복 횟수에 도달하면 generate 선택

## 중요: 반복 검색 금지 & 웹 검색 전환
- **같은 쿼리로 이미 검색했다면 절대 다시 검색하지 마세요**
- 검색 이력을 확인하고, 이미 검색한 쿼리와 유사하면 다른 행동 선택
- 2회 이상 검색했는데 원하는 정보가 없으면 → web_search로 전환

## 복합 질문 처리 (반드시 따르세요)
- 질문에 여러 주제가 있으면 **각각 판단**
- 예: "에이전트 정의와 GPT-5 기능" → "에이전트 정의"는 문서에 있을 수 있음, GPT-5는 최신 정보
- **일반 개념/정의** → vector_search 먼저 시도
- **특정 제품/서비스 최신 정보** (GPT-5, Claude 4 등) → web_search
- 문서에서 찾을 수 있는 부분을 먼저 검색 후, 웹 검색 진행

## 최신 정보 판단
- **2024년, 2025년 이후 정보** → web_search
- **전망, 예측, 최신 동향** 키워드 → web_search 우선
- 단, 질문의 일부가 문서에 있을 수 있다면 vector_search 먼저

## 검색 쿼리 작성
- searchQuery는 **문서에서 찾을 실제 내용**을 영어로 작성
- "previous answer", "earlier response" 같은 메타 표현 금지

JSON 형식으로 응답:
{
  "action": "vector_search" | "web_search" | "generate",
  "searchQuery": "검색할 쿼리 (vector_search일 때만 입력, 나머지는 빈 문자열)",
  "reason": "이 행동을 선택한 이유 (한글, 1문장)"
}`;

export async function agentPlan(state: ChatStateType): Promise<Partial<ChatStateType>> {
	const iteration = state.iterationCount + 1;

	if (iteration > MAX_ITERATIONS) {
		console.log(`[AgentPlan] Max iterations reached, forcing generate`);
		return {
			nextAction: 'generate',
			iterationCount: iteration,
			thinkingSteps: [
				...state.thinkingSteps,
				createThinkingStep('thought', `최대 반복 횟수 도달, 답변 생성으로 전환`)
			]
		};
	}

	const context = buildContext(state);
	const prompt = PLAN_PROMPT
		.replace('{question}', state.message)
		.replace('{documentMeta}', state.documentMeta || '업로드된 문서')
		.replace('{context}', context)
		.replace('{iteration}', String(iteration));

	try {
		const structuredLLM = validationLLM.withStructuredOutput(PlanSchema);
		const plan = await structuredLLM.invoke(prompt);

		console.log(`[AgentPlan] Iteration ${iteration}: ${plan.action} - ${plan.reason}`);

		const thinkingStep = createThinkingStep(
			'thought',
			`[${iteration}/${MAX_ITERATIONS}] ${plan.reason}`
		);

		const result: Partial<ChatStateType> = {
			nextAction: plan.action as AgentAction,
			iterationCount: iteration,
			thinkingSteps: [...state.thinkingSteps, thinkingStep]
		};

		if (plan.action === 'vector_search' && plan.searchQuery.trim()) {
			const searchQuery: SearchQuery = {
				query: plan.searchQuery.trim(),
				reason: plan.reason
			};
			result.pendingSearchQuery = searchQuery;
		}

		return result;
	} catch (error) {
		console.error('[AgentPlan] Failed:', error);
		return {
			nextAction: state.retrievedChunks.length > 0 ? 'generate' : 'vector_search',
			iterationCount: iteration
		};
	}
}

export function routeAfterPlan(state: ChatStateType): 'vectorSearch' | 'searchWebWithReliability' | 'generateFinalResponse' {
	switch (state.nextAction) {
		case 'vector_search':
			return 'vectorSearch';
		case 'web_search':
			return 'searchWebWithReliability';
		case 'generate':
		default:
			return 'generateFinalResponse';
	}
}
