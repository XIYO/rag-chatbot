import type { ChatStateType } from '../state';
import { supabase } from '$lib/supabase';

export async function noResultResponse(state: ChatStateType): Promise<Partial<ChatStateType>> {
	console.log('[Chat] No valid input or no results, fetching suggested questions');

	const { data: files } = await supabase
		.from('files')
		.select('suggested_questions, topic')
		.not('suggested_questions', 'is', null)
		.limit(1);

	if (!files || files.length === 0 || !files[0].suggested_questions) {
		return {
			response: '문서가 업로드되지 않았습니다. 먼저 PDF 파일을 업로드해주세요.',
			suggestions: [],
			currentStage: 'done'
		};
	}

	const questions = (files[0].suggested_questions as string[]).slice(0, 5);
	const topic = files[0].topic || '업로드된 문서';

	const isInvalidQuestion = state.currentStage === 'invalid';
	const message = isInvalidQuestion
		? `문서와 관련된 질문을 해주세요. 현재 문서는 "${topic}"에 관한 내용입니다.`
		: '관련 정보를 찾을 수 없습니다. 다음 질문을 시도해보세요:';

	return {
		response: message,
		suggestions: questions,
		currentStage: 'done'
	};
}
