import { query } from '$app/server';
import { getAllFiles } from '$lib/server/file.service';

export const files = query(async () => {
	return await getAllFiles();
});
