import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

test.describe('PDF Embedding', () => {
	test('uploads PDF and creates structured chunks with AST', async ({ page }) => {
		await page.goto('/');

		await expect(page.locator('h1')).toContainText('RAG Chatbot');

		const fileInput = page.locator('input[type="file"]').first();
		const pdfPath = path.resolve('Market+Sharing+about+AI+Agent+-+Erica+Yu (2).pdf');

		await fileInput.setInputFiles(pdfPath);

		await page.waitForSelector('[class*="bg-surface-200"], [class*="linked"], [class*="done"]', {
			timeout: 300000
		});

		await page.waitForTimeout(5000);

		const { data: files, error: filesError } = await supabase
			.from('files')
			.select('*')
			.order('created_at', { ascending: false })
			.limit(1);

		expect(filesError).toBeNull();
		expect(files).toHaveLength(1);

		const file = files![0];
		console.log('Uploaded file:', file);

		const { data: chunks, error: chunksError } = await supabase
			.from('chunks')
			.select('*')
			.eq('file_id', file.id);

		expect(chunksError).toBeNull();
		expect(chunks).not.toBeNull();
		expect(chunks!.length).toBeGreaterThan(0);

		console.log(`Total chunks: ${chunks!.length}`);

		const chunkTypes = new Set(chunks!.map(c => c.chunk_type));
		console.log('Chunk types found:', [...chunkTypes]);

		for (const chunk of chunks!) {
			expect(chunk.id).toBeTruthy();
			expect(chunk.chunk_type).toBeTruthy();
			expect(chunk.content).toBeTruthy();
			expect(chunk.page_numbers).toBeTruthy();
			expect(Array.isArray(chunk.page_numbers)).toBe(true);
			expect(chunk.page_numbers.length).toBeGreaterThan(0);
			expect(typeof chunk.level).toBe('number');
			expect(Array.isArray(chunk.semantic_links)).toBe(true);
		}

		const headings = chunks!.filter(c => c.chunk_type === 'heading');
		const tables = chunks!.filter(c => c.chunk_type === 'table');
		const paragraphs = chunks!.filter(c => c.chunk_type === 'paragraph');

		console.log(`Headings: ${headings.length}`);
		console.log(`Tables: ${tables.length}`);
		console.log(`Paragraphs: ${paragraphs.length}`);

		const chunksWithParent = chunks!.filter(c => c.parent_id !== null);
		console.log(`Chunks with parent: ${chunksWithParent.length}`);

		const chunksWithLinks = chunks!.filter(c => c.semantic_links && c.semantic_links.length > 0);
		console.log(`Chunks with semantic links: ${chunksWithLinks.length}`);

		if (tables.length > 0) {
			console.log('Sample table:', {
				id: tables[0].id,
				title: tables[0].title,
				level: tables[0].level,
				parent_id: tables[0].parent_id,
				page_numbers: tables[0].page_numbers,
				content_preview: tables[0].content.slice(0, 200)
			});
		}

		const rootChunks = chunks!.filter(c => c.parent_id === null);
		console.log(`Root chunks (no parent): ${rootChunks.length}`);

		const levels = [...new Set(chunks!.map(c => c.level))].sort((a, b) => a - b);
		console.log('Levels found:', levels);

		for (const chunk of chunksWithParent.slice(0, 5)) {
			const parent = chunks!.find(c => c.id === chunk.parent_id);
			if (parent) {
				expect(parent.level).toBeLessThan(chunk.level);
			}
		}

		console.log('All validations passed');
	});
});
