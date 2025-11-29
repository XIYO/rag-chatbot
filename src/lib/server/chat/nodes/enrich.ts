import type { ChatStateType, ThinkingStep, GlossaryTerm } from '../state';
import { validationLLM, getChatLLMByComplexity } from '../llm';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GOOGLE_API_KEY } from '$env/static/private';
import { z } from 'zod';

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const searchModel = genAI.getGenerativeModel(
	{
		model: 'gemini-2.5-flash',
		// @ts-expect-error googleSearch is a beta feature
		tools: [{ googleSearch: {} }]
	},
	{ apiVersion: 'v1beta' }
);

function createThinkingStep(type: ThinkingStep['type'], content: string): ThinkingStep {
	return { type, content, timestamp: Date.now() };
}

const TermExtractionSchema = z.object({
	terms: z.array(z.object({
		term: z.string(),
		reason: z.string()
	}))
});

async function extractDifficultTerms(response: string): Promise<Array<{ term: string; reason: string }>> {
	const prompt = `다음 텍스트에서 일반 독자가 이해하기 어려울 수 있는 전문 용어나 개념을 추출하세요.

텍스트:
${response}

추출 기준:
- 기술/학술 전문 용어
- 영어 약어 (API, SDK 등)
- 업계 특수 용어
- 개념적 설명이 필요한 단어

주의:
- 일반적인 단어는 제외 (문서, 검색, 데이터, 효율성 등)
- 이미 텍스트에서 충분히 설명된 용어는 제외
- 최대 3개까지만 추출
- 용어가 없으면 빈 배열 반환

JSON 형식:
{
  "terms": [
    { "term": "용어", "reason": "왜 설명이 필요한지" }
  ]
}`;

	try {
		const structuredLLM = validationLLM.withStructuredOutput(TermExtractionSchema);
		const result = await structuredLLM.invoke(prompt);
		return result.terms;
	} catch {
		return [];
	}
}

async function searchTermDefinition(term: string): Promise<string> {
	try {
		const result = await searchModel.generateContent(
			`"${term}"의 정의를 한 문장으로 간결하게 설명하세요.`
		);
		const answer = result.response.text().trim();
		return answer.length > 150 ? answer.slice(0, 150) + '...' : answer;
	} catch {
		return '';
	}
}

export async function enrichResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
	if (!state.response || state.response.length < 50) {
		return {};
	}

	console.log('[Enrich] Analyzing response for difficult terms');
	const thinkingSteps: ThinkingStep[] = [];

	const difficultTerms = await extractDifficultTerms(state.response);

	if (difficultTerms.length === 0) {
		console.log('[Enrich] No difficult terms found');
		return {};
	}

	console.log(`[Enrich] Found ${difficultTerms.length} terms: ${difficultTerms.map(t => t.term).join(', ')}`);
	thinkingSteps.push(createThinkingStep('action', `어려운 용어 ${difficultTerms.length}개 발견: ${difficultTerms.map(t => t.term).join(', ')}`));

	const glossary: GlossaryTerm[] = [];
	for (const { term, reason } of difficultTerms.slice(0, 3)) {
		const definition = await searchTermDefinition(term);
		if (definition) {
			glossary.push({ term, definition, reason });
		}
	}
	console.log(`[Enrich] Got definitions for ${glossary.length} terms`);

	if (glossary.length === 0) {
		return {};
	}

	thinkingSteps.push(createThinkingStep('observation', `${glossary.length}개 용어에 대한 설명 검색 완료`));

	let enrichedResponse = state.response;

	for (let i = 0; i < glossary.length; i++) {
		const { term } = glossary[i];
		const footnoteNum = i + 1;
		const regex = new RegExp(`(?<!\\[)${escapeRegex(term)}(?!\\])`, 'g');
		let replaced = false;
		enrichedResponse = enrichedResponse.replace(regex, (match) => {
			if (!replaced) {
				replaced = true;
				return `${match}[^${footnoteNum}]`;
			}
			return match;
		});
	}

	const footnotes = glossary
		.map((g, i) => `[^${i + 1}]: **${g.term}** - ${g.definition}`)
		.join('\n');

	enrichedResponse = `${enrichedResponse}\n\n---\n**용어 설명**\n${footnotes}`;

	return {
		response: enrichedResponse,
		glossary,
		thinkingSteps: [...state.thinkingSteps, ...thinkingSteps]
	};
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
