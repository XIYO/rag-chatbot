import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
	process.env.PUBLIC_SUPABASE_URL!,
	process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!
);

const { data } = await supabase
	.from('files')
	.select('filename, topic, suggested_questions')
	.order('created_at', { ascending: false })
	.limit(1);

console.log(JSON.stringify(data, null, 2));
