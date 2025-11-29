import { createClient } from '@supabase/supabase-js';
import { OpenAIEmbeddings } from '@langchain/openai';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const embeddings = new OpenAIEmbeddings({
	openAIApiKey: process.env.OPENAI_API_KEY,
	modelName: process.env.OPENAI_EMBEDDING_MODEL
});

async function test() {
	const query = 'AI 에이전트란 무엇인가요?';
	console.log('Query:', query);

	const embedding = await embeddings.embedQuery(query);
	const embeddingString = '[' + embedding.join(',') + ']';

	const { data: chatFiles } = await supabase.from('chat_files').select('chat_id').limit(1);
	const chatId = chatFiles?.[0]?.chat_id;
	console.log('Chat ID:', chatId);

	for (const threshold of [0.7, 0.5, 0.3, 0.1]) {
		const { data, error } = await supabase.rpc('search_chunks', {
			query_embedding: embeddingString,
			p_chat_id: chatId,
			match_count: 5,
			similarity_threshold: threshold
		});

		console.log('\nThreshold ' + threshold + ': ' + (data?.length ?? 0) + ' results', error?.message ?? '');
		if (data && data.length > 0) {
			console.log('Top similarity:', data[0].similarity);
			console.log('Preview:', data[0].content.slice(0, 100));
		}
	}
}

test().catch(console.error);
