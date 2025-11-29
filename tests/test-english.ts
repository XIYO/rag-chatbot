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
	const queries = [
		'What is AI Agent?',
		'AI agent market growth',
		'Gartner AI agent definition'
	];

	const { data: chatFiles } = await supabase.from('chat_files').select('chat_id').limit(1);
	const chatId = chatFiles?.[0]?.chat_id;

	for (const query of queries) {
		console.log('\n=== Query:', query, '===');
		const embedding = await embeddings.embedQuery(query);
		const embeddingString = '[' + embedding.join(',') + ']';

		const { data } = await supabase.rpc('search_chunks', {
			query_embedding: embeddingString,
			p_chat_id: chatId,
			match_count: 3,
			similarity_threshold: 0.1
		});

		if (data && data.length > 0) {
			console.log('Top similarity:', data[0].similarity.toFixed(3));
			console.log('Content:', data[0].content.slice(0, 120));
		}
	}
}

test().catch(console.error);
