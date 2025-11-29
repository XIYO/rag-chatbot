import { ChatOpenAI } from '@langchain/openai';
import { LLM_API_KEY, LLM_CHAT_MODEL } from '$env/static/private';

interface LLMConfig {
	temperature: number;
	maxTokens?: number;
	model?: string;
}

const AGENT_CONFIG: Record<string, LLMConfig> = {
	research: { temperature: 0, maxTokens: 500 },
	evaluator: { temperature: 0, maxTokens: 500 },
	response: { temperature: 0.7, maxTokens: 2000 },
	validation: { temperature: 0, maxTokens: 200, model: 'gpt-4o-mini' }
};

export function createAgentLLM(agentType: keyof typeof AGENT_CONFIG) {
	const config = AGENT_CONFIG[agentType];
	return new ChatOpenAI({
		apiKey: LLM_API_KEY,
		model: config.model || LLM_CHAT_MODEL,
		temperature: config.temperature,
		maxTokens: config.maxTokens
	});
}

export const validationLLM = createAgentLLM('validation');
