import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: process.env.LLM_API_KEY,
	modelName: process.env.EMBEDDING_MODEL
});

async function test() {
	const { data: chatFiles } = await supabase.from('chat_files').select('chat_id').limit(1);
	const chatId = chatFiles?.[0]?.chat_id;

	if (!chatId) {
		console.log('No chat session found.');
		return;
	}

	console.log('Chat ID:', chatId);

	const query = 'What is AI Agent?';
	const queryEmbedding = await embeddings.embedQuery(query);

	console.log('\n=== Testing match_chunks RPC ===');
	const { data, error } = await supabase.rpc('match_chunks', {
		query_embedding: JSON.stringify(queryEmbedding),
		match_count: 3,
		filter: { chat_id: chatId }
	});

	if (error) {
		console.error('Error:', error);
		return;
	}

	console.log('Results:');
	for (const row of data) {
		console.log(`\nID: ${row.id}`);
		console.log(`Metadata ID: ${row.metadata?.id}`);
		console.log(`Page: ${row.metadata?.page_number}`);
		console.log(`Similarity: ${row.similarity.toFixed(3)}`);
		console.log(`Content: ${row.content.slice(0, 100)}...`);
	}

	if (data && data.length > 0) {
		const chunkId = data[0].id;
		console.log(`\n=== Testing expand (id: ${chunkId}) ===`);

		const { data: targetChunk } = await supabase
			.from('chunks')
			.select('id, file_id')
			.eq('id', chunkId)
			.single();

		if (targetChunk) {
			const expandedIds = [chunkId - 1, chunkId, chunkId + 1];
			const { data: expanded } = await supabase
				.from('chunks')
				.select('id, content, page_number')
				.in('id', expandedIds)
				.eq('file_id', targetChunk.file_id)
				.order('id');

			console.log(`\nExpanded ${expanded?.length || 0} chunks:`);
			expanded?.forEach((c) => {
				console.log(`\n[Chunk ${c.id}, p.${c.page_number}]`);
				console.log(c.content.slice(0, 200));
			});
		}
	}
}

test().catch(console.error);
