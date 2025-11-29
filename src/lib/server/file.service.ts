import { supabase } from '$lib/supabase';

export async function getSessionFiles(sessionId: string) {
	const { data } = await supabase
		.from('chat_files')
		.select(`
			file_id,
			files (
				id,
				filename,
				topic,
				context,
				suggested_questions
			)
		`)
		.eq('chat_id', sessionId);

	if (!data) return [];

	return data
		.map((cf) => cf.files)
		.filter((f): f is NonNullable<typeof f> => f !== null);
}
