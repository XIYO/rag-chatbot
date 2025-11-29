const JINA_READER_URL = 'https://r.jina.ai/';
const MAX_CONTENT_LENGTH = 8000;

export interface ExtractedContent {
	url: string;
	content: string;
	success: boolean;
}

export async function extractContent(url: string): Promise<ExtractedContent> {
	try {
		const response = await fetch(JINA_READER_URL + url, {
			headers: {
				'X-Return-Format': 'text'
			},
			signal: AbortSignal.timeout(10000)
		});

		if (!response.ok) {
			return { url, content: '', success: false };
		}

		let content = await response.text();

		if (content.length > MAX_CONTENT_LENGTH) {
			content = content.slice(0, MAX_CONTENT_LENGTH) + '...';
		}

		return { url, content, success: true };
	} catch (error) {
		console.error('[JinaReader] Error extracting:', url, error);
		return { url, content: '', success: false };
	}
}

export async function extractMultipleContents(urls: string[], maxConcurrent = 3): Promise<ExtractedContent[]> {
	const results: ExtractedContent[] = [];

	for (let i = 0; i < urls.length; i += maxConcurrent) {
		const batch = urls.slice(i, i + maxConcurrent);
		const batchResults = await Promise.all(batch.map(extractContent));
		results.push(...batchResults);
	}

	return results.filter((r) => r.success);
}
