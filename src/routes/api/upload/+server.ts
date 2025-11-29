import { json } from '@sveltejs/kit';
import { uploadDocument } from '$lib/server/embedding.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	const chatId = formData.get('chatId') as string | null;

	if (!file) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	if (!chatId) {
		return json({ error: 'No chatId provided' }, { status: 400 });
	}

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		const result = await uploadDocument(chatId, file.name, buffer);

		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Upload failed';
		return json({ error: message }, { status: 500 });
	}
};
