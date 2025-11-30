import { supabase } from '$lib/supabase';
import type { FileContext } from './chat/state';

/**
 * 저장된 모든 파일 목록을 조회한다.
 * @returns 파일 메타데이터 배열
 */
export async function getAllFiles() {
	const { data } = await supabase
		.from('files')
		.select('id, filename, topic, context, suggested_questions')
		.order('created_at', { ascending: false });

	return data ?? [];
}

/**
 * 모든 파일의 컨텍스트를 통합하여 조회한다.
 * @returns 통합된 파일 주제와 맥락 정보
 */
export async function getFileContext(): Promise<FileContext | null> {
	const { data } = await supabase
		.from('files')
		.select('topic, context')
		.order('created_at', { ascending: false });

	if (!data || data.length === 0) return null;

	const topics = data
		.map((f) => f.topic)
		.filter(Boolean);

	const contexts = data
		.map((f) => f.context)
		.filter(Boolean);

	return {
		topic: topics.length > 0 ? topics.join(' / ') : null,
		context: contexts.length > 0 ? contexts.join('\n\n') : null
	};
}
