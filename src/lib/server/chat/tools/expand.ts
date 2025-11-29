import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { expandChunks } from '../retriever';

export const expandChunksTool = tool(
	async ({ chunkIds, range }) => {
		const expanded = await expandChunks(chunkIds, range);

		if (expanded.length === 0) {
			return 'No additional context found.';
		}

		const context = expanded
			.map((c) => `[Chunk ${c.id}, p.${c.pageNumber}] ${c.content}`)
			.join('\n\n');

		return `Expanded context (${expanded.length} chunks):\n\n${context}`;
	},
	{
		name: 'expand_chunks',
		description:
			'Retrieves adjacent chunks for more context when the current chunks are incomplete or cut off mid-sentence. Use when you need more context to understand a concept fully.',
		schema: z.object({
			chunkIds: z.array(z.number()).describe('IDs of chunks that need expanded context'),
			range: z.number().default(1).describe('Number of adjacent chunks to retrieve (1 = one before and one after)')
		})
	}
);
