import { supabase } from '$lib/supabase';

export async function getAllFiles() {
	const { data } = await supabase
		.from('files')
		.select('id, filename, topic, context, suggested_questions')
		.order('created_at', { ascending: false });

	return data ?? [];
}
