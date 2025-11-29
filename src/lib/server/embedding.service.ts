import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings } from '@langchain/openai';
import { z } from 'zod';
import { supabase } from '$lib/supabase';
import { getFileHash } from './utils/hash';
import { validationLLM } from './chat/llm';
import { LLM_API_KEY, EMBEDDING_MODEL } from '$env/static/private';

const textSplitter = new RecursiveCharacterTextSplitter({
	chunkSize: 300,
	chunkOverlap: 80
});

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: LLM_API_KEY,
	modelName: EMBEDDING_MODEL
});

const DocumentAnalysisSchema = z.object({
	topic: z.string(),
	context: z.string(),
	suggestedQuestions: z.array(z.string())
});

async function extractTextFromPDF(buffer: Buffer): Promise<string[]> {
	const { extractText } = await import('unpdf');
	const uint8Array = new Uint8Array(buffer);
	const { text: pages } = await extractText(uint8Array, { mergePages: false });
	return Array.isArray(pages) ? pages : [];
}

async function embedAndStore(content: string, fileId: string, pageNumber?: number) {
	const chunks = await textSplitter.splitText(content);
	if (chunks.length === 0) return 0;

	const vectors = await embeddings.embedDocuments(chunks);

	const records = chunks.map((chunk, i) => ({
		file_id: fileId,
		content: chunk,
		embedding: JSON.stringify(vectors[i]),
		page_number: pageNumber ?? null,
		metadata: { page_number: pageNumber ?? null, file_id: fileId }
	}));

	const { error } = await supabase.from('chunks').insert(records);
	if (error) throw new Error(`Failed to insert chunks: ${error.message}`);

	return chunks.length;
}

async function analyzeDocument(text: string, fileId: string) {
	const content = text.slice(0, 8000);
	const prompt = `문서를 분석하세요.

문서 내용:
${content}

추출:
1. topic: 핵심 주제 한 문장
2. context: 범위와 핵심 개념 2-3문장
3. suggestedQuestions: 핵심 내용 파악 질문 5개`;

	try {
		const structuredLLM = validationLLM.withStructuredOutput(DocumentAnalysisSchema);
		const analysis = await structuredLLM.invoke(prompt);

		await supabase
			.from('files')
			.update({
				topic: analysis.topic,
				context: analysis.context,
				suggested_questions: analysis.suggestedQuestions
			})
			.eq('id', fileId);

		console.log('[Embedding] Analyzed:', analysis.topic);
	} catch (error) {
		console.error('[Embedding] Analysis failed:', error);
	}
}

export async function uploadDocument(sessionId: string, fileName: string, fileBuffer: Buffer) {
	console.log('[Embedding] Upload:', fileName);

	const hash = getFileHash(fileBuffer.buffer as ArrayBuffer);
	const fileType = fileName.split('.').pop()?.toLowerCase() ?? 'unknown';

	const { data: existing } = await supabase
		.from('files')
		.select('id')
		.eq('hash', hash)
		.single();

	if (existing) {
		await supabase
			.from('chat_files')
			.upsert({ chat_id: sessionId, file_id: existing.id }, { onConflict: 'chat_id,file_id' });

		return {
			fileId: existing.id,
			fileName,
			hash,
			chunksCount: 0,
			status: 'linked' as const,
			message: '기존 임베딩 사용'
		};
	}

	if (fileType !== 'pdf') {
		throw new Error('PDF 파일만 지원합니다.');
	}

	const pages = await extractTextFromPDF(fileBuffer);
	if (pages.join('').trim().length < 100) {
		throw new Error('텍스트 추출 실패. OCR 처리된 PDF를 업로드하세요.');
	}

	let chunksCount = 0;

	const { data: newFile, error } = await supabase
		.from('files')
		.insert({ hash, filename: fileName, file_type: fileType })
		.select('id')
		.single();

	if (error || !newFile) throw new Error(error?.message ?? 'File insert failed');

	await supabase.from('chat_files').insert({ chat_id: sessionId, file_id: newFile.id });

	for (let i = 0; i < pages.length; i++) {
		if (pages[i].trim()) {
			chunksCount += await embedAndStore(pages[i], newFile.id, i + 1);
		}
	}

	await analyzeDocument(pages.join('\n'), newFile.id);

	return {
		fileId: newFile.id,
		fileName,
		hash,
		chunksCount,
		status: 'uploaded' as const,
		message: `${chunksCount}개 청크 임베딩 완료`
	};
}
