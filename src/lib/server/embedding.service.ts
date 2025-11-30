import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { supabase } from '$lib/supabase';
import { getFileHash } from './utils/hash';
import { EMBEDDING_MODEL, LLM_API_KEY, MODEL_HIGH } from '$env/static/private';
import { z } from 'zod';

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: LLM_API_KEY,
	modelName: EMBEDDING_MODEL,
	batchSize: 512
});

const analysisLLM = new ChatOpenAI({
	apiKey: LLM_API_KEY,
	model: MODEL_HIGH,
	temperature: 0
});

const textSplitter = new RecursiveCharacterTextSplitter({
	chunkSize: 500,
	chunkOverlap: 50,
	separators: ['. ', '? ', '! ', ' ', '']
});

const AnalysisSchema = z.object({
	topic: z.string().describe('core topic of the document in one sentence'),
	context: z.string().describe('scope, target audience, key concepts in 2-3 sentences, used for query refinement'),
	suggestedQuestions: z.array(z.string()).describe('5 useful questions for understanding the document')
});

interface ChunkData {
	content: string;
	pageNumber: number;
}

/**
 * PDF 문서를 업로드하고 임베딩을 생성한다.
 * @param fileName 파일명
 * @param fileBuffer 파일 바이너리 데이터
 * @returns 업로드 결과
 */
export async function uploadDocument(fileName: string, fileBuffer: Buffer) {
	const hash = getFileHash(fileBuffer.buffer as ArrayBuffer);

	const existing = await findExistingFile(hash);
	if (existing) {
		return { fileId: existing.id, fileName, hash, chunksCount: 0, status: 'linked' as const };
	}

	const docs = await loadPdf(fileBuffer);
	const fullText = docs.map((d) => d.pageContent).join('\n\n');

	const chunks = await splitDocuments(docs);
	const analysis = await analyzeDocument(fullText);
	const fileId = await saveFile(hash, fileName, analysis);
	const vectors = await generateEmbeddings(chunks);
	await saveChunks(fileId, chunks, vectors);

	return {
		fileId,
		fileName,
		hash,
		chunksCount: chunks.length,
		status: 'uploaded' as const,
		topic: analysis.topic,
		suggestedQuestions: analysis.suggestedQuestions
	};
}

async function findExistingFile(hash: string) {
	const { data } = await supabase.from('files').select('id').eq('hash', hash).single();
	return data;
}

async function loadPdf(buffer: Buffer) {
	const loader = new PDFLoader(new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }), {
		splitPages: true,
		parsedItemSeparator: '\n'
	});
	return loader.load();
}

function normalizeText(text: string) {
	return text
		.replace(/\n+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

async function splitDocuments(docs: Awaited<ReturnType<typeof loadPdf>>): Promise<ChunkData[]> {
	const chunks: ChunkData[] = [];

	for (const doc of docs) {
		const pageNumber = doc.metadata?.loc?.pageNumber ?? 1;
		const content = normalizeText(doc.pageContent);

		if (content.length === 0) continue;

		const splits = await textSplitter.splitText(content);
		for (const split of splits) {
			chunks.push({ content: split, pageNumber });
		}
	}

	return chunks;
}

async function analyzeDocument(fullText: string) {
	const truncated = fullText.slice(0, 12000);

	const prompt = `Analyze the following document.

Document content:
${truncated}

Analysis requirements:
1. topic: Clearly state the core topic of this document in one sentence
2. context: Explain the scope and context of the document. This description is used to refine user queries. Example: "This document covers AI Agent market trends in 2024. It includes product comparisons of major companies, investment status, and technology trends."
3. suggestedQuestions: 5 key questions a first-time reader might ask. Must be answerable from the document content`;

	return analysisLLM.withStructuredOutput(AnalysisSchema).invoke(prompt);
}

async function generateEmbeddings(chunks: ChunkData[]) {
	const texts = chunks.map((c) => c.content);
	return embeddings.embedDocuments(texts);
}

const BATCH_SIZE = 100;

async function saveChunks(fileId: string, chunks: ChunkData[], vectors: number[][]) {
	const prefix = fileId.slice(0, 8);
	const records = chunks.map((chunk, i) => ({
		id: `${prefix}-${i.toString().padStart(4, '0')}`,
		file_id: fileId,
		content: chunk.content,
		page_numbers: [chunk.pageNumber],
		embedding: JSON.stringify(vectors[i])
	}));

	for (let i = 0; i < records.length; i += BATCH_SIZE) {
		const batch = records.slice(i, i + BATCH_SIZE);
		const { error } = await supabase.from('chunks').insert(batch);
		if (error) throw error;
	}
}

async function saveFile(
	hash: string,
	filename: string,
	analysis: z.infer<typeof AnalysisSchema>
) {
	const { data } = await supabase
		.from('files')
		.insert({
			hash,
			filename,
			file_type: 'pdf',
			topic: analysis.topic,
			context: analysis.context,
			suggested_questions: analysis.suggestedQuestions
		})
		.select('id')
		.single();
	return data!.id;
}
