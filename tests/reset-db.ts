import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetTestData() {
	const hash = '5d867b69eab454b099f2f1cdbf0c1deb8bba4548e17a6355e64c0c87972f8cb4';

	const { data: file } = await supabase.from('files').select('id').eq('hash', hash).single();

	if (!file) {
		console.log('No file found with hash:', hash);
		return;
	}

	console.log('Found file:', file.id);

	await supabase.from('chunks').delete().eq('file_id', file.id);
	console.log('Deleted chunks');

	await supabase.from('chat_files').delete().eq('file_id', file.id);
	console.log('Deleted chat_files');

	await supabase.from('files').delete().eq('id', file.id);
	console.log('Deleted file');

	console.log('Done!');
}

resetTestData().catch(console.error);
