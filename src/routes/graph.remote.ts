import { query } from '$app/server';
import { getGraphMermaid } from '$lib/server/chat/graph';

export const graphDiagram = query(async () => {
	return getGraphMermaid();
});
