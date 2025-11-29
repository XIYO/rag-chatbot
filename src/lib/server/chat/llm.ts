import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import {
	LLM_API_KEY,
	LLM_CHAT_MODEL,
	MODEL_LOW,
	MODEL_MEDIUM,
	MODEL_HIGH
} from '$env/static/private';

export const validationLLM = new ChatOpenAI({
	apiKey: LLM_API_KEY,
	model: 'gpt-4o-mini',
	temperature: 0
});

export const chatLLM = new ChatOpenAI({
	apiKey: LLM_API_KEY,
	model: LLM_CHAT_MODEL,
	temperature: 0.7
});

const ComplexitySchema = z.object({
	complexity: z.enum(['LOW', 'MEDIUM', 'HIGH'])
});

export type Complexity = z.infer<typeof ComplexitySchema>['complexity'];

const MODEL_MAP: Record<Complexity, string> = {
	LOW: MODEL_LOW || 'gpt-4o-mini',
	MEDIUM: MODEL_MEDIUM || 'gpt-4o',
	HIGH: MODEL_HIGH || 'gpt-4o'
};

const COMPLEXITY_PROMPT = `Evaluate the complexity of the user's question.

Question: {question}

Criteria:
- LOW: Simple definitions, concept explanations, yes/no questions
- MEDIUM: Comparisons, pros/cons analysis, general explanations
- HIGH: In-depth analysis, strategy recommendations, multi-perspective review, expert knowledge required`;

export async function analyzeComplexity(question: string): Promise<Complexity> {
	const structuredLLM = validationLLM.withStructuredOutput(ComplexitySchema);
	const result = await structuredLLM.invoke(COMPLEXITY_PROMPT.replace('{question}', question));
	return result.complexity;
}

export function getChatLLMByComplexity(complexity: Complexity) {
	return new ChatOpenAI({
		apiKey: LLM_API_KEY,
		model: MODEL_MAP[complexity],
		temperature: complexity === 'HIGH' ? 0.7 : 0.5
	});
}

export async function getAdaptiveChatLLM(question: string) {
	const complexity = await analyzeComplexity(question);
	console.log(`[LLM] Question complexity: ${complexity} → Model: ${MODEL_MAP[complexity]}`);
	return {
		llm: getChatLLMByComplexity(complexity),
		complexity
	};
}
