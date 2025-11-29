import { supabase } from '$lib/supabase';
import { json } from '@sveltejs/kit';

export async function GET() {
	const { data, error } = await supabase.from('files').select('*').limit(1);

	if (error) {
		return json({
			connected: true,
			error: error.message,
			code: error.code
		});
	}

	return json({
		connected: true,
		data
	});
}
