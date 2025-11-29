import { expect, test } from '@playwright/test';

test('Supabase connection works', async ({ request }) => {
	const response = await request.get('/api/supabase-test');
	const data = await response.json();

	expect(response.ok()).toBe(true);
	expect(data.connected).toBe(true);
});
