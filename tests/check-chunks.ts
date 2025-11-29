import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
	const { data: files, error: filesError } = await supabase.from('files').select('id, filename, hash');
	console.log('Files:', files?.length ?? 0, filesError?.message ?? '');
	if (files) console.log(files);

	const { data: chunks, error: chunksError } = await supabase.from('chunks').select('id, content, file_id, page_number').limit(3);
	console.log('\nChunks:', chunks?.length ?? 0, chunksError?.message ?? '');
	if (chunks && chunks.length > 0) {
		chunks.forEach((c, i) => {
			console.log(`[${i}] file_id: ${c.file_id}, page: ${c.page_number}`);
			console.log(`    content: ${c.content.slice(0, 80)}...`);
		});
	}

	const { data: chatFiles, error: chatFilesError } = await supabase.from('chat_files').select('chat_id, file_id');
	console.log('\nChat files:', chatFiles?.length ?? 0, chatFilesError?.message ?? '');
	if (chatFiles) console.log(chatFiles);
}

check().catch(console.error);
