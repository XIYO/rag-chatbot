import { GoogleGenerativeAI } from '@google/generative-ai';
import { GOOGLE_API_KEY } from '$env/static/private';

export interface WebSource {
	url: string;
	title: string;
	snippet?: string;
}

export interface WebSearchResult {
	answer: string;
	sources: WebSource[];
	searchQueries: string[];
}

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const searchModel = genAI.getGenerativeModel(
	{
		model: 'gemini-2.5-flash',
		// @ts-expect-error googleSearch is a beta feature not in type definitions
		tools: [{ googleSearch: {} }]
	},
	{ apiVersion: 'v1beta' }
);

export async function webSearchWithGemini(query: string): Promise<WebSearchResult> {
	try {
		console.log('[WebSearch] Searching:', query);

		const result = await searchModel.generateContent(query);
		const response = result.response;
		const answer = response.text();

		const groundingMetadata = response.candidates?.[0]?.groundingMetadata as {
			groundingChunks?: { web?: { uri: string; title?: string } }[];
			groundingSupports?: {
				segment?: { text: string };
				groundingChunkIndices?: number[];
			}[];
			webSearchQueries?: string[];
		} | undefined;

		const rawSources: { url: string; title: string; snippets: string[] }[] = [];

		if (groundingMetadata?.groundingChunks) {
			for (const chunk of groundingMetadata.groundingChunks) {
				if (chunk.web?.uri) {
					rawSources.push({
						url: chunk.web.uri,
						title: chunk.web.title || '',
						snippets: []
					});
				}
			}
		}

		if (groundingMetadata?.groundingSupports) {
			for (const support of groundingMetadata.groundingSupports) {
				const text = support.segment?.text;
				const indices = support.groundingChunkIndices;
				if (text && indices) {
					for (const idx of indices) {
						if (rawSources[idx]) {
							rawSources[idx].snippets.push(text);
						}
					}
				}
			}
		}

		const searchQueries = groundingMetadata?.webSearchQueries ?? [];
		console.log('[WebSearch] Found', rawSources.length, 'sources');

		const sources: WebSource[] = rawSources.map((s) => ({
			url: s.url,
			title: s.title || new URL(s.url).hostname,
			snippet: s.snippets.length > 0 ? s.snippets.join(' ') : undefined
		}));

		return { answer, sources, searchQueries };
	} catch (error) {
		console.error('[WebSearch] Error:', error);
		return { answer: '', sources: [], searchQueries: [] };
	}
}
