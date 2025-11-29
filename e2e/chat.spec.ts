import { test, expect } from '@playwright/test';
import path from 'path';

test('upload PDF and ask first suggested question', async ({ page }) => {
	await page.goto('/');

	const fileInput = page.locator('input[type="file"][accept=".pdf,.txt"]');
	const pdfPath = path.join(process.cwd(), 'Market+Sharing+about+AI+Agent+-+Erica+Yu (2).pdf');
	await fileInput.setInputFiles(pdfPath);

	await expect(page.locator('.max-w-32.truncate')).toBeVisible({ timeout: 90000 });
	console.log('PDF uploaded');

	await expect(page.locator('text=이런 질문을 해보세요')).toBeVisible({ timeout: 30000 });
	console.log('Suggestions visible');

	const suggestionButton = page.locator('button.btn.preset-outlined').first();
	await expect(suggestionButton).toBeVisible({ timeout: 10000 });

	const questionText = await suggestionButton.textContent();
	console.log('Clicking suggestion:', questionText);
	await suggestionButton.click();

	await expect(page.locator('.prose')).toBeVisible({ timeout: 120000 });

	const response = await page.locator('.prose').first().textContent();
	console.log('Response received:', response?.slice(0, 200));

	expect(response).toBeTruthy();
	expect(response!.length).toBeGreaterThan(20);
});
