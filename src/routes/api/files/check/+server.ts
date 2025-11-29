import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { hash, chatId } = await request.json();
	console.log('[FilesCheck] hash:', hash, 'chatId:', chatId);

	if (!hash) {
		return json({ error: 'No hash provided' }, { status: 400 });
	}

	if (!chatId) {
		return json({ error: 'No chatId provided' }, { status: 400 });
	}

	const { data: existing } = await supabase
		.from('files')
		.select('id, filename')
		.eq('hash', hash)
		.single();

	if (existing) {
		console.log('[FilesCheck] Found existing file:', existing.id);
		await supabase
			.from('chat_files')
			.upsert({ chat_id: chatId, file_id: existing.id }, { onConflict: 'chat_id,file_id' });

		return json({
			exists: true,
			fileId: existing.id,
			filename: existing.filename
		});
	}

	console.log('[FilesCheck] File not found, needs upload');
	return json({ exists: false });
};
