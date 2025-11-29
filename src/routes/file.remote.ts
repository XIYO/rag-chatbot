import { query } from '$app/server';
import * as v from 'valibot';
import { getSessionFiles } from '$lib/server/file.service';

export const sessionFiles = query(
	v.object({ sessionId: v.string() }),
	async ({ sessionId }) => {
		return await getSessionFiles(sessionId);
	}
);
