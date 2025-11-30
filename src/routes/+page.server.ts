import { getAllFiles } from '$lib/server/file.service';

export async function load() {
	const files = await getAllFiles();

	return {
		files: files.map((f) => ({
			id: f.id,
			filename: f.filename,
			topic: f.topic,
			context: f.context,
			suggested_questions: f.suggested_questions as string[] | null
		}))
	};
}
