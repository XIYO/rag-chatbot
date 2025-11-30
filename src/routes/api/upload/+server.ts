import { json } from '@sveltejs/kit';
import { uploadDocument } from '$lib/server/embedding.service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const file = formData.get('file') as File | null;

	if (!file) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		const result = await uploadDocument(file.name, buffer);

		return json(result);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Upload failed';
		return json({ error: message }, { status: 500 });
	}
};
