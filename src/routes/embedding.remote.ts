import { form } from '$app/server';
import * as v from 'valibot';
import { uploadDocument } from '$lib/server/embedding.service';

export const uploadFile = form(
	v.object({
		sessionId: v.string(),
		fileName: v.string(),
		file: v.file()
	}),
	async ({ sessionId, fileName, file }) => {
		const arrayBuffer = await file.arrayBuffer();
		const fileBuffer = Buffer.from(arrayBuffer);
		return await uploadDocument(sessionId, fileName, fileBuffer);
	}
);
