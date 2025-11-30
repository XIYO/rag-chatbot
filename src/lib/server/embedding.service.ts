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
	topic: z.string().describe('문서의 핵심 주제를 한 문장으로'),
	context: z.string().describe('문서의 범위, 대상 독자, 핵심 개념을 2-3문장으로 설명. 질의 개선에 사용됨'),
	suggestedQuestions: z.array(z.string()).describe('문서 내용 파악에 유용한 질문 5개')
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

	const prompt = `다음 문서를 분석하세요.

문서 내용:
${truncated}

분석 요구사항:
1. topic: 이 문서가 다루는 핵심 주제를 한 문장으로 명확하게
2. context: 문서의 범위와 맥락을 설명. 이 설명은 사용자 질의를 문서에 맞게 개선하는데 사용됨. 예: "이 문서는 2024년 AI Agent 시장 동향을 다룹니다. 주요 기업들의 제품 비교, 투자 현황, 기술 트렌드를 포함합니다."
3. suggestedQuestions: 이 문서를 처음 읽는 사람이 물어볼 만한 핵심 질문 5개. 문서 내용으로 답변 가능해야 함`;

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
